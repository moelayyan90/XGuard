import { readFile, writeFile, appendFile } from 'node:fs/promises';
const account = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim(), token = (process.env.CLOUDFLARE_API_TOKEN || '').replace(/[\r\n]/g, '').trim().replace(/^Bearer\s+/i, '').replace(/^"|"$/g, '').trim();
if (!/^[a-f0-9]{32}$/i.test(account) || !token) throw new Error('Cloudflare credentials unavailable');
// Read existing schedules without logging credentials, bindings or response
// headers. The deployment preserves these schedules and all remote variables.
const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/xguard-reconcile/schedules`, { headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
const body = await response.json();
if (!response.ok || !body.success || !Array.isArray(body.result?.crons)) throw new Error('Existing Worker schedules could not be verified');
const crons = body.result.crons.map(x => x.cron);
if (crons.some(x => typeof x !== 'string' || x.length > 100)) throw new Error('Invalid existing schedule');
const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
config.triggers = { ...config.triggers, crons };
await writeFile(new URL('../.deployment-config.json', import.meta.url), JSON.stringify(config, null, 2));
if (process.env.GITHUB_ENV) await appendFile(process.env.GITHUB_ENV, `CLOUDFLARE_API_TOKEN=${token}\nCLOUDFLARE_ACCOUNT_ID=${account}\n`);
console.log(JSON.stringify({ existing_schedule_count: crons.length, schedules_preserved: true, remote_variables_preserved: true }));
