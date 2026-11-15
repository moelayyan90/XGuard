import { HTTPFacilitatorClient } from '@x402/core/server';
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from '@x402/core/http';
import { declarePaymentIdentifierExtension, extractPaymentIdentifier } from '@x402/extensions/payment-identifier';
import { reconcilePayment } from '../core/reconcile-payment.js';
import { API, ASSET, NETWORK, boundedJson, canonicalize, ceilRatio, digest, fail, id, integer, json, parsed, proofStub, record, sign, stateCall } from './common.js';
import { adapters, candidates, providerCatalog } from './providers.js';
import { computePage } from './page.js';

export const executionPath = kind => '/v1/' + (kind === 'gpu' ? 'gpu' : 'inference') + '/execute';
function paymentConfig(env) {
  const payTo = env.XGUARD_TREASURY_USDC_ADDRESS, facilitator = env.XGUARD_PAID_FACILITATOR || env.X402_BASE_PRIMARY;
  if (env.XGUARD_PAYMENT_ENVIRONMENT !== 'production' || !/^0x[a-fA-F0-9]{40}$/.test(payTo || '') || /^0x0{40}$/i.test(payTo) || !/^https:\/\//.test(facilitator || '') || !env.PAID_GATEWAY || !env.PROOF_AUTHORITY) throw fail('compute_payment_configuration_required', 503);
  return { payTo, facilitator };
}
export function normalizeCompute(kind, value, key) {
  if (!record(value) || !/^[A-Za-z0-9_-]{8,128}$/.test(key || '')) throw fail('idempotency_key_required');
  const common = ['max_amount_atomic', 'preferred_provider', 'payer', 'accept_provider_terms'];
  const allowed = kind === 'inference' ? [...common, 'model', 'messages', 'input', 'max_tokens', 'temperature'] : [...common, 'template', 'gpu_type', 'region', 'duration_seconds', 'image', 'command', 'input'];
  if (Object.keys(value).some(k => !allowed.includes(k))) throw fail('unsupported_compute_parameter');
  if (!/^[1-9][0-9]{0,9}$/.test(value.max_amount_atomic || '')) throw fail('max_amount_atomic_required');
  if (value.accept_provider_terms !== true) throw fail('provider_terms_acceptance_required', 422, { terms: 'https://xguardgate.com/compute#terms' });
  if (value.payer !== undefined && !/^0x[a-fA-F0-9]{40}$/.test(value.payer)) throw fail('invalid_payer');
  if (value.preferred_provider !== undefined && !['openrouter', 'together', 'runpod'].includes(value.preferred_provider)) throw fail('unsupported_provider');
  const input = { kind, max_amount_atomic: value.max_amount_atomic, idempotency_key: key, accept_provider_terms: true, ...(value.preferred_provider ? { preferred_provider: value.preferred_provider } : {}), ...(value.payer ? { payer: value.payer.toLowerCase() } : {}) };
  if (kind === 'inference') {
    if (typeof value.model !== 'string' || value.model.length < 1 || value.model.length > 200 || value.messages && value.input !== undefined) throw fail('invalid_inference_input');
    const messages = value.messages || (typeof value.input === 'string' ? [{ role: 'user', content: value.input }] : null);
    if (!Array.isArray(messages) || !messages.length || messages.length > 32 || messages.some(x => !record(x) || Object.keys(x).some(k => !['role', 'content'].includes(k)) || !['system', 'user', 'assistant'].includes(x.role) || typeof x.content !== 'string' || x.content.length > 8192)) throw fail('text_messages_required');
    const tokens = integer(value.max_tokens, 128, 1, 4096), temperature = value.temperature ?? 0.7;
    if (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 0 || temperature > 2) throw fail('invalid_temperature');
    return { ...input, model: value.model, messages, max_tokens: tokens, temperature };
  }
  if (!['template', 'gpu_type', 'region'].every(k => typeof value[k] === 'string' && value[k].length > 0 && value[k].length <= 150) || !record(value.input || {})) throw fail('gpu_template_required');
  if (value.image !== undefined && (typeof value.image !== 'string' || value.image.length > 300)) throw fail('invalid_image');
  if (value.command !== undefined && (!Array.isArray(value.command) || value.command.length > 16 || value.command.some(x => typeof x !== 'string' || x.length > 200))) throw fail('invalid_command');
  return { ...input, template: value.template, gpu_type: value.gpu_type, region: value.region, duration_seconds: integer(value.duration_seconds, 30, 5, 300), input: value.input || {}, ...(value.image ? { image: value.image } : {}), ...(value.command ? { command: value.command } : {}) };
}
export function priceCompute(env, route, input) {
  const overrides = parsed(env.XGUARD_COMPUTE_MARKUP_RULES), classes = parsed(env.XGUARD_COMPUTE_CUSTOMER_CLASSES);
  const customerClass = input.payer ? classes[input.payer] || 'default' : 'default';
  const ruleKeys = ['customer:' + customerClass, 'task:' + (input.template || input.model), 'gpu:' + input.gpu_type, 'model:' + input.model, 'provider:' + route.provider, 'route:' + (input.kind === 'gpu' ? 'gpu_job_execute' : 'inference_proxy')];
  const rule = ruleKeys.find(k => Object.hasOwn(overrides, k));
  const markupBps = integer(rule ? overrides[rule] : env.XGUARD_COMPUTE_MARKUP_BPS, 2500, 1, 100000);
  const safetyBps = integer(env.XGUARD_COMPUTE_PRICE_SAFETY_BPS, 1000, 0, 10000);
  const upstream = ceilRatio(route.upstream_max_atomic, 10000 + safetyBps);
  const network = integer(env.XGUARD_COMPUTE_PAYMENT_COST_ATOMIC, 0), infrastructure = integer(env.XGUARD_COMPUTE_INFRA_COST_ATOMIC, 100);
  const markup = Math.max(1, ceilRatio(upstream, markupBps));
  const total = upstream + markup + network + infrastructure;
  if (!Number.isSafeInteger(total) || total > integer(env.XGUARD_COMPUTE_REQUEST_CAP_ATOMIC, 1000000, 1)) throw fail('compute_request_spending_cap', 422);
  if (total > Number(input.max_amount_atomic)) throw fail('customer_budget_exceeded', 422, { required_amount_atomic: String(total) });
  return { upstream_cost_bound_atomic: upstream, markup_atomic: markup, markup_bps: markupBps, safety_bps: safetyBps, customer_class: customerClass, customer_price_atomic: total, network_payment_cost_atomic: network, infrastructure_cost_atomic: infrastructure, currency: 'USDC', decimals: 6, price_basis: 'fixed bounded execution; unused cost allowance is part of the disclosed customer price', cost_basis: 'upstream bound plus configured payment and infrastructure cost budgets' };
}
function challenge(q) {
  const paymentIdentifier = declarePaymentIdentifierExtension(true);
  paymentIdentifier.info.id = q.payment_identifier;
  return { x402Version: 2, resource: { url: q.resource, description: q.route, mimeType: 'application/json' }, accepts: [q.requirements], extensions: { 'payment-identifier': paymentIdentifier, xguard: { quote_id: q.quote_id, quote: q.quote } } };
}
function offer(q, status = 402) {
  return json({ quote_id: q.quote_id, quote: q.quote, route: q.route, price: q.price, expires_at: new Date(q.expires_at).toISOString(), payment: challenge(q), next: { method: 'POST', url: q.resource, headers: ['Idempotency-Key', 'X-XGuard-Quote', 'Payment-Signature'], body: 'Retry the original quote input unchanged.', recovery: API + '/v1/compute/executions/' + q.quote_id } }, status, { 'Payment-Required': encodePaymentRequiredHeader(challenge(q)), 'X-XGuard-Quote': q.quote });
}
async function quoted(request, env, input, country, status) {
  paymentConfig(env);
  const metrics = await stateCall(env, 'metrics');
  const routes = await candidates(env, input, country, metrics.providers);
  if (!routes.length) throw fail('no_eligible_compute_provider', 503, { ...providerCatalog(env), country: country || 'unavailable', new_payment_required: false });
  const price = priceCompute(env, routes[0], input);
  const compatible = routes.filter(r => r.upstream_max_atomic <= price.upstream_cost_bound_atomic);
  const quoteId = id('xcq_'), requestId = id('xcr_'), paymentId = id('pay_');
  const resource = API + executionPath(input.kind), { payTo, facilitator } = paymentConfig(env);
  const inputDigest = await digest(input), expires = Date.now() + 120000;
  const requirements = { scheme: 'exact', network: NETWORK, asset: ASSET, amount: String(price.customer_price_atomic), payTo, maxTimeoutSeconds: 120, extra: { name: 'USD Coin', version: '2', quoteId, inputDigest } };
  const route = input.kind === 'gpu' ? 'gpu_job_execute' : 'inference_proxy';
  const payload = { typ: 'xguard-compute-quote', iss: API, aud: resource, quote_id: quoteId, request_id: requestId, route, input_digest: inputDigest, payment_identifier: paymentId, requirements, price, issued_at: Math.floor(Date.now() / 1000), expires_at: Math.floor(expires / 1000), terms: 'https://xguardgate.com/compute#terms' };
  const quote = await sign(env, payload);
  const declared = request.headers.get('x-xguard-traffic-class');
  const trafficClass = ['synthetic', 'canary', 'self_test', 'internal', 'testnet'].includes(declared) ? declared : 'external';
  const q = { quote_id: quoteId, request_id: requestId, route, resource, input, input_digest: inputDigest, country, price, routes: compatible, requirements, facilitator, quote, payment_identifier: paymentId, expires_at: expires, traffic_class: trafficClass };
  await stateCall(env, 'quote', { record: q });
  return offer(q, status);
}
async function financialMarker(env, q, auth, fingerprint) {
  // Use the SAME nonce-named operation object as existing XGuard payments. Its
  // begin CAS prevents reusing an authorization on compute and legacy routes.
  const stub = env.PAID_GATEWAY.get(env.PAID_GATEWAY.idFromName('payment:' + fingerprint));
  const r = await stub.fetch('https://paid-gateway/operation/begin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request_id: q.request_id, payment_identifier: q.payment_identifier, authorization_fingerprint: fingerprint, request_digest: q.input_digest, quote_id: q.quote_id, tool: 'xguard.compute', compute_managed: true, input: { compute_only: true }, payer: auth.from.toLowerCase(), nonce: auth.nonce.toLowerCase(), network: NETWORK, asset: ASSET, amount: q.requirements.amount, environment: 'production' }) });
  if (!r.ok) throw fail('authorization_already_used', 409);
}
async function paid(env, q, signature) {
  const payment = decodePaymentSignatureHeader(signature), auth = payment?.payload?.authorization;
  if (payment.x402Version !== 2 || canonicalize(payment.accepted) !== canonicalize(q.requirements) || payment.resource?.url !== q.resource || extractPaymentIdentifier(payment, true) !== q.payment_identifier || !/^0x[a-fA-F0-9]{40}$/.test(auth?.from || '') || !/^0x[a-fA-F0-9]{64}$/.test(auth?.nonce || '') || String(auth.to).toLowerCase() !== q.requirements.payTo.toLowerCase() || String(auth.value) !== q.requirements.amount || !(Number(auth.validAfter) <= Date.now() / 1000 && Number(auth.validBefore) > Date.now() / 1000) || q.input.payer && q.input.payer !== auth.from.toLowerCase()) throw fail('payment_binding_mismatch');
  const facilitator = new HTTPFacilitatorClient({ url: q.facilitator, timeoutMs: 10000 });
  let verification;
  try { verification = await facilitator.verify(payment, q.requirements); } catch { throw fail('payment_verifier_unavailable', 503); }
  if (!verification.isValid || verification.payer && verification.payer.toLowerCase() !== auth.from.toLowerCase()) throw fail('payment_invalid', 402);
  const fingerprint = await digest(`${NETWORK}|${ASSET.toLowerCase()}|${auth.from.toLowerCase()}|${auth.nonce.toLowerCase()}`);
  await financialMarker(env, q, auth, fingerprint);
  const evidence = { payer: auth.from.toLowerCase(), nonce: auth.nonce.toLowerCase(), pay_to: q.requirements.payTo, amount: q.requirements.amount, asset: ASSET, network: NETWORK, require_finality: true };
  const primary = adapters(env).find(a => a.id === q.routes[0].provider);
  const claimed = await stateCall(env, 'claim-payment', { quote_id: q.quote_id, request_key: await digest(auth.from.toLowerCase() + ':' + q.input.idempotency_key), payment: evidence, budgets: primary.policy });
  if (!claimed.claimed) return claimed.record;
  let settlement;
  try { settlement = await facilitator.settle(payment, q.requirements); }
  catch { return (await stateCall(env, 'transition', { quote_id: q.quote_id, from: 'PAYMENT_PENDING', to: 'SETTLEMENT_UNKNOWN', reason: 'settlement_response_unknown' })).record; }
  if (settlement?.success !== true || settlement.network !== NETWORK || !/^0x[a-fA-F0-9]{64}$/.test(settlement.transaction || '')) {
    return (await stateCall(env, 'transition', { quote_id: q.quote_id, from: 'PAYMENT_PENDING', to: 'SETTLEMENT_UNKNOWN', reason: 'settlement_not_confirmed' })).record;
  }
  // Settlement is claimed once. Recovery only reads the chain; it never calls
  // settle again, including when a response or the Worker itself was lost.
  const confirmed = await reconcilePayment(env, { ...evidence, observed_transaction: settlement.transaction });
  return (await stateCall(env, 'transition', { quote_id: q.quote_id, from: 'PAYMENT_PENDING', to: confirmed ? 'SETTLED' : 'SETTLEMENT_UNKNOWN', observed_transaction: settlement.transaction, settlement: confirmed, reason: confirmed ? null : 'chain_confirmation_pending' })).record;
}
function view(q) {
  const result = { request_id: q.request_id, quote_id: q.quote_id, route: q.route, status: q.status, price: q.price, ...(q.status === 'SUCCEEDED' ? { result: q.result, receipt: q.receipt, accounting: q.accounting } : {}), ...(q.settlement ? { settlement: q.settlement } : {}), ...(q.reason ? { reason: q.reason } : {}), ...(q.refund_state ? { refund_state: q.refund_state } : {}), new_payment_required: false, recovery: API + '/v1/compute/executions/' + q.quote_id };
  const headers = q.status === 'SUCCEEDED' ? { 'X-XGuard-Receipt': q.receipt, 'Payment-Response': encodePaymentResponseHeader(q.settlement) } : {};
  return json(result, q.status === 'SUCCEEDED' ? 200 : ['REFUND_REQUIRED', 'EXECUTION_UNKNOWN', 'PAYMENT_FAILED'].includes(q.status) ? 409 : 202, headers);
}
async function deliver(env, q) {
  const cost = q.upstream.cost_atomic;
  const unitMargin = cost === null ? null : q.price.customer_price_atomic - cost - q.price.network_payment_cost_atomic - q.price.infrastructure_cost_atomic;
  const net = q.revenue_eligible ? unitMargin : null;
  const accounting = { gross_revenue_atomic: q.revenue_eligible ? q.price.customer_price_atomic : 0, settled_payment_volume_atomic: q.price.customer_price_atomic, revenue_class: q.revenue_eligible ? 'external_production_settlement' : 'self_or_declared_test_non_revenue', upstream_cost_atomic: cost, network_payment_cost_atomic: q.price.network_payment_cost_atomic, infrastructure_cost_atomic: q.price.infrastructure_cost_atomic, net_margin_atomic: net, unit_margin_estimate_atomic: unitMargin, margin_percentage: net === null ? null : net / q.price.customer_price_atomic * 100, currency: 'USDC', decimals: 6, upstream_cost_basis: q.upstream.cost_basis, net_margin_basis: 'provider-reported accrual minus configured direct cost budgets; requires invoice reconciliation for realized net profit', positive_margin_proven: false, cost_bound_exceeded: cost !== null && cost > q.price.upstream_cost_bound_atomic };
  if (accounting.cost_bound_exceeded) console.error(JSON.stringify({ event: 'compute_provider_cost_bound_breached', provider: q.provider, quote_id: q.quote_id }));
  const receipt = await sign(env, { typ: 'xguard-compute-execution', iss: API, request_id: q.request_id, quote_id: q.quote_id, route: q.route, model_or_gpu: q.input.model || q.input.gpu_type, provider_class: q.input.kind, provider: q.provider, timestamp: new Date().toISOString(), customer_price_atomic: q.price.customer_price_atomic, execution_status: 'succeeded', response_digest: q.response_digest, settlement_reference: q.settlement.transaction, accounting });
  return (await stateCall(env, 'deliver', { quote_id: q.quote_id, receipt, accounting })).record;
}
async function resume(env, q, country) {
  if (['PAYMENT_PENDING', 'SETTLEMENT_UNKNOWN'].includes(q.status)) {
    const confirmed = await reconcilePayment(env, q.payment);
    if (!confirmed) return view(q);
    q = (await stateCall(env, 'transition', { quote_id: q.quote_id, from: q.status, to: 'SETTLED', settlement: confirmed })).record;
  }
  if (q.status === 'DELIVERY_PENDING') return view(await deliver(env, q));
  if (q.status === 'RUNNING') {
    const adapter = adapters(env).find(a => a.id === q.provider);
    if (!adapter?.eligible(country)) return view(q);
    try {
      const upstream = await adapter.usage(q.upstream, q.provider_quote);
      if (upstream.completed) q = (await stateCall(env, 'accepted', { quote_id: q.quote_id, claim_token: q.claim_token, provider: q.provider, provider_quote: q.provider_quote, upstream, response_digest: await digest(upstream.result) })).record;
    } catch (e) { if (e.code === 'gpu_job_failed') q = (await stateCall(env, 'transition', { quote_id: q.quote_id, from: 'RUNNING', to: 'REFUND_REQUIRED', reason: e.code })).record; }
    return q.status === 'DELIVERY_PENDING' ? view(await deliver(env, q)) : view(q);
  }
  if (q.status !== 'SETTLED') return view(q);
  const claim = await stateCall(env, 'claim-execution', { quote_id: q.quote_id });
  if (!claim.claimed) return view(claim.record);
  q = claim.record;
  for (const route of q.routes) {
    const adapter = adapters(env).find(a => a.id === route.provider);
    if (!adapter?.eligible(country)) continue;
    let current;
    try { current = await adapter.quote(q.input); }
    catch { continue; }
    if (current.upstream_max_atomic > q.price.upstream_cost_bound_atomic) continue;
    try { await stateCall(env, 'reserve-attempt', { quote_id: q.quote_id, claim_token: q.claim_token, provider: route.provider, cost_atomic: current.upstream_max_atomic, budgets: adapter.policy }); }
    catch { continue; }
    let upstream;
    try { upstream = await adapter.execute(q.input, current, q.request_id); }
    catch (e) {
      if (e.details?.rejected_before_execution === true) { await stateCall(env, 'reject-attempt', { quote_id: q.quote_id, claim_token: q.claim_token, provider: route.provider }); continue; }
      q = (await stateCall(env, 'transition', { quote_id: q.quote_id, from: 'EXECUTING', to: e.details?.ambiguous === true ? 'EXECUTION_UNKNOWN' : 'REFUND_REQUIRED', reason: e.code || 'provider_execution_failed' })).record;
      return view(q);
    }
    q = (await stateCall(env, 'accepted', { quote_id: q.quote_id, claim_token: q.claim_token, provider: route.provider, provider_quote: current, upstream, response_digest: upstream.completed ? await digest(upstream.result) : null })).record;
    return q.status === 'DELIVERY_PENDING' ? view(await deliver(env, q)) : view(q);
  }
  q = (await stateCall(env, 'transition', { quote_id: q.quote_id, from: 'EXECUTING', to: 'REFUND_REQUIRED', reason: 'no_provider_within_paid_cost_bound' })).record;
  return view(q);
}
async function route(request, env, context) {
  const url = new URL(request.url), path = url.pathname, read = ['GET', 'HEAD'].includes(request.method);
  const country = context?.country || request.cf?.country || '';
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (read && path === '/compute') return new Response(computePage(providerCatalog(env)), { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'" } });
  if (read && path === '/v1/compute/providers') return json(providerCatalog(env));
  if (read && path === '/v1/compute/proof-key') {
    const r = await proofStub(env).fetch('https://proofrail/public'); return json(await r.json(), r.status);
  }
  if (read && path === '/v1/compute/metrics') {
    const key = env.LIVE_ADMIN_KEY || env.XGUARD_OPERATOR_KEY;
    if (!key || key.length < 24 || request.headers.get('authorization') !== 'Bearer ' + key) throw fail('operator_authentication_required', 401);
    return json(await stateCall(env, 'metrics'));
  }
  if (read && path === '/v1/compute/health') {
    const catalog = providerCatalog(env), checks = await Promise.all(adapters(env).map(a => a.health()));
    let payment = false; try { paymentConfig(env); payment = true; } catch {}
    const ready = env.XGUARD_COMPUTE_ENABLED === 'on' && payment && checks.some(x => x.healthy);
    return json({ service: 'XGuard Compute', ready, payment_configured: payment, provider_checks: checks, ...catalog, real_canary: 'not_established_by_health', canary_evidence: 'See authenticated execution receipts and reconciled costs.' }, ready ? 200 : 503);
  }
  if (read && ['/v1/compute/models', '/v1/compute/availability'].includes(path)) {
    const models = [];
    for (const adapter of adapters(env)) {
      if (!adapter.eligible(country)) continue;
      try { models.push(...(await adapter.models()).map(m => ({ id: m.id, provider: adapter.id, kind: adapter.definition.kind, eligible_country: country }))); } catch {}
    }
    return json({ models, country: country || 'unavailable', providers: providerCatalog(env), pricing: 'Request an input-bound quote; model names are never substituted during failover.' });
  }
  const recovery = path.match(/^\/v1\/compute\/(?:executions|receipts)\/(xcq_[a-f0-9]{32})$/);
  if (recovery && read) {
    const q = (await stateCall(env, 'get', { quote_id: recovery[1] })).record;
    if (request.headers.get('x-xguard-quote') !== q.quote) throw fail('execution_not_found', 404);
    return resume(env, q, country);
  }
  const match = path.match(/^\/v1\/(inference|gpu)\/(quote|execute)$/);
  if (!match && path !== '/v1/compute/route') throw fail('compute_route_not_found', 404);
  if (request.method !== 'POST') throw fail('method_not_allowed', 405);
  if (env.XGUARD_COMPUTE_ENABLED !== 'on') throw fail('compute_activation_required', 503, { ...providerCatalog(env), new_payment_required: false });
  if (!request.headers.get('content-type')?.includes('application/json')) throw fail('json_required', 415);
  const raw = await boundedJson(request, 16384), kind = match?.[1] || (raw.route === 'gpu_job_execute' ? 'gpu' : 'inference');
  if (!match) delete raw.route;
  const input = normalizeCompute(kind, raw, request.headers.get('idempotency-key'));
  const token = request.headers.get('x-xguard-quote');
  if (match?.[2] === 'quote' || !token) return quoted(request, env, input, country, match?.[2] === 'execute' ? 402 : 200);
  let payload; try { payload = JSON.parse(atob(token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/'))); } catch { throw fail('invalid_quote'); }
  if (!/^xcq_[a-f0-9]{32}$/.test(payload.quote_id || '')) throw fail('invalid_quote');
  let q = (await stateCall(env, 'get', { quote_id: payload.quote_id })).record;
  if (q.quote !== token || q.input_digest !== await digest(input) || q.input.kind !== kind || q.country !== country) throw fail('quote_request_mismatch');
  if (q.status !== 'QUOTED') return resume(env, q, country);
  if (q.expires_at <= Date.now()) throw fail('quote_expired', 409, { new_payment_required: false, request_fresh_quote: true });
  // Reprice before collecting money. A moved price cannot consume the old offer.
  const adapter = adapters(env).find(a => a.id === q.routes[0].provider);
  if (!adapter?.eligible(country)) throw fail('provider_eligibility_changed', 503);
  if (!(await adapter.health({ fresh: true })).healthy) throw fail('provider_not_ready_for_payment', 503);
  let fresh;
  try { fresh = await adapter.quote(input); } catch { throw fail('requote_required', 409, { new_payment_required: false }); }
  if (fresh.upstream_max_atomic > q.price.upstream_cost_bound_atomic) throw fail('requote_required', 409, { new_payment_required: false });
  const signature = request.headers.get('payment-signature');
  if (!signature) return offer(q);
  try { q = await paid(env, q, signature); } catch (e) { if (!e.code) throw fail('invalid_payment_payload'); throw e; }
  return resume(env, q, country);
}
export async function computeFetch(request, env, context = {}) {
  const path = new URL(request.url).pathname;
  if (!(path === '/compute' || /^\/v1\/(?:compute(?:\/|$)|inference(?:\/|$)|gpu(?:\/|$))/.test(path))) return null;
  let result;
  try { result = await route(request, env, context); }
  catch (e) { result = json({ error: e.code || 'compute_dependency_unavailable', details: e.details || {}, new_payment_required: false }, e.status || 503); }
  const headers = new Headers(result.headers);
  headers.set('cache-control', 'no-store'); headers.set('x-content-type-options', 'nosniff'); headers.set('access-control-allow-origin', '*');
  headers.set('access-control-allow-methods', 'GET, HEAD, POST, OPTIONS');
  headers.set('access-control-allow-headers', 'Content-Type, Idempotency-Key, X-XGuard-Quote, Payment-Signature, Authorization');
  headers.set('access-control-expose-headers', 'Payment-Required, Payment-Response, X-XGuard-Quote, X-XGuard-Receipt, X-XGuard-Worker-Version-Tag');
  if (env.CF_VERSION_METADATA?.tag) headers.set('x-xguard-worker-version-tag', env.CF_VERSION_METADATA.tag);
  return new Response(request.method === 'HEAD' ? null : result.body, { status: result.status, headers });
}
