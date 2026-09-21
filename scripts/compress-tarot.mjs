import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const dir = path.resolve('src/addon-console/assets/tarot');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.png'));

let beforeTotal = 0;
let afterTotal = 0;

for (const f of files) {
  const full = path.join(dir, f);
  const before = fs.statSync(full).size;
  beforeTotal += before;
  const buf = await sharp(full)
    .resize({ width: 360, height: 360, fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9, palette: true, quality: 80 })
    .toBuffer();
  fs.writeFileSync(full, buf);
  afterTotal += buf.length;
  console.log(`${f}: ${(before / 1024 / 1024).toFixed(2)}MB -> ${(buf.length / 1024).toFixed(1)}KB`);
}

console.log(
  `TOTAL: ${(beforeTotal / 1024 / 1024).toFixed(1)}MB -> ${(afterTotal / 1024 / 1024).toFixed(1)}MB`,
);
