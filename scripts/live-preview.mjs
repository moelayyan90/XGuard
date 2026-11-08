import { spawn } from 'node:child_process';
const args = process.argv.slice(2);
const value = name => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
const host = value('--host') || process.env.HOST || '0.0.0.0';
const port = value('--port') || process.env.PORT || '5173';
if (!/^\d{2,5}$/.test(port) || !['0.0.0.0', '127.0.0.1', 'localhost'].includes(host)) throw Error('Invalid local preview address');
const child = spawn('apps/relay/node_modules/.bin/wrangler', ['dev', 'scripts/preview-entry.js', '--config', 'apps/relay/wrangler.jsonc', '--local', '--ip', host, '--port', port, '--local-upstream', 'xguardgate.com', '--var', 'LIVE_BOOTSTRAP:off', '--var', 'LIVE_SOURCE_FETCHES:off', '--var', 'LIVE_NETWORK_DISCOVERY:off'], { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 1));
