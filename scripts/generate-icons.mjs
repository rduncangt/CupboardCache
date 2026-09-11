import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../public/icon.svg', import.meta.url));
for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['icon-maskable.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  await sharp(source)
    .resize(size, size)
    .png()
    .toFile(new URL(`../public/${name}`, import.meta.url).pathname);
}
