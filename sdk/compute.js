function canonicalize(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalize(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function encodePaymentSignatureHeader(value) {
  let binary = '';
  for (const byte of new TextEncoder().encode(JSON.stringify(value))) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const API = 'https://api.xguardgate.com';
export function createComputeClient({ payer, maxAmountAtomic, fetchImpl = fetch, onPaymentPrepared = () => {} }) {
  if (!/^[1-9][0-9]{0,9}$/.test(maxAmountAtomic || '')) throw new Error('Set an explicit USDC atomic spending limit.');
  return {
    async request(kind, input, { idempotencyKey = crypto.randomUUID() } = {}) {
      if (!['inference', 'gpu'].includes(kind)) throw new Error('Unsupported compute kind');
      const body = { ...input, max_amount_atomic: maxAmountAtomic };
      const headers = { 'content-type': 'application/json', 'idempotency-key': idempotencyKey };
      const quoteResponse = await fetchImpl(API + '/v1/' + kind + '/quote', { method: 'POST', headers, body: JSON.stringify(body) });
      if (!quoteResponse.ok) return quoteResponse;
      const q = await quoteResponse.json(), requirements = q.payment?.accepts?.[0];
      const expected = API + '/v1/' + kind + '/execute';
      if (q.payment?.x402Version !== 2 || q.next?.url !== expected || q.payment?.resource?.url !== expected || requirements?.network !== 'eip155:8453' || requirements?.asset?.toLowerCase() !== '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' || !/^[1-9][0-9]*$/.test(requirements.amount || '') || BigInt(requirements.amount) > BigInt(maxAmountAtomic)) throw new Error('Offer does not match this purchase or its budget.');
      const payment = await payer.createPaymentPayload(q.payment);
      const prepared = { quote_id: q.quote_id, quote: q.quote, url: expected, body, idempotency_key: idempotencyKey, payment_signature: encodePaymentSignatureHeader(payment) };
      // Persist before sending. An interrupted purchase must recover this exact
      // quote/authorization rather than signing a fresh one automatically.
      await onPaymentPrepared(prepared);
      return fetchImpl(expected, { method: 'POST', headers: { ...headers, 'X-XGuard-Quote': prepared.quote, 'Payment-Signature': prepared.payment_signature }, body: JSON.stringify(body) });
    },
    recover(prepared) {
      if (!/^xcq_[a-f0-9]{32}$/.test(prepared.quote_id || '')) throw new Error('Invalid quote ID');
      return fetchImpl(API + '/v1/compute/executions/' + prepared.quote_id, { headers: { 'X-XGuard-Quote': prepared.quote } });
    },
  };
}
const decode = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), x => x.charCodeAt(0));
export async function verifyComputeReceipt(delivery, jwk) {
  try {
    const parts = delivery.receipt.split('.');
    if (parts.length !== 3) return false;
    const header = JSON.parse(new TextDecoder().decode(decode(parts[0]))), payload = JSON.parse(new TextDecoder().decode(decode(parts[1])));
    if (header.alg !== 'ES256' || header.kid !== 'did:web:api.xguardgate.com#xguard-proofrail' || payload.typ !== 'xguard-compute-execution' || payload.iss !== API || payload.execution_status !== 'succeeded') return false;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, decode(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]))) return false;
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalize(delivery.result))))).map(x => x.toString(16).padStart(2, '0')).join('');
    return payload.response_digest === hash && payload.quote_id === delivery.quote_id && payload.request_id === delivery.request_id && payload.route === delivery.route && payload.settlement_reference === delivery.settlement?.transaction && canonicalize(payload.accounting) === canonicalize(delivery.accounting);
  } catch { return false; }
}
