import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const registryDescription = JSON.parse(readFileSync('server.json', 'utf8')).description;
if (typeof registryDescription !== 'string' || !registryDescription.trim() || [...registryDescription].length > 100) {
  throw new Error('MCP Registry requires a non-empty server.json description of at most 100 characters.');
}
const root = 'apps/relay/src/live';
for (const file of readdirSync(root).filter(x => x.endsWith('.ts'))) {
  const content = readFileSync(`${root}/${file}`, 'utf8');
  if (/\beval\s*\(|new Function\s*\(/.test(content)) throw new Error(`Dynamic code execution is prohibited: ${file}`);
  if (/\bTODO\b|\bFIXME\b/.test(content)) throw new Error(`Unfinished implementation: ${file}`);
  if (/\b(?:fetch|safeFetch)\([^)]*request\.url/.test(content)) throw new Error(`Unbounded user URL fetch: ${file}`);
  execFileSync(process.execPath, ['--check', `${root}/${file}`], { stdio: 'inherit' });
}
console.log('Live syntax and security-sensitive source checks passed.');
for (const file of readdirSync('apps/relay/src/action').filter(x => x.endsWith('.js'))) {
  execFileSync(process.execPath, ['--check', 'apps/relay/src/action/' + file], { stdio: 'inherit' });
}
for (const dir of ['products', 'business', 'payments/orchestrator']) for (const file of readdirSync('apps/relay/src/' + dir).filter(x => x.endsWith('.js'))) {
  execFileSync(process.execPath, ['--check', 'apps/relay/src/' + dir + '/' + file], { stdio: 'inherit' });
}

const { ACTION_BROWSER } = await import('../apps/relay/src/action/site.js');
execFileSync(process.execPath, ['--check', '--input-type=module'], { input: ACTION_BROWSER, stdio: ['pipe', 'inherit', 'inherit'] });
