import { AUDIENCE, PROTOCOL, need, AuthorityError, b64, unb64, bytes, verify, digest, checkEnvelope } from './crypto.js';
import { PRICE, LIMITS } from './engine.js';
import { authorityPage } from './page.js';
import { parsePublicJson } from '../core/public-contract.js';
export const BASE = '/v1/authority';
const ACTIONS = ['enroll', 'grant', 'authorize', 'status', 'execute', 'reconcile', 'cancel', 'revoke', 'audit', 'metrics'];
async function admissionKey(env) {
  need(env.LIVE_ADMIN_KEY?.length >= 24, 'organization_admission_unavailable', 503);
  return crypto.subtle.importKey('raw', bytes(env.LIVE_ADMIN_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
const admissionContext = e => bytes(`xguard-afa-tenant-admission/1:${e.mode}:${e.org_id}`);
async function organizationToken(env, envelope) { return b64(await crypto.subtle.sign('HMAC', await admissionKey(env), admissionContext(envelope))); }
async function checkOrganizationToken(request, env, envelope) {
  const token = request.headers.get('x-xguard-organization-token');
  need(token && /^[A-Za-z0-9_-]{43}$/.test(token) && await crypto.subtle.verify('HMAC', await admissionKey(env), unb64(token), admissionContext(envelope)), 'organization_admission_required', 401);
}
export function authorityCatalog() {
  return { name: 'XGuard Agent Financial Authority', protocol: PROTOCOL, status: 'sandbox_operator_enrollment', audience: AUDIENCE,
    scope: 'Public-key agent identities, signed attenuating delegation, atomic shared budget reservations, dispatch fencing, pinned executor settlement evidence and ProofRail receipts. No custody or spending key is created.',
    pricing: { hypothesis_usd: 0.05, amount_atomic: PRICE, currency: 'USDC', market_validated: false, sandbox_charge: '0', live_billing: 'not_activated', assessed_is_not_collected: true, verification_recovery_rejection_retry_fee: '0', merchant_principal: 'separate, unchanged payee', provider_fee: 'explicit caller-signed cap in the principal currency' },
    endpoints: Object.fromEntries(ACTIONS.map(a => [a, `${AUDIENCE}/${a}`])),
    public_key: `${AUDIENCE}/proof-key`, verify_receipt: `${AUDIENCE}/verify-receipt`, openapi: `${AUDIENCE}/openapi.json`, docs: 'https://xguardgate.com/authority',
    integrations: { http: true, openapi: true, mcp_tools: ['xguard.authority.catalog', 'xguard.authority.command', 'xguard.authority.verify_receipt'], a2a_action: 'xguard.authority', x402: 'Existing XGuard x402 services remain available. Authority service-fee collection is not activated; no x402 charge is advertised for the sandbox.', ap2: 'No AP2 conformance or partnership claimed.' },
    limits: LIMITS, identity: 'Key possession only; not KYC or proof of a legal organization.',
    execution: 'An operator-approved private executor binding and pinned attestation key are required. Absent adapter: 503 before dispatch. Sandbox never represents a real settlement.',
    revocation: 'Linearizes before dispatch in the tenant ledger. Does not undo an already dispatched external effect. Unknown effects keep funds reserved until attested reconciliation.',
    capacity: '500 new operations per organization/day; account headroom and executor capacity must be measured separately. Current Cloudflare allowance can block availability.',
    organization_admission: 'Operator enrollment issues a scoped admission token. Supply X-XGuard-Organization-Token with every signed tenant command. It cannot authorize spending by itself; it prevents arbitrary anonymous object creation.',
    security_review: 'Automated test coverage is not an independent security audit.',
  };
}
export const authorityEnvelopeSchema = { type: 'object', additionalProperties: false, required: ['protocol','audience','mode','org_id','action','signer','nonce','issued_at','expires_at','payload','signature'], properties: {
  protocol: { const: PROTOCOL }, audience: { const: AUDIENCE }, mode: { enum: ['sandbox','live'] }, org_id: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,80}$' }, action: { enum: ACTIONS }, signer: { type: 'string' }, nonce: { type: 'string', minLength: 16, maxLength: 80 }, issued_at: { type: 'integer' }, expires_at: { type: 'integer' }, payload: { type: 'object' }, signature: { type: 'string' },
} };
export function authorityPaths() {
  return Object.fromEntries(ACTIONS.map(action => [BASE + '/' + action, { post: { operationId: 'authority_' + action, summary: action + ' an explicitly signed financial authority command', parameters: [{ name: action === 'enroll' ? 'Authorization' : 'X-XGuard-Organization-Token', in: 'header', required: true, schema: { type: 'string' }, description: action === 'enroll' ? 'Existing operator Bearer credential; never delegate this to an agent.' : 'Scoped tenant admission token, in addition to the agent signature.' }], requestBody: { required: true, content: { 'application/json': { schema: authorityEnvelopeSchema } } }, responses: { 200: { description: 'Authenticated command result; sandbox is not a purchase.' }, 400: { description: 'Invalid bounded command' }, 401: { description: 'Invalid or expired identity signature' }, 403: { description: 'Policy, budget or owner check denied' }, 409: { description: 'Conflict; recover using the original operation, do not redispatch' }, 429: { description: 'Resource backpressure' }, 503: { description: 'Storage, signing or executor unavailable; no automatic new execution' } } } }]));
}
export function authorityOpenapi() {
  return { openapi: '3.1.0', info: { title: 'XGuard Agent Financial Authority', version: '1.0.0-sandbox', description: authorityCatalog().scope }, servers: [{ url: 'https://api.xguardgate.com' }], paths: authorityPaths() };
}
const proofStub = env => env.PROOF_AUTHORITY.get(env.PROOF_AUTHORITY.idFromName('proofrail-root-v1'));
export async function receiptFor(env, result) {
  if (!result.operation_id) return null;
  const payload = { protocol: 'xguard-afa-receipt/1', organization_id: result.organization_id, operation_id: result.operation_id, mode: result.mode, state: result.state, intent_digest: result.intent_digest, chain_digest: result.chain_digest, audit_sequence: result.audit_sequence, audit_head: result.audit_head,
    principal: { amount_atomic: result.principal_atomic, currency: result.currency, asset: result.asset, network: result.network, payee: result.payee }, service_fee: result.service_fee,
    provider_fee_cap_atomic: result.provider_fee_cap_atomic, settlement_evidence_sha256: result.settlement ? await digest(result.settlement) : null,
    settlement_scope: result.settlement?.verification_scope || 'No settlement evidence.', retry_execution: false };
  const head = b64(bytes({ alg: 'ES256', typ: 'xguard-afa-receipt+jws', kid: 'did:web:api.xguardgate.com#xguard-proofrail' })), body = b64(bytes(payload));
  const input = head + '.' + body;
  const response = await proofStub(env).fetch('https://proofrail/sign-bytes', { method: 'POST', body: JSON.stringify({ data: b64(bytes(input)) }) });
  const signed = await response.json(); need(response.ok && signed.signature, 'receipt_signing_unavailable', 503);
  return { jws: input + '.' + signed.signature, public_key: `${AUDIENCE}/proof-key`, scope: 'Issuer-signed decision and settlement-evidence digest. Does not by itself prove external funds moved.' };
}
export async function verifyAuthorityReceipt(jws, pinnedKey) {
  try {
    need(typeof jws === 'string' && jws.length <= LIMITS.receipt_bytes, 'invalid_receipt');
    const [head, body, signature, extra] = jws.split('.'); need(!extra && head && body && signature, 'invalid_receipt');
    const decode = part => JSON.parse(new TextDecoder().decode(unb64(part)));
    const header = decode(head), payload = decode(body);
    need(header.alg === 'ES256' && header.typ === 'xguard-afa-receipt+jws' && Object.keys(header).every(k => ['alg','typ','kid'].includes(k)) && payload.protocol === 'xguard-afa-receipt/1', 'invalid_receipt_type');
    need(await verify(head + '.' + body, signature, pinnedKey), 'invalid_receipt_signature');
    return { valid: true, payload, settlement_finality_verified: false };
  } catch { return { valid: false, settlement_finality_verified: false }; }
}
async function readJson(request) {
  need(request.headers.get('content-type')?.split(';')[0].trim() === 'application/json', 'json_required', 415);
  need(Number(request.headers.get('content-length') || 0) <= LIMITS.body, 'request_too_large', 413);
  const reader = request.body?.getReader(); need(reader, 'json_required'); let size = 0, chunks = [];
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > LIMITS.body) { await reader.cancel(); throw new AuthorityError('request_too_large', 413); } chunks.push(value); }
  const merged = new Uint8Array(size); let at = 0; for (const c of chunks) { merged.set(c, at); at += c.length; }
  const parsed = parsePublicJson(new TextDecoder().decode(merged));
  need('value' in parsed, 'invalid_json'); return parsed.value;
}
function decorate(request, env, response) {
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store'); headers.set('x-content-type-options', 'nosniff'); headers.set('referrer-policy', 'no-referrer');
  headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  headers.set('access-control-allow-origin', '*'); headers.set('access-control-allow-methods', 'GET, HEAD, POST, OPTIONS'); headers.set('access-control-allow-headers', 'Content-Type, Authorization, X-XGuard-Organization-Token');
  headers.set('x-xguard-authority', '1.0.0-sandbox');
  if (env.CF_VERSION_METADATA?.tag) headers.set('x-xguard-worker-version-tag', env.CF_VERSION_METADATA.tag);
  if (env.CF_VERSION_METADATA?.id) headers.set('x-xguard-worker-version-id', env.CF_VERSION_METADATA.id);
  return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers });
}
export async function financialAuthorityFetch(request, env) {
  const path = new URL(request.url).pathname;
  if (!(path === '/authority' || path === '/.well-known/xguard-financial-authority.json' || path === BASE || path.startsWith(BASE + '/'))) return null;
  let response;
  try {
    if (request.method === 'OPTIONS') response = new Response(null, { status: 204 });
    else if (['GET','HEAD'].includes(request.method)) {
      if (path === '/authority') response = new Response(authorityPage(), { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" } });
      else if (path === BASE + '/proof-key') { response = await proofStub(env).fetch('https://proofrail/public'); }
      else if (path === BASE + '/openapi.json') response = Response.json(authorityOpenapi());
      else if ([BASE, BASE + '/catalog', '/.well-known/xguard-financial-authority.json'].includes(path)) response = Response.json(authorityCatalog());
      else throw new AuthorityError('authority_route_not_found', 404);
    } else {
      need(request.method === 'POST', 'method_not_allowed', 405);
      const action = path.slice(BASE.length + 1);
      need(ACTIONS.includes(action) || action === 'verify-receipt', 'authority_route_not_found', 404);
      const value = await readJson(request);
      if (action === 'verify-receipt') {
        const key = await (await proofStub(env).fetch('https://proofrail/public')).json();
        response = Response.json(await verifyAuthorityReceipt(value.receipt, key.jwk));
      } else {
        need(env.AUTHORITY, 'authority_storage_unavailable', 503);
        need(value.action === action && /^[A-Za-z0-9_-]{8,80}$/.test(value.org_id) && ['sandbox','live'].includes(value.mode), 'signature_context_mismatch', 401);
        checkEnvelope(value, action, 'sandbox');
        let admin = false;
        if (action === 'enroll') {
          const key = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/)?.[1];
          need(env.LIVE_ADMIN_KEY?.length >= 24 && key && await digest(key) === await digest(env.LIVE_ADMIN_KEY), 'operator_enrollment_required', 403); admin = true;
        } else await checkOrganizationToken(request, env, value);
        const stub = env.AUTHORITY.get(env.AUTHORITY.idFromName(`afa-v1:${value.mode}:${value.org_id}`));
        const r = await stub.fetch('https://authority/afa/v1', { method: 'POST', headers: { 'content-type': 'application/json', 'x-afa-enrollment-authorized': String(admin) }, body: JSON.stringify(value) });
        const body = await r.json();
        if (r.ok && action === 'enroll') body.organization_token = await organizationToken(env, value);
        response = Response.json(r.ok ? { result: body, receipt: await receiptFor(env, body) } : body, { status: r.status });
      }
    }
  } catch (e) { response = Response.json({ error: e instanceof AuthorityError ? e.code : 'authority_dependency_unavailable', new_payment_required: false, retry_execution: false }, { status: e instanceof AuthorityError ? e.status : 503 }); }
  return decorate(request, env, response);
}
