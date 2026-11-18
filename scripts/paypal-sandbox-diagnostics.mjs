// Read existing provider diagnostics only. Never print raw events, URLs,
// headers, request bodies, identities, credentials or checkout capabilities.
import { randomUUID } from 'node:crypto';
const token = (process.env.CLOUDFLARE_API_TOKEN || '').trim().replace(/^Bearer\s+/i, '').replace(/^"|"$/g, '').trim();
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !/^[a-f0-9]{32}$/i.test(account || '')) throw Error('Provider audit credentials unavailable');
const to = Date.now(), diagnostic = new Set();
const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/observability/telemetry/query`, {
  method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ queryId: randomUUID(), timeframe: { from: to - 1800000, to }, dry: true, limit: 30, parameters: { view: 'events', needle: { value: 'checkout_order_creation_unconfirmed', matchCase: true } } }),
  redirect: 'error', signal: AbortSignal.timeout(20000),
});
const data = await r.json();
if (!r.ok || data.success === false) {
  console.log(JSON.stringify({ checkout_diagnostics: 'unavailable', http_status: r.status, raw_logs_disclosed: false }));
} else {
  function inspect(value) {
    if (typeof value === 'string' && value.length < 2000 && value.startsWith('{')) {
      try { inspect(JSON.parse(value)); } catch {} return;
    }
    if (!value || typeof value !== 'object') return;
    if (value.event === 'checkout_order_creation_unconfirmed' && /^[a-z_]{1,80}$/.test(value.code || '')) diagnostic.add(value.code);
    for (const item of Object.values(value)) inspect(item);
  }
  inspect(data.result);
  console.log(JSON.stringify({ checkout_diagnostics: 'queried', safe_error_codes: [...diagnostic], raw_logs_disclosed: false }));
}
