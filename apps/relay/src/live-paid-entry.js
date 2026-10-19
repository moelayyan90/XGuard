import { handlePaidWebFetch, recoverOutcome, gatewayConfig, jsonBody, rateLimit, livePaidState, livePaidProofKey, livePaidVerifyReceipt, recordLivePaidDiscovery, recordLivePaidResponse } from './paid-agent-entry.js';
import { LIVE_PAID, PAID_BASE, paidInputSchema, paidResultSchema, normalizeLivePaid, livePaidCapacity } from './live/paid-data.ts';
import { securityHeaders } from './live/security.ts';
import { storageQuotaCode, escape } from './live/util.ts';

const PREFIX = '/api/paid/v1';
const readinessByEnv = new WeakMap();
const response = (data, status = 200) => Response.json(data, { status });

export async function livePaidReadiness(env) {
  let slot = readinessByEnv.get(env);
  if (!slot) { slot = {}; readinessByEnv.set(env, slot); }
  if (slot.value && Date.now() - slot.at < 60000) return slot.value;
  if (!slot.flight) slot.flight = (async () => {
    const config = gatewayConfig(env, false, { capability: 'live-batch' });
    const checks = { enabled: env.LIVE_PAID_SERVICES !== 'off', payment_configuration: config.configured && config.environment === 'production', source_data: false, proof_authority: false, financial_storage: false, facilitator: false };
    const errors = [];
    await Promise.all([
      livePaidCapacity(env, { facts: ['npm/react/latest-version'] }).then(() => { checks.source_data = true; }).catch(e => errors.push(storageQuotaCode(e) || 'live_data_unavailable')),
      livePaidProofKey(env).then(() => { checks.proof_authority = true; }).catch(() => errors.push('proof_authority_unavailable')),
      livePaidState(env, '/live/circuit').then(c => { checks.financial_storage = true; if (c.paused_until > Date.now()) errors.push('paid_circuit_open'); }).catch(e => errors.push(storageQuotaCode(e) || 'financial_storage_unavailable')),
      (async () => {
        if (!config.configured) return;
        try { const r = await fetch(`${config.facilitator}/supported`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000) }); const b = await r.json(); checks.facilitator = r.ok && b?.kinds?.some(k => k.x402Version === 2 && k.scheme === 'exact' && k.network === config.network) === true; } catch {}
        if (!checks.facilitator) errors.push('facilitator_support_unavailable');
      })(),
    ]);
    const value = { ready: Object.values(checks).every(Boolean) && !errors.length, checked_at: new Date().toISOString(), checks, errors: [...new Set(errors)], network: config.network, currency: 'USDC', asset: config.asset, receiving_address: config.payTo, receiving_address_verification: 'Configured receiving address; this check does not prove owner control or a real purchase.', cost_budget: config.economics, real_sale: 'Not established by readiness. Consult authenticated revenue records.', free_service_dependency: false };
    slot.at = Date.now(); slot.value = value; return value;
  })().finally(() => { slot.flight = null; });
  return slot.flight;
}

function catalog(env) {
  return { name: 'XGuard Live additional data services', version: '1.0.0', free_facts: 'https://xguardgate.com/topics', readiness: `${PAID_BASE}/readiness`, public_facts_remain_free: true,
    payment: { protocol: 'x402', version: 2, scheme: 'exact', network: 'eip155:8453', currency: 'USDC', decimals: 6, receiving_address: env.XGUARD_TREASURY_USDC_ADDRESS || null, headers: ['Payment-Required', 'Payment-Signature', 'Payment-Response'], idempotency: 'Preserve Idempotency-Key, original signed quote, payload and payment identifier. Do not sign a new authorization after an uncertain response.', recovery: `${PAID_BASE}/results/{payment_identifier}`, proof_key: `${PAID_BASE}/proof-key`, verify_receipt: `${PAID_BASE}/verify-receipt` },
    services: LIVE_PAID.map(d => ({ ...d, endpoint: `${PAID_BASE}/${d.route}`, method: 'POST', price: { amount_atomic: d.amount, amount: (Number(d.amount) / 1e6).toFixed(6), currency: 'USDC', unit: 'one bounded request', market_validated: false }, availability: env.LIVE_PAID_SERVICES === 'off' ? 'paused' : 'implemented_check_readiness_before_purchase', input_schema: paidInputSchema(d.route), output_schema: paidResultSchema })),
    limits: { request_bytes: 16384, response_bytes: 131072, batch_facts: 20, historical_observations: 300, source_fetches: 0, automatic_new_purchase_retries: 0 },
    instructions: ['Inspect readiness and the exact price.', 'POST the documented JSON with your max_amount_atomic and an 8–128 character Idempotency-Key.', 'On 402 use an official x402 v2 client to sign the exact requirement within the buyer budget.', 'Retry the identical request with Payment-Signature and X-XGuard-Quote.', 'Verify the signed receipt and result digest; recover uncertain results using the original quote without another payment.'],
    accounting: 'Only confirmed independent production settlements establish cash; revenue is recognized after signed delivery. Costs require invoices. Synthetic, internal and same-wallet tests do not establish sales.',
  };
}

async function route(request, env, ctx) {
  const path = new URL(request.url).pathname, relative = path.slice(PREFIX.length);
  const read = request.method === 'GET' || request.method === 'HEAD';
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (read && (relative === '' || relative === '/catalog')) {
    ctx?.waitUntil?.(recordLivePaidDiscovery(request, env).catch(() => {}));
    const value = catalog(env);
    if (request.headers.get('accept')?.includes('text/html') && new URL(request.url).searchParams.get('format') !== 'json') return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>XGuard Live additional data services</title><body><main><h1>XGuard Live additional data services</h1><p>Public facts remain free. Purchase a bounded structured result with USDC on Base using x402.</p><ul>${value.services.map(d => `<li><h2>${escape(d.name)}</h2><p>${escape(d.description)}</p><p>${d.price.amount} USDC per request · ${escape(d.availability)}</p><code>POST ${escape(d.endpoint)}</code><pre>${escape(JSON.stringify(d.example, null, 2))}</pre></li>`).join('')}</ul><p><a href="${PAID_BASE}/readiness">Check payment readiness</a> · <a href="${PAID_BASE}/catalog?format=json">Machine-readable catalog (request application/json)</a> · <a href="https://xguardgate.com/topics">Free public facts</a></p><ol>${value.instructions.map(x => `<li>${escape(x)}</li>`).join('')}</ol></main></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    return response(value);
  }
  if (read && relative === '/readiness') { const value = await livePaidReadiness(env); return response(value, value.ready ? 200 : 503); }
  if (read && relative === '/proof-key') return response(await livePaidProofKey(env));
  const recovery = relative.match(/^\/results\/(pay_[A-Za-z0-9_-]{1,120})$/);
  if (read && recovery) return recoverOutcome(env, recovery[1], request.headers.get('x-xguard-quote') || '', `xgr_${crypto.randomUUID().replaceAll('-', '')}`);
  if (relative === '/verify-receipt' && request.method === 'POST') {
    const { value, error } = await jsonBody(request);
    if (error || typeof value?.receipt !== 'string' || typeof value?.proof !== 'string' || value.receipt.length > 8192 || value.proof.length > 8192) return response({ error: 'invalid_receipt_request' }, 400);
    if (!(await rateLimit(request, env, 'live-receipt-verification', 30)).allowed) return response({ error: 'rate_limited' }, 429);
    return response(await livePaidVerifyReceipt(env, value.receipt, value.proof));
  }
  const definition = LIVE_PAID.find(d => relative === `/${d.route}`);
  if (!definition) return response({ error: 'paid_route_not_found', catalog: `${PAID_BASE}/catalog` }, 404);
  if (request.method !== 'POST') return response({ error: 'method_not_allowed', method: 'POST', input_schema: paidInputSchema(definition.route) }, 405);
  if (env.LIVE_PAID_SERVICES === 'off') return response({ error: 'paid_services_paused', free_facts: 'https://xguardgate.com/topics' }, 503);
  if (!request.headers.get('content-type')?.includes('application/json')) return response({ error: 'json_required' }, 415);
  const { value, error } = await jsonBody(request);
  if (error) return response({ error }, error === 'payload_too_large' ? 413 : 400);
  let input;
  try { input = normalizeLivePaid(definition.route, value); } catch (e) { return response({ error: e.code || 'invalid_paid_input' }, e.status || 400); }
  const key = request.headers.get('idempotency-key') || '';
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(key)) return response({ error: 'idempotency_key_required' }, 400);
  input.idempotency_key = key;
  const readiness = await livePaidReadiness(env);
  if (!readiness.ready) return response({ error: 'paid_service_not_ready', checks: readiness.checks, reasons: readiness.errors, new_payment_required: false }, 503);
  const circuit = await livePaidState(env, '/live/circuit');
  if (circuit.paused_until > Date.now()) return response({ error: 'paid_circuit_open', retry_at: new Date(circuit.paused_until).toISOString(), new_payment_required: false }, 503);
  const result = await handlePaidWebFetch(request, env, `xgr_${crypto.randomUUID().replaceAll('-', '')}`, value, false, 'live-http', input);
  if (result.status >= 500) ctx?.waitUntil?.(livePaidState(env, '/live/health', { failed: true }).catch(() => {}));
  return result;
}

export async function livePaidFetch(request, env, ctx) {
  if (!new URL(request.url).pathname.match(/^\/api\/paid\/v1(?:\/|$)/)) return null;
  const started = Date.now();
  let result;
  try { result = await route(request, env, ctx); }
  catch (e) {
    const code = storageQuotaCode(e) || 'paid_dependency_unavailable';
    console.error(JSON.stringify({ event: 'live_paid_unavailable', code }));
    result = response({ error: code, new_payment_required: false, recovery: `${PAID_BASE}/results/{payment_identifier}` }, 503);
    ctx?.waitUntil?.(livePaidState(env, '/live/health', { failed: true }).catch(() => {}));
  }
  const headers = new Headers(result.headers);
  const service = new URL(request.url).pathname.split('/').at(-1);
  if (request.method === 'POST' && ['batch', 'history', 'compare'].includes(service)) {
    const duration = Date.now() - started;
    ctx?.waitUntil?.(recordLivePaidResponse(request, env, service, result.status, duration).catch(() => {}));
    if (duration > 30000) {
      console.warn(JSON.stringify({ event: 'live_paid_slow_response', service, duration_ms: duration }));
      ctx?.waitUntil?.(livePaidState(env, '/live/health', { failed: true }).catch(() => {}));
    }
  }
  for (const [key, value] of Object.entries(securityHeaders())) if (!headers.has(key)) headers.set(key, value);
  headers.set('cache-control', 'no-store'); headers.set('x-robots-tag', 'noindex');
  headers.set('access-control-allow-origin', '*'); headers.set('access-control-allow-methods', 'GET, HEAD, POST, OPTIONS');
  headers.set('access-control-allow-headers', 'Content-Type, Idempotency-Key, Payment-Signature, X-XGuard-Quote, X-XGuard-Credit');
  headers.set('access-control-expose-headers', 'Payment-Required, Payment-Response, X-XGuard-Quote, X-XGuard-Receipt, X-XGuard-Proof, X-XGuard-Payment-Identifier, X-XGuard-Replay');
  headers.set('x-xguard-live-paid', 'v1');
  if (env.CF_VERSION_METADATA?.tag) headers.set('x-xguard-worker-version-tag', env.CF_VERSION_METADATA.tag);
  return new Response(request.method === 'HEAD' ? null : result.body, { status: result.status, headers });
}
