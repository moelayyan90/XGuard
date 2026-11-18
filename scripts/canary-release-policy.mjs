import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const recoveryFiles = new Set(['apps/relay/src/live/openapi.ts', 'apps/relay/src/live/paid-data.ts', 'apps/relay/src/c2sp-witness.js', 'apps/relay/package.json', 'apps/relay/package-lock.json']);
export function selectCanary(files, rollbackAllowed) {
  const recovery = files.some(file => recoveryFiles.has(file));
  // Tests do not upload settlement code. Any change to its runtime, config or
  // dependencies still requires the coordinated deployment path.
  const coordinated = files.some(file => file === 'apps/relay/wrangler.jsonc' || file.startsWith('apps/billing/') || (file.startsWith('apps/settlement-gateway/') && !file.startsWith('apps/settlement-gateway/test/')));
  const compatible = rollbackAllowed === true && !coordinated;
  if (recovery && !compatible) throw new Error('Live recovery requires a compatible code-only canary. No deployment was attempted.');
  const runtime = files.some(file => file.startsWith('apps/relay/src/') || file === 'server.json' || recoveryFiles.has(file));
  return { gradual: compatible && runtime, live_recovery: recovery && compatible };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [previous, current] = process.argv.slice(2);
  if (!previous || !current) throw new Error('Previous and current source commits are required');
  const files = execFileSync('git', ['diff', '--name-only', '-z', previous, current], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const result = selectCanary(files, process.env.ROLLBACK_ALLOWED === 'true');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(result).map(([key, value]) => `${key}=${value}\n`).join(''));
  console.log(JSON.stringify(result));
}
