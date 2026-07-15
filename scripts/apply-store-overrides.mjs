import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'app', 'data', 'fairs.json');

const overrides = {
  sushiro: {
    storeName: '豊橋新栄店',
    storeUrl: 'https://www.akindo-sushiro.co.jp/shop/'
  },
  hamazushi: {
    storeName: '豊橋新栄周辺',
    storeUrl: 'https://maps.hama-sushi.co.jp/jp/index.html'
  }
};

const data = JSON.parse(await fs.readFile(OUT, 'utf8'));
data.chains = (data.chains || []).map(chain => ({
  ...chain,
  ...(overrides[chain.chain] || {})
}));
await fs.writeFile(OUT, JSON.stringify(data, null, 2) + '\n');
console.log('Applied preferred Toyohashi/Shinsakae store area overrides.');
