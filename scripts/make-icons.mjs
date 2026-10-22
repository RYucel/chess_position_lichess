import { copyFile, mkdir } from 'node:fs/promises';
import sharp from 'sharp';

const source = 'src/app/icon.svg';
const outDir = 'public/icons';

await mkdir(outDir, { recursive: true });
await copyFile(source, `${outDir}/icon.svg`);

for (const [size, name] of [
  [192, 'icon-192.png'],
  [512, 'icon-512.png'],
  [180, 'apple-touch-icon.png'],
]) {
  await sharp(source).resize(size, size).png().toFile(`${outDir}/${name}`);
}

// Maskable icons need their artwork inside the central safe zone.
const maskableArt = await sharp(source).resize(410, 410).png().toBuffer();
await sharp({
  create: { width: 512, height: 512, channels: 4, background: '#080a09' },
})
  .composite([{ input: maskableArt, gravity: 'center' }])
  .png()
  .toFile(`${outDir}/icon-maskable-512.png`);

console.log('PWA icons generated in public/icons');
