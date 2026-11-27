import { createHash, createPublicKey, verify } from 'node:crypto';

const address = /^0x[0-9a-fA-F]{40}$/;
const transaction = /^0x[0-9a-fA-F]{64}$/;
const decimal = /^[1-9][0-9]{0,77}$/;
const decoder = new TextDecoder('utf-8', { fatal: true });

function requireValue(condition, reason) {
  if (!condition) throw new Error(reason);
}

export const nowSeconds = () => Math.floor(Date.now() / 1000);
export const digest = text => createHash('sha256').update(text, 'utf8').digest('hex');

function atomic(value) {
  requireValue(typeof value === 'string' && decimal.test(value), 'invalid_atomic_amount');
  const n = BigInt(value);
  requireValue(n < (1n << 256n), 'invalid_atomic_amount');
  return n;
}

function evmAddress(value) {
  requireValue(typeof value === 'string' && address.test(value), 'invalid_address');
  return value.toLowerCase();
}

function validResource(value) {
  requireValue(typeof value === 'string' && value.length <= 2048, 'invalid_resource');
  const url = new URL(value);
  requireValue(url.protocol === 'https:' && !url.username && !url.password &&
    !url.search && !url.hash && url.href === value, 'invalid_resource');
  return value;
}

function decode(segment) {
  requireValue(typeof segment === 'string' && /^[A-Za-z0-9_-]+$/.test(segment), 'invalid_jws_encoding');
  const raw = Buffer.from(segment, 'base64url');
  requireValue(raw.toString('base64url') === segment, 'invalid_jws_encoding');
  return raw;
}

// Policy and keys come from the operator's local file. An artifact cannot add a
// key, direct a lookup, or choose which resource a trusted key is authorized for.
export function loadPolicy(raw) {
  requireValue(raw?.version === 1 && /^eip155:[1-9][0-9]{0,17}$/.test(raw.network), 'unsupported_policy');
  const asset = evmAddress(raw.asset);
  const maxPerCall = atomic(raw.maxPerCallAtomic);
  const maxPerDay = atomic(raw.maxPer24hAtomic);
  requireValue(maxPerCall <= maxPerDay, 'invalid_budget');
  requireValue(Array.isArray(raw.resources) && raw.resources.length > 0 && raw.resources.length <= 128, 'invalid_resources');
  const resources = new Map();
  for (const entry of raw.resources) {
    const url = validResource(entry.resourceUrl);
    requireValue(!resources.has(url), 'duplicate_resource');
    const jwk = entry.publicKey;
    requireValue(jwk?.kty === 'EC' && jwk.crv === 'P-256' && !Object.hasOwn(jwk, 'd') &&
      typeof jwk.kid === 'string' && jwk.kid.startsWith('did:') && jwk.kid.length <= 512 &&
      (!jwk.alg || jwk.alg === 'ES256'), 'invalid_pinned_key');
    resources.set(url, {
      recipient: evmAddress(entry.payTo),
      kid: jwk.kid,
      publicKey: createPublicKey({ key: jwk, format: 'jwk' }),
    });
  }
  return { network: raw.network, asset, maxPerCall, maxPerDay, resources };
}

function verifyArtifact(artifact, rule) {
  requireValue(artifact?.format === 'jws' && !Object.hasOwn(artifact, 'payload') &&
    typeof artifact.signature === 'string' && artifact.signature.length <= 16384, 'unsupported_artifact');
  const parts = artifact.signature.split('.');
  requireValue(parts.length === 3, 'invalid_jws');
  const [h, p, s] = parts;
  const header = JSON.parse(decoder.decode(decode(h)));
  requireValue(header?.alg === 'ES256' && header.kid === rule.kid &&
    Object.keys(header).every(k => ['alg', 'kid', 'typ'].includes(k)), 'untrusted_signer_or_header');
  const signature = decode(s);
  requireValue(signature.length === 64 && verify('sha256', Buffer.from(h + '.' + p, 'ascii'),
    { key: rule.publicKey, dsaEncoding: 'ieee-p1363' }, signature), 'invalid_signature');
  const payload = JSON.parse(decoder.decode(decode(p)));
  requireValue(payload?.version === 1, 'unsupported_artifact_version');
  return payload;
}

function ruleFor(policy, resourceUrl) {
  const rule = policy.resources.get(validResource(resourceUrl));
  requireValue(rule, 'resource_not_in_policy');
  return rule;
}

export function reviewOffer(policy, { request, challenge }, now = nowSeconds()) {
  const rule = ruleFor(policy, request?.resourceUrl);
  requireValue(['GET', 'POST'].includes(request.method) && typeof request.body === 'string' &&
    Buffer.byteLength(request.body) <= 65536 && (request.method !== 'GET' || request.body === ''), 'invalid_request');
  requireValue(challenge?.x402Version === 2 && challenge.resource?.url === request.resourceUrl &&
    Array.isArray(challenge.accepts) && challenge.accepts.length === 1, 'unsupported_challenge');
  const offers = challenge.extensions?.['offer-receipt']?.info?.offers;
  requireValue(Array.isArray(offers) && offers.length === 1, 'single_signed_offer_required');
  const artifact = offers[0];
  const p = verifyArtifact(artifact, rule);
  const terms = challenge.accepts[0];
  requireValue(artifact.acceptIndex === undefined || artifact.acceptIndex === 0, 'accept_index_mismatch');
  requireValue(p.resourceUrl === request.resourceUrl && p.scheme === 'exact' && p.network === policy.network &&
    evmAddress(p.asset) === policy.asset && evmAddress(p.payTo) === rule.recipient, 'offer_outside_policy');
  requireValue(terms?.scheme === p.scheme && terms.network === p.network && terms.amount === p.amount &&
    evmAddress(terms.asset) === policy.asset && evmAddress(terms.payTo) === rule.recipient, 'terms_do_not_match_signature');
  requireValue(atomic(p.amount) <= policy.maxPerCall, 'per_call_cap_exceeded');
  requireValue(Number.isSafeInteger(p.validUntil) && p.validUntil > now, 'expired_or_undated_offer');
  const requestHash = digest(JSON.stringify([request.method, request.resourceUrl, request.body]));
  return {
    resourceUrl: p.resourceUrl, network: p.network, asset: policy.asset, payTo: rule.recipient,
    amountAtomic: p.amount, expiresAt: p.validUntil, requestHash,
    offerHash: digest(artifact.signature), termsHash: digest(JSON.stringify(terms)), status: 'reviewed',
  };
}

// Standard receipts attest a merchant statement. They do not sign the amount
// or response body. Compare against independently supplied payer/transaction.
export function reviewReceipt(policy, { expected, settlement }, now = nowSeconds()) {
  const rule = ruleFor(policy, expected?.resourceUrl);
  const payer = evmAddress(expected.payer);
  requireValue(typeof expected.transaction === 'string' && transaction.test(expected.transaction), 'expected_transaction_required');
  const tx = expected.transaction.toLowerCase();
  requireValue(Number.isSafeInteger(expected.notBefore) && expected.notBefore >= 0 &&
    expected.notBefore <= now, 'invalid_receipt_window');
  requireValue(settlement?.success === true && settlement.network === policy.network &&
    typeof settlement.transaction === 'string' && settlement.transaction.toLowerCase() === tx &&
    (settlement.payer === undefined || evmAddress(settlement.payer) === payer), 'settlement_mismatch');
  const artifact = settlement.extensions?.['offer-receipt']?.info?.receipt;
  const p = verifyArtifact(artifact, rule);
  requireValue(p.resourceUrl === expected.resourceUrl && p.network === policy.network &&
    evmAddress(p.payer) === payer && typeof p.transaction === 'string' && p.transaction.toLowerCase() === tx,
    'receipt_context_mismatch');
  requireValue(Number.isSafeInteger(p.issuedAt) && p.issuedAt >= expected.notBefore && p.issuedAt <= now,
    'receipt_outside_window');
  return { status: 'merchant_receipt_verified', resourceUrl: p.resourceUrl, network: p.network,
    issuedAt: p.issuedAt, receiptHash: digest(artifact.signature) };
}
