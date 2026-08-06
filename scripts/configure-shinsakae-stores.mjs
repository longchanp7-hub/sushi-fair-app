import fs from 'node:fs/promises';

const updater = 'scripts/update-fairs.mjs';
const overrides = 'scripts/apply-store-overrides.mjs';

let u = await fs.readFile(updater, 'utf8');
u = u
  .replace("name: '豊橋磯辺店'", "name: '豊橋新栄店'")
  .replace('https://www.akindo-sushiro.co.jp/menu/menu_detail/?s_id=244', 'https://www.akindo-sushiro.co.jp/menu/menu_detail/?s_id=179')
  .replace("storeUrl: 'https://www.akindo-sushiro.co.jp/shop/'", "storeUrl: 'https://www.akindo-sushiro.co.jp/shop/detail.php?id=142'")
  .replace("name: '豊橋新栄周辺'", "name: '豊橋新栄店'")
  .replace("storeUrl: 'https://maps.hama-sushi.co.jp/jp/index.html'", "storeUrl: 'https://maps.hama-sushi.co.jp/jp/detail/4208.html'");
await fs.writeFile(updater, u);

let o = await fs.readFile(overrides, 'utf8');
o = o
  .replace("storeName: '豊橋エリア（磯辺店基準）'", "storeName: '豊橋新栄店'")
  .replace("storeUrl: 'https://www.akindo-sushiro.co.jp/shop/'", "storeUrl: 'https://www.akindo-sushiro.co.jp/shop/detail.php?id=142'")
  .replace("storeName: '豊橋新栄周辺'", "storeName: '豊橋新栄店'")
  .replace("storeUrl: 'https://maps.hama-sushi.co.jp/jp/index.html'", "storeUrl: 'https://maps.hama-sushi.co.jp/jp/detail/4208.html'");
await fs.writeFile(overrides, o);

console.log('Configured Sushiro and Hamazushi to Toyohashi Shinsakae stores.');
