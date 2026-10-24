import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
const root = fileURLToPath(new URL('../', import.meta.url));
await build({ absWorkingDir: root, entryPoints: ['src/discovery-entry.js'], outfile: 'build/worker.mjs', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', external: ['node:*'], alias: { url: 'node:url' },
  plugins: [{ name: 'precompiled-x402-ajv', setup(build) {
    build.onResolve({ filter: /^ajv(?:\/dist\/2020\.js)?$/ }, () => ({ path: fileURLToPath(new URL('../src/ajv-static.js', import.meta.url)) }));
  } }],
});
const source = await readFile(new URL('../build/worker.mjs', import.meta.url), 'utf8');
if (/new Function\s*\(/.test(source) || source.includes('Error compiling schema, function code')) throw new Error('Runtime schema compilation leaked into the Worker bundle');
console.log('Worker bundle contains the precompiled validator and no dynamic Function construction.');
