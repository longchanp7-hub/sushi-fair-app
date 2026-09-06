import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { coarseMunicipality, municipalityFallbackData, resolveChainContextFromCatalog } from '../app/region.js';

const ROOT=path.resolve(new URL('..',import.meta.url).pathname);
const stores=JSON.parse(await fs.readFile(path.join(ROOT,'app','data','store-contexts.json'),'utf8'));
const catalog=stores.catalog||{};
const A={prefecture:'愛知県',city:'豊橋市',prefectureCode:'23'};
const B={prefecture:'北海道',city:'札幌市中央区',prefectureCode:'01'};
const B_COARSE={prefecture:'北海道',city:'札幌市',prefectureCode:'01'};
const c=(chain,loc)=>resolveChainContextFromCatalog(chain,loc,catalog);

assert.equal(coarseMunicipality('北海道','札幌市中央区'),'札幌市');
assert.equal(coarseMunicipality('愛知県','名古屋市中区'),'名古屋市');
assert.equal(coarseMunicipality('東京都','新宿区'),'東京23区');
assert.equal(coarseMunicipality('愛知県','豊橋市'),'豊橋市');

const fallback=municipalityFallbackData(catalog);
assert.equal(Object.keys(fallback).length,47,'Address API fallback must expose all 47 prefectures');
for(const [pref,cities] of Object.entries(fallback))assert.ok(Array.isArray(cities)&&cities.length>=1,`${pref} fallback municipality missing`);
assert.ok(fallback['愛知県'].includes('豊橋市'),'Aichi fallback must retain Toyohashi');
assert.ok(fallback['北海道'].includes('札幌市'),'Hokkaido fallback must retain Sapporo');
assert.ok(fallback['東京都'].includes('東京23区'),'Tokyo fallback must retain Tokyo 23 wards');

const sa=c('sushiro',A),sb=c('sushiro',B),sbCoarse=c('sushiro',B_COARSE);
assert.equal(sa.storeId,'142');assert.equal(sa.menuAreaCode,'179');assert.equal(sa.priceTier,120);assert.match(sa.menuUrl,/s_id=179/);
assert.equal(sb.storeId,'2575');assert.equal(sb.menuAreaCode,'883');assert.equal(sb.priceTier,150);assert.match(sb.menuUrl,/s_id=883/);
assert.ok(sbCoarse.store?.municipality?.startsWith('札幌市'),'Coarse Sapporo selection must resolve a Sapporo Sushiro store');
assert.ok(sbCoarse.storeId&&sbCoarse.menuAreaCode,'Coarse Sapporo Sushiro context must retain store/menu identifiers');
assert.notEqual(sbCoarse.storeId,sa.storeId,'Coarse Sapporo must not reuse Toyohashi representative');
assert.notEqual(sa.storeId,sb.storeId);assert.notEqual(sa.menuUrl,sb.menuUrl);

const ha=c('hamazushi',A),hb=c('hamazushi',B),hbCoarse=c('hamazushi',B_COARSE);
assert.equal(ha.store?.storeId,'4208');assert.equal(ha.regionCode,'tokai');assert.equal(ha.regionLabel,'東海');assert.match(ha.officialUrl,/4208/);
assert.equal(hb.store?.storeId,'4460');assert.equal(hb.regionCode,'hokkaido');assert.equal(hb.regionLabel,'北海道');assert.match(hb.officialUrl,/4460/);
assert.equal(hbCoarse.regionCode,'hokkaido');assert.ok(hbCoarse.store?.municipality?.startsWith('札幌市'));
assert.notEqual(ha.officialUrl,hb.officialUrl);

const ka=c('kurasushi',A),kb=c('kurasushi',B),kbCoarse=c('kurasushi',B_COARSE);
assert.equal(ka.store?.storeId,'609');assert.equal(ka.priceTier,115);assert.match(ka.officialUrl,/609/);
assert.equal(kb.store?.prefecture,'北海道');assert.match(kb.store?.municipality||'',/^札幌市/);assert.ok(kb.store?.storeId,'Kura Sapporo representative store missing');assert.ok(Number(kb.priceTier)>0,'Kura Sapporo price tier missing');assert.match(kb.officialUrl||'',/^https:\/\/shop\.kurasushi\.co\.jp\/detail\//);
assert.ok(kbCoarse.store?.municipality?.startsWith('札幌市'),'Coarse Sapporo selection must stay inside Sapporo city');
assert.notEqual(ka.store.storeId,kb.store.storeId,'Kura must not reuse Toyohashi representative in Sapporo');assert.notEqual(ka.officialUrl,kb.officialUrl);

const pa=c('kappasushi',A),pb=c('kappasushi',B);
assert.ok(pa.officialUrl);assert.ok('menuType' in pa);
if(pa.store&&pb.store)assert.notEqual(pa.store.storeId,pb.store.storeId,'Kappa must not reuse Toyohashi representative in Sapporo');
else assert.equal(pb.store,null,'No verified Hokkaido Kappa store must remain no-store instead of reusing Aichi');

const ua=c('uobei',A),ub=c('uobei',B);
assert.ok(ua.officialUrl&&ub.officialUrl);assert.ok('priceClass' in ua&&'priceClass' in ub);
if(ua.store&&ub.store)assert.notEqual(ua.store.storeId||ua.officialUrl,ub.store.storeId||ub.officialUrl,'Uobei representative must change by region');
else assert.notEqual(ua.priceClass,ub.priceClass,'Uobei approximation must change between Toyohashi urban and Sapporo standard context');

const fallbackCatalog=JSON.parse(await fs.readFile(path.join(ROOT,'app','data','store-contexts-fallback.json'),'utf8')).catalog||{};
const ft=resolveChainContextFromCatalog('totomaru',A,fallbackCatalog),fm=resolveChainContextFromCatalog('musashimaru',A,fallbackCatalog);
assert.equal(ft.availableInSelectedArea,true,'Totomaru fallback catalog must preserve Toyohashi store');
assert.equal(fm.availableInSelectedArea,true,'Musashimaru fallback catalog must preserve Toyohashi store');
assert.match(ft.store?.storeName||'',/魚魚丸/);assert.match(fm.store?.storeName||'',/武蔵丸/);

console.log('Toyohashi -> Sapporo five-chain, 47-prefecture fallback and local-store resilience regression passed.');