import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT=path.resolve(new URL('..',import.meta.url).pathname);
const MAIN=path.join(ROOT,'app','data','store-contexts.json');
const FALLBACK=path.join(ROOT,'app','data','store-contexts-fallback.json');
const PREFS=new Set(['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県']);
const PAGE_CHROME=/(?:条件を絞り込む|リスト表示|マップ表示|ALL RIGHTS RESERVED|プライバシーポリシー|会社情報\s*採用情報|\d+件の店舗があります)/i;
const FLOORS={sushiro:300,hamazushi:47,kurasushi:300,kappasushi:120,totomaru:10,musashimaru:4,tokubei:10};

const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const expectedKey=row=>`${row?.prefecture||''}/${row?.municipality||''}`;

function sushiroStoreUrl(value){
  try{
    const u=new URL(value);
    return u.protocol==='https:'&&u.hostname==='www.akindo-sushiro.co.jp'&&u.pathname==='/shop/detail.php'&&/^\d+$/.test(u.searchParams.get('id')||'');
  }catch{return false;}
}

export function inspectStoreRow(chain,key,row){
  const reasons=[];
  if(!row||typeof row!=='object')return ['row_not_object'];
  const pref=clean(row.prefecture),municipality=clean(row.municipality),name=clean(row.storeName),address=clean(row.address),url=clean(row.officialUrl);
  if(!PREFS.has(pref))reasons.push('invalid_prefecture');
  if(key!==expectedKey(row))reasons.push('key_mismatch');
  if(chain!=='hamazushi'&&municipality==='*')reasons.push('unexpected_wildcard_municipality');
  if(!municipality)reasons.push('missing_municipality');
  if(municipality.length>60)reasons.push('municipality_too_long');
  if(name.length>100)reasons.push('store_name_too_long');
  if(address.length>240)reasons.push('address_too_long');
  if(name==='お店')reasons.push('generic_store_name');
  if(PAGE_CHROME.test([key,municipality,name,address].join(' ')))reasons.push('page_chrome_leak');
  if(url&&!/^https:\/\//.test(url))reasons.push('non_https_official_url');
  if(chain==='sushiro'){
    if(!sushiroStoreUrl(url))reasons.push('sushiro_non_store_url');
    const id=String(row.storeId||'');
    if(id&&new URL(url).searchParams.get('id')!==id)reasons.push('sushiro_store_id_url_mismatch');
  }
  return [...new Set(reasons)];
}

export function inspectCatalog(data,{fallback=false}={}){
  const issues=[];
  const catalog=data?.catalog||{};
  for(const [chain,rows] of Object.entries(catalog)){
    const ids=new Map();
    for(const [key,row] of Object.entries(rows||{})){
      const reasons=inspectStoreRow(chain,key,row);
      if(row?.storeId){
        const id=String(row.storeId),prior=ids.get(id);
        if(prior&&prior!==key)reasons.push('duplicate_store_id');
        else ids.set(id,key);
      }
      if(reasons.length)issues.push({chain,key,reasons:[...new Set(reasons)]});
    }
  }
  if(!fallback){
    for(const [chain,min] of Object.entries(FLOORS)){
      const count=Object.keys(catalog?.[chain]||{}).length;
      if(count<min)issues.push({chain,key:null,reasons:[`catalog_below_floor:${count}<${min}`]});
    }
  }
  return issues;
}

function rowIssue(issue){return issue.key!==null&&issue.reasons.every(r=>!r.startsWith('catalog_below_floor:'));}

function repair(data){
  const copy=structuredClone(data),removed=[];
  for(const issue of inspectCatalog(copy)){
    if(!rowIssue(issue))continue;
    if(copy.catalog?.[issue.chain]?.[issue.key]){
      removed.push(issue);
      delete copy.catalog[issue.chain][issue.key];
    }
  }
  if(removed.length)copy.updatedAt=new Date().toISOString();
  return {data:copy,removed};
}

async function validateFile(file,{fallback=false,repairMode=false}={}){
  let data=JSON.parse(await fs.readFile(file,'utf8'));
  let removed=[];
  if(repairMode&&!fallback){
    const fixed=repair(data);data=fixed.data;removed=fixed.removed;
    if(removed.length)await fs.writeFile(file,JSON.stringify(data,null,2)+'\n');
  }
  const issues=inspectCatalog(data,{fallback});
  if(issues.length)throw new Error(`${path.basename(file)} store catalog invalid: ${JSON.stringify(issues.slice(0,20))}`);
  return {file:path.basename(file),removed,count:Object.fromEntries(Object.entries(data.catalog||{}).map(([k,v])=>[k,Object.keys(v||{}).length]))};
}

function selfTest(){
  const good={chain:'sushiro',prefecture:'愛知県',municipality:'豊橋市',storeName:'豊橋新栄店',storeId:'142',officialUrl:'https://www.akindo-sushiro.co.jp/shop/detail.php?id=142',verified:true};
  assert.deepEqual(inspectStoreRow('sushiro','愛知県/豊橋市',good),[]);
  const bad={chain:'sushiro',prefecture:'青森県',municipality:'岩手県 宮城県 条件を絞り込む',storeName:'お店',storeId:'726',officialUrl:'https://www.akindo-sushiro.co.jp/campaign/detail.php?id=726',address:'青森県 条件を絞り込む リスト表示'};
  const reasons=inspectStoreRow('sushiro','青森県/岩手県 宮城県 条件を絞り込む',bad);
  for(const code of ['generic_store_name','page_chrome_leak','sushiro_non_store_url'])assert.ok(reasons.includes(code),code);
  const mismatch={...good,storeId:'999'};assert.ok(inspectStoreRow('sushiro','愛知県/豊橋市',mismatch).includes('sushiro_store_id_url_mismatch'));
  console.log('Store context validator self-tests passed.');
}

async function main(){
  if(process.argv.includes('--self-test'))return selfTest();
  const repairMode=process.argv.includes('--repair');
  const reports=[];
  reports.push(await validateFile(MAIN,{repairMode}));
  reports.push(await validateFile(FALLBACK,{fallback:true,repairMode:false}));
  console.log(JSON.stringify({ok:true,reports},null,2));
}

await main();
