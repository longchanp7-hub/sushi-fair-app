import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveChainContextFromCatalog } from '../app/region.js';

const ROOT=path.resolve(new URL('..',import.meta.url).pathname);
const stores=JSON.parse(await fs.readFile(path.join(ROOT,'app','data','store-contexts.json'),'utf8'));
const catalog=stores.catalog||{};
const A={prefecture:'愛知県',city:'豊橋市',prefectureCode:'23'};
const B={prefecture:'北海道',city:'札幌市中央区',prefectureCode:'01'};
const c=(chain,loc)=>resolveChainContextFromCatalog(chain,loc,catalog);

const sa=c('sushiro',A),sb=c('sushiro',B);
assert.equal(sa.storeId,'142');assert.equal(sa.menuAreaCode,'179');assert.equal(sa.priceTier,120);assert.match(sa.menuUrl,/s_id=179/);
assert.equal(sb.storeId,'2575');assert.equal(sb.menuAreaCode,'883');assert.equal(sb.priceTier,150);assert.match(sb.menuUrl,/s_id=883/);
assert.notEqual(sa.storeId,sb.storeId);assert.notEqual(sa.menuUrl,sb.menuUrl);

const ha=c('hamazushi',A),hb=c('hamazushi',B);
assert.equal(ha.store?.storeId,'4208');assert.equal(ha.regionCode,'tokai');assert.equal(ha.regionLabel,'東海');assert.match(ha.officialUrl,/4208/);
assert.equal(hb.store?.storeId,'4460');assert.equal(hb.regionCode,'hokkaido');assert.equal(hb.regionLabel,'北海道');assert.match(hb.officialUrl,/4460/);
assert.notEqual(ha.officialUrl,hb.officialUrl);

const ka=c('kurasushi',A),kb=c('kurasushi',B);
assert.equal(ka.store?.storeId,'609');assert.equal(ka.priceTier,115);assert.match(ka.officialUrl,/609/);
assert.equal(kb.store?.storeId,'570');assert.equal(kb.priceTier,120);assert.match(kb.officialUrl,/570/);assert.notEqual(ka.officialUrl,kb.officialUrl);

const pa=c('kappasushi',A),pb=c('kappasushi',B);
assert.ok(pa.officialUrl);assert.ok('menuType' in pa);
if(pa.store&&pb.store)assert.notEqual(pa.store.storeId,pb.store.storeId,'Kappa must not reuse Toyohashi representative in Sapporo');
else assert.equal(pb.store,null,'No verified Hokkaido Kappa store must remain no-store instead of reusing Aichi');

const ua=c('uobei',A),ub=c('uobei',B);
assert.ok(ua.officialUrl&&ub.officialUrl);assert.ok('priceClass' in ua&&'priceClass' in ub);
if(ua.store&&ub.store)assert.notEqual(ua.store.storeId||ua.officialUrl,ub.store.storeId||ub.officialUrl,'Uobei representative must change by region');
else assert.notEqual(ua.priceClass,ub.priceClass,'Uobei approximation must change between Toyohashi urban and Sapporo standard context');

console.log('Toyohashi -> Sapporo five-chain regional switch regression passed.');
