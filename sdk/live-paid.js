import { createPaidAPIClient } from './paid-api.js';
const BASE = 'https://api.xguardgate.com/api/paid/v1';
// The supplied payer must come from an official x402 client with a separately
// authorized wallet. This helper never obtains keys or initiates a new purchase
// after an uncertain response.
export function createLivePaidClient(options = {}) {
  const client = createPaidAPIClient(options);
  return {
    async request(service, input, { idempotencyKey = crypto.randomUUID() } = {}) {
      if (!['batch', 'history', 'compare'].includes(service)) throw new Error('Unknown Live paid service');
      if (!options.maxAmountAtomic) throw new Error('A buyer spending cap is required');
      return client.request(`${BASE}/${service}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey }, body: JSON.stringify({ ...input, max_amount_atomic: String(options.maxAmountAtomic) }) });
    },
    recover: client.recover,
  };
}
const bytes = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(x => x.toString(16).padStart(2, '0')).join('');
export async function verifyLiveDelivery(delivery, publicJwk) {
  try {
    const key = await crypto.subtle.importKey('jwk', publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const receipt = delivery.receipt.signature, jws = receipt.split('.'), proof = delivery.proofrail.proof.split('.');
    const header = JSON.parse(new TextDecoder().decode(bytes(jws[0])));
    if (header.alg !== 'ES256' || header.kid !== publicJwk.kid || jws.length !== 3 || proof.length !== 2) return false;
    const validReceipt = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, bytes(jws[2]), new TextEncoder().encode(`${jws[0]}.${jws[1]}`));
    const validProof = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, bytes(proof[1]), bytes(proof[0]));
    const evidence = JSON.parse(new TextDecoder().decode(bytes(proof[0]))), paid = JSON.parse(new TextDecoder().decode(bytes(jws[1])));
    return validReceipt && validProof && evidence.status === 'succeeded' && evidence.body_sha256 === await digest(JSON.stringify(delivery.result)) && evidence.receipt_signature_sha256 === await digest(receipt) && evidence.transaction === delivery.settlement.transaction && paid.transaction === evidence.transaction;
  } catch { return false; }
}
