import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, 'public', 'data', 'locations.json');
const fallbackSrc = path.join(root, 'src', 'data', 'SummerGame2025.json');
const remoteUrl = process.env.PUBLIC_DATA_URL?.trim();

async function main() {
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  if (remoteUrl) {
    const response = await fetch(remoteUrl);
    if (!response.ok) {
      console.error(`copy-data: fetch failed (${response.status})`, remoteUrl);
      process.exit(1);
    }
    fs.writeFileSync(dest, await response.text());
    console.log(`copy-data: fetched ${remoteUrl} -> public/data/locations.json`);
    return;
  }

  if (!fs.existsSync(fallbackSrc)) {
    console.error('copy-data: missing source file', fallbackSrc);
    process.exit(1);
  }

  fs.copyFileSync(fallbackSrc, dest);
  console.log('copy-data: copied SummerGame2025.json -> public/data/locations.json');
}

main().catch((err) => {
  console.error('copy-data:', err);
  process.exit(1);
});
