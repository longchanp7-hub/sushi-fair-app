import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT=path.resolve(new URL('..',import.meta.url).pathname);
const FILE=path.join(ROOT,'app','data','store-contexts.json');
const verifiedRows=[
  {chain:'hamazushi',prefecture:'愛知県',municipality:'豊橋市',storeName:'豊橋新栄店',storeId:'4208',regionCode:'tokai',regionLabel:'東海',officialUrl:'https://maps.hama-sushi.co.jp/jp/detail/4208.html',verified:true,source:'official_store_page'},
  {chain:'hamazushi',prefecture:'北海道',municipality:'札幌市中央区',storeName:'札幌中央市場前店',storeId:'4460',regionCode:'hokkaido',regionLabel:'北海道',officialUrl:'https://maps.hama-sushi.co.jp/jp/detail/4460.html',verified:true,source:'official_store_page'},
  {chain:'sushiro',prefecture:'愛知県',municipality:'豊橋市',storeName:'豊橋新栄店',storeId:'142',menuAreaCode:'179',priceTier:120,officialUrl:'https://www.akindo-sushiro.co.jp/shop/detail.php?id=142',menuUrl:'https://www.akindo-sushiro.co.jp/menu/menu_detail/?s_id=179',verified:true,source:'official_store_page'},
  {chain:'sushiro',prefecture:'北海道',municipality:'札幌市中央区',storeName:'札幌パルコ店',storeId:'2575',menuAreaCode:'883',priceTier:150,officialUrl:'https://www.akindo-sushiro.co.jp/shop/detail.php?id=2575',menuUrl:'https://www.akindo-sushiro.co.jp/menu/menu_detail/?s_id=883',verified:true,source:'official_store_page'},
  {chain:'kurasushi',prefecture:'愛知県',municipality:'豊橋市',storeName:'豊橋新栄店',storeId:'609',priceTier:115,officialUrl:'https://shop.kurasushi.co.jp/detail/609',verified:true,source:'official_store_page'},
  {chain:'kurasushi',prefecture:'北海道',municipality:'札幌市白石区',storeName:'ラソラ札幌店',storeId:'570',priceTier:120,officialUrl:'https://shop.kurasushi.co.jp/detail/570',verified:true,source:'official_store_page'},
];
const d=JSON.parse(await fs.readFile(FILE,'utf8'));d.catalog||={};
for(const row of verifiedRows){d.catalog[row.chain]||={};const key=`${row.prefecture}/${row.municipality}`;d.catalog[row.chain][key]={...(d.catalog[row.chain][key]||{}),...row};}
d.updatedAt=new Date().toISOString();
await fs.writeFile(FILE,JSON.stringify(d,null,2)+'\n');
console.log('Ensured verified Toyohashi/Sapporo regional context rows.');
