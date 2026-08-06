import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const FEATURES_PATH = path.join(ROOT, 'app', 'features.js');

const rawUrl = process.argv[2] || process.env.CROWD_API_URL || '';
if (!rawUrl) {
  throw new Error('CROWD_API_URL is required');
}

const parsed = new URL(rawUrl);
if (parsed.protocol !== 'https:') {
  throw new Error('Crowd API URL must use HTTPS');
}

const apiUrl = parsed.href.replace(/\/$/, '');
let source = await fs.readFile(FEATURES_PATH, 'utf8');

if (!/apiUrl:\s*['"][^'"]*['"]/.test(source)) {
  throw new Error('features.js does not contain crowd.apiUrl');
}

source = source.replace(/apiUrl:\s*['"][^'"]*['"]/, `apiUrl: '${apiUrl}'`);
await fs.writeFile(FEATURES_PATH, source);
console.log(`Configured crowd API: ${apiUrl}`);
