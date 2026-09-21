function encodePaymentSignatureHeader(payload) {
  let binary = '';
  for (const byte of new TextEncoder().encode(JSON.stringify(payload))) binary += String.fromCharCode(byte);
  return btoa(binary);
}
const API = 'https://api.xguardgate.com';
const ASSET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
function paidUrl(value) {
  const url = new URL(value);
  if (url.origin !== API || !url.pathname.startsWith('/p/') || url.username || url.password || url.hash) throw new Error('Use an XGuard paid API endpoint.');
  return url.href;
}
// One spending decision and one authorization per invocation. No automatic
// resubmission after an uncertain response; recovery is read-only.
export function createPaidAPIClient({ payer, maxAmountAtomic, fetchImpl = globalThis.fetch, onPaymentPrepared, trafficClass } = {}) {
  return {
    async request(endpoint, init = {}) {
      const url = paidUrl(endpoint), method = (init.method || 'GET').toUpperCase();
      const headers = new Headers(init.headers);
      if (headers.has('payment-signature') || headers.has('x-xguard-quote')) throw new Error('Do not inject a previous payment into a new purchase. Use recovery.');
      if (trafficClass) headers.set('x-xguard-traffic-class', trafficClass);
      if (!['GET', 'HEAD'].includes(method) && !headers.has('idempotency-key')) headers.set('idempotency-key', crypto.randomUUID());
      if (init.body != null && typeof init.body !== 'string') throw new Error('Use a fixed string body so the paid retry is byte-identical.');
      const options = { method, headers, body: init.body, redirect: 'error' };
      const first = await fetchImpl(url, options);
      if (first.status !== 402 || !payer) return first;
      // HEAD responses have no body; x402 carries the complete challenge in
      // Payment-Required for every method.
      const challenge = method === 'HEAD'
        ? JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(first.headers.get('payment-required') || ''), char => char.charCodeAt(0))))
        : await first.json();
      const requirement = challenge.accepts?.[0];
      if (!/^[1-9][0-9]{0,8}$/.test(String(maxAmountAtomic || ''))) throw new Error('An explicit positive spending cap is required.');
      if (challenge.x402Version !== 2 || challenge.resource?.url !== url || challenge.accepts?.length !== 1 || requirement.scheme !== 'exact' || requirement.network !== 'eip155:8453' || requirement.asset?.toLowerCase() !== ASSET.toLowerCase() || !/^[1-9][0-9]{0,8}$/.test(requirement.amount || '') || BigInt(requirement.amount) > BigInt(maxAmountAtomic)) throw new Error('Payment requirements exceed the authorized policy. No authorization was created.');
      const quote = first.headers.get('x-xguard-quote'), payment_identifier = challenge.extensions?.xguard?.paymentIdentifier;
      if (!quote || !/^pay_[A-Za-z0-9_-]+$/.test(payment_identifier || '')) throw new Error('Missing signed quote or recovery identifier.');
      const payload = await payer.createPaymentPayload(challenge);
      const recovery = { endpoint: url, quote, payment_identifier, idempotency_key: headers.get('idempotency-key'), amount_atomic: requirement.amount };
      if (onPaymentPrepared) await onPaymentPrepared(recovery);
      headers.set('x-xguard-quote', quote); headers.set('payment-signature', encodePaymentSignatureHeader(payload));
      try { return await fetchImpl(url, { ...options, headers }); }
      catch { const error = new Error('Delivery is uncertain. Recover this payment; do not start another purchase.'); error.recovery = recovery; throw error; }
    },
    async recover({ payment_identifier, quote }) {
      if (!/^pay_[A-Za-z0-9_-]+$/.test(payment_identifier || '') || typeof quote !== 'string' || !quote) throw new Error('Original payment identifier and quote are required.');
      return fetchImpl(`${API}/v1/marketplace/results/${payment_identifier}`, { headers: { 'x-xguard-quote': quote, ...(trafficClass ? { 'x-xguard-traffic-class': trafficClass } : {}) }, redirect: 'error' });
    },
  };
}
