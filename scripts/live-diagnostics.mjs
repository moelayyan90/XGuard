import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// Read-only, bounded incident diagnostics. Never log headers, IPs, credentials,
// request bodies, or raw tail records. No deployment or configuration changes.
const token = (process.env.CLOUDFLARE_API_TOKEN || '').replace(/[\r\n]/g, '').trim().replace(/^Bearer\s+/i, '').replace(/^"|"$/g, '').trim();
if (!token) throw new Error('Cloudflare credential unavailable');
const child = spawn('apps/relay/node_modules/.bin/wrangler', ['tail', 'xguard-mainnet', '--format=json', '--config', 'apps/relay/wrangler.jsonc'], {
  env: { ...process.env, CLOUDFLARE_API_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe']
});
let buffer = '', records = 0, stderr = '';
function consume() {
  while (buffer.includes('{')) {
    const start = buffer.indexOf('{'); let depth = 0, quoted = false, escaped = false, end = -1;
    for (let i = start; i < buffer.length; i++) {
      const c = buffer[i];
      if (escaped) { escaped = false; continue; }
      if (quoted && c === '\\') { escaped = true; continue; }
      if (c === '"') { quoted = !quoted; continue; }
      if (!quoted && c === '{') depth++;
      if (!quoted && c === '}' && --depth === 0) { end = i + 1; break; }
    }
    if (end < 0) { buffer = buffer.slice(start); break; }
    const raw = buffer.slice(start, end); buffer = buffer.slice(end);
    try {
      const event = JSON.parse(raw);
      for (const log of event.logs || []) for (const entry of log.message || []) {
        try {
          const data = typeof entry === 'string' ? JSON.parse(entry) : entry;
          if (['live_request_failed', 'shard_error', 'control_error'].includes(data?.event)) {
            const message = String(data.message || '').replaceAll(token, '[redacted]').slice(0,500);
            console.log(JSON.stringify({ event: data.event, message, outcome: event.outcome })); records++;
          }
        } catch { /* Ignore unrelated application logs. */ }
      }
      if (event.outcome && event.outcome !== 'ok') {
        console.log(JSON.stringify({ event: 'runtime_outcome', outcome: event.outcome, exceptions: (event.exceptions || []).map(e => ({ name: e.name, message: String(e.message).replaceAll(token, '[redacted]').slice(0,300) })) })); records++;
      }
    } catch { /* Ignore Wrangler progress and incomplete non-event output. */ }
  }
  if (buffer.length > 2000000) buffer = '';
}
child.stdout.on('data', data => { buffer += data.toString(); consume(); });
child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-12000); });
child.on('error', () => console.log('Diagnostic process could not start.'));
try {
  await delay(10000);
  for (const path of ['/healthz', '/fact/npm/undici/latest-version', '/']) {
    try {
      const response = await fetch('https://xguardgate.com' + path, { headers: { 'user-agent': 'XGuardLive-diagnostics/6.0', accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      await response.body?.cancel(); console.log(JSON.stringify({ probe: path, status: response.status }));
    } catch { console.log(JSON.stringify({ probe: path, status: 'network-error' })); }
  }
  await delay(35000);
} finally {
  child.kill('SIGTERM');
  console.log(JSON.stringify({ diagnostic_records: records, tail_exit: child.exitCode, tail_error_kind: /Authentication error|Unable to authenticate/i.test(stderr) ? 'authentication' : /ERROR/.test(stderr) ? 'tail-error' : null }));
}
