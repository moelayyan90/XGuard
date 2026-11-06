import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({ entryPoints: [root + 'src/live/extract-browser.js'], bundle: true, write: false, minify: true, platform: 'browser', target: 'es2022', format: 'iife', legalComments: 'none' });
const generated = '// Generated from extract-browser.js with pinned local dependencies.\nexport default ' + JSON.stringify(result.outputFiles[0].text) + ';\n';
const destination = root + 'src/live/extract-client.generated.js';
if (process.argv.includes('--check')) {
  if (await readFile(destination, 'utf8') !== generated) throw new Error('Rebuild the extraction browser client before committing.');
} else await writeFile(destination, generated);
console.log('Extraction browser client verified.');
