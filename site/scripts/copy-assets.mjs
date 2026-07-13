import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import sharp from 'sharp';

const rootDir = resolve(import.meta.dirname, '..', '..');
const srcDir = resolve(rootDir, 'docs', 'screenshots');
const destDir = resolve(import.meta.dirname, '..', 'src', 'assets', 'screenshots');

mkdirSync(destDir, { recursive: true });

const files = readdirSync(srcDir).filter((f) => f.endsWith('.png'));
for (const file of files) {
  cpSync(join(srcDir, file), join(destDir, file));
}

// Generate a cropped overview for the hero (trims blank left/right margins)
const overviewSrc = join(destDir, '01-overview.png');
const overviewDest = join(destDir, '01-overview-cropped.png');
const meta = await sharp(overviewSrc).metadata();
const margin = 265;
await sharp(overviewSrc)
  .extract({ left: margin, top: 0, width: meta.width - margin * 2, height: meta.height })
  .toFile(overviewDest);

console.log(`Copied ${files.length} screenshots to site/src/assets/screenshots/`);
console.log('Generated cropped hero overview');
