import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src', 'data', 'SummerGame2025.json');
const dest = path.join(root, 'public', 'data', 'SummerGame2025.json');

if (!fs.existsSync(src)) {
  console.error('copy-data: missing source file', src);
  process.exit(1);
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
console.log('copy-data: copied SummerGame2025.json -> public/data/');
