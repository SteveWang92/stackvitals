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

// Generate a cropped overview for the hero (trims blank left/right margins).
// The screenshot is captured at 1920px viewport (scripts/demo-screenshots/capture.mjs)
// and the app content is max 1180px (src/styles.css .app-shell), giving ~370px of
// whitespace per side. Cropping 265px keeps ~105px of visual padding around the content.
// If the viewport width or app max-width changes, recalculate this value.
const overviewSrc = join(destDir, '01-overview.png');
const overviewDest = join(destDir, '01-overview-cropped.png');
const img = sharp(overviewSrc);
const meta = await img.metadata();
const margin = 265;
await img
  .clone()
  .extract({ left: margin, top: 0, width: meta.width - margin * 2, height: meta.height })
  .toFile(overviewDest);

console.log(`Copied ${files.length} screenshots to site/src/assets/screenshots/`);
console.log('Generated cropped hero overview');
