import { readFile, writeFile } from 'node:fs/promises';
import { amplifyCustomHttpFile } from './securityHeaders.ts';

// Reads VITE_SUPABASE_URL from the process environment only, never from `.env`, so a local
// stack's URL cannot end up in the committed file.
const path = 'customHttp.yml';
const expected = amplifyCustomHttpFile(process.env.VITE_SUPABASE_URL || undefined);

if (process.argv.includes('--check')) {
  if ((await readFile(path, 'utf8')) !== expected) {
    console.error(`${path} does not match scripts/securityHeaders.ts. Run npm run headers and commit the result.`);
    process.exit(1);
  }
} else {
  await writeFile(path, expected);
}
