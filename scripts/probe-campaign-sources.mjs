// Read-only diagnostics. No credentials, no writes to production data.
import * as cheerio from 'cheerio';
for(const url of ['https://www.kappasushi.jp/campaign_list/','https://prtimes.jp/main/html/searchrlp/company_id/18731','https://prtimes.jp/main/html/rd/p/000001212.000018731.html']){
 const r=await fetch(url,{signal:AbortSignal.timeout(20000)}),html=await r.text(),$=cheerio.load(html);$('script,style,header,footer,nav').remove();
 console.log(JSON.stringify({url,status:r.status,links:$('a[href]').map((_,a)=>({href:$(a).attr('href'),text:$(a).text().trim().slice(0,150),alt:$(a).find('img').attr('alt')})).get().filter(x=>!/twitter|facebook|instagram|youtube|privacy|terms|login|signup/.test(x.href)).slice(0,65),raw:[...html.matchAll(/.{0,70}(?:000018731|article_id|pressRelease|search_word).{0,100}/g)].slice(0,8).map(x=>x[0]),body:url.includes('/rd/p/')?$('body').text().replace(/\s+/g,' ').slice(0,12500):''}));
}
