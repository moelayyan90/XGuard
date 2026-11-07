import relay from './index.js';
import { inspectPayment } from './core/payment-context.js';
import { securityHeaders } from './live/security.ts';

export const FACILITATOR_IDENTITY = {
  name: 'XGuard',
  description: 'XGuard — Secretless Agent Gateway with an x402 v2 facilitator/settlement compatibility surface.',
  role: 'facilitator', protocol: 'x402', x402Version: 2,
  scheme: 'exact', network: 'eip155:8453', networkName: 'Base Mainnet',
  website: 'https://xguardgate.com', canonicalSite: 'https://xguardgate.com',
  api: 'https://api.xguardgate.com', canonicalApi: 'https://api.xguardgate.com',
  operator: { name: 'Mohammad Elayyan', contact: 'mo.elayyan2023@gmail.com' },
  repository: 'https://github.com/moelayyan90/XGuard',
  identity: 'https://xguardgate.com/identity',
  endpoints: {
    supported: 'https://api.xguardgate.com/supported',
    verify: 'https://api.xguardgate.com/verify',
    settle: 'https://api.xguardgate.com/settle',
  },
  settlement: 'Non-custodial compatibility gateway to configured upstream facilitators. XGuard does not publish or claim a local settlement signer. Existing payment verification, quota admission and durable replay protection apply.',
};

const DISCOVERY = new Set(['/facilitator', '/.well-known/x402', '/.well-known/x402.json', '/.well-known/x402-facilitator.json']);
const HEADERS = {
  ...securityHeaders(),
  'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
  'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, x-xguard-key',
  'x-content-type-options': 'nosniff',
};
const json = (body, status = 200, extra = {}) => Response.json(body, { status, headers: { ...HEADERS, ...extra } });

export async function facilitatorSurface(request, env) {
  const path = new URL(request.url).pathname;
  if (!DISCOVERY.has(path) && !['/supported', '/verify', '/settle'].includes(path)) return null;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS });
  if (DISCOVERY.has(path) || path === '/supported') {
    if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'method_not_allowed' }, 405, { allow: 'GET, HEAD, OPTIONS' });
    // The configured production Base upstream advertises this exact v2 kind.
    // Advertise only the restored compatibility contract; no upstream signer is
    // represented as an XGuard-controlled key, and no v1/testnet kinds leak in.
    const body = path === '/supported'
      ? { kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453' }], extensions: [], signers: {} }
      : FACILITATOR_IDENTITY;
    return request.method === 'HEAD' ? new Response(null, { status: 200, headers: HEADERS }) : json(body);
  }
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST, OPTIONS' });
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return json({ error: 'expected_application_json' }, 415);
  if (Number(request.headers.get('content-length') || 0) > 131072) return json({ error: 'body_too_large' }, 413);
  // Bound the stream before parsing or accessing any financial state/upstream.
  const reader = request.body?.getReader(); let bytes = 0; const chunks = [];
  if (reader) while (true) {
    const { done, value } = await reader.read(); if (done) break;
    bytes += value.byteLength;
    if (bytes > 131072) { await reader.cancel(); return json({ error: 'body_too_large' }, 413); }
    chunks.push(value);
  }
  const buffer = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  let body; try { body = JSON.parse(new TextDecoder().decode(buffer)); }
  catch { return json({ error: 'invalid_json' }, 400); }
  const inspection = inspectPayment(body);
  if (!inspection.ok) return json(path === '/verify'
    ? { isValid: false, invalidReason: inspection.reason }
    : { success: false, errorReason: inspection.reason }, 400);
  if (inspection.network !== 'eip155:8453' || inspection.scheme !== 'exact') return json({ error: 'unsupported_payment_kind' }, 400);
  try {
    // Restore the existing verified relay, including fresh verify-before-settle,
    // durable receipts, admission, and fail-closed ambiguous outcome handling.
    const response = await relay.fetch(new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(inspection.body) }), env);
    if (response.status >= 300 && response.status < 400) return json({ error: 'upstream_redirect_rejected' }, 502);
    const result = await response.json().catch(() => null);
    if (!result || typeof result !== 'object') return json({ error: 'invalid_upstream_response' }, 502);
    return new Response(JSON.stringify(result), { status: response.status, headers: { ...Object.fromEntries(response.headers), ...HEADERS } });
  } catch { return json({ error: 'facilitator_unavailable' }, 503); }
}
