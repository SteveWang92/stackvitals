import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..', '..');
const srcDir = resolve(rootDir, 'docs', 'screenshots');
const destDir = resolve(import.meta.dirname, '..', 'src', 'assets', 'screenshots');

mkdirSync(destDir, { recursive: true });

const files = readdirSync(srcDir).filter((f) => f.endsWith('.png'));
for (const file of files) {
  cpSync(join(srcDir, file), join(destDir, file));
}

console.log(`Copied ${files.length} screenshots to site/src/assets/screenshots/`);
