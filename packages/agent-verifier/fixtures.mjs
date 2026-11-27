import { generateKeyPairSync, sign } from 'node:crypto';
import { nowSeconds } from './verify.mjs';

// Ephemeral merchant signing key for the offline demo and test vectors.
// Every address and transaction in these fixtures is illustrative.
export function fixture(host = 'books.example', now = nowSeconds()) {
  const key = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const publicKey = { ...key.publicKey.export({ format: 'jwk' }), kid: 'did:web:' + host + '#merchant' };
  function signed(payload, headers = {}) {
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const message = encode({ alg: 'ES256', kid: publicKey.kid, ...headers }) + '.' + encode(payload);
    const signature = sign('sha256', Buffer.from(message), { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
    return { format: 'jws', signature: message + '.' + signature.toString('base64url') };
  }
  const resourceUrl = 'https://' + host + '/records';
  const payTo = '0x' + '12'.repeat(20);
  const asset = '0x' + '34'.repeat(20);
  const network = 'eip155:84532';
  const transaction = '0x' + 'ab'.repeat(32);
  const payer = '0x' + '56'.repeat(20);
  const terms = { scheme: 'exact', network, asset, payTo, amount: '1000' };
  const offer = { version: 1, resourceUrl, ...terms, validUntil: now + 300 };
  const receipt = { version: 1, resourceUrl, network, payer, transaction, issuedAt: now };
  const policy = { version: 1, network, asset, maxPerCallAtomic: '1000', maxPer24hAtomic: '1500',
    resources: [{ resourceUrl, payTo, publicKey }] };
  const offerInput = { request: { method: 'POST', resourceUrl, body: '{"record":"example"}' },
    challenge: { x402Version: 2, resource: { url: resourceUrl }, accepts: [terms],
      extensions: { 'offer-receipt': { info: { offers: [{ ...signed(offer), acceptIndex: 0 }] } } } } };
  const receiptInput = { expected: { resourceUrl, payer, transaction, notBefore: now - 30 },
    settlement: { success: true, network, payer, transaction,
      extensions: { 'offer-receipt': { info: { receipt: signed(receipt) } } } } };
  return { policy, offerInput, receiptInput, offer, receipt, signed };
}
