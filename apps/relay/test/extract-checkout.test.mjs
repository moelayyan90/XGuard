import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLivePaid, EXTRACT_SERVICE } from '../src/live/paid-data.ts';
import { validateExtractOffer, EXTRACT_ENDPOINT } from '../src/live/extract-checkout.js';
const recipient = '0x4f32f8fe1ee3e9f5c5a6587dc019a13bb453ba07';
const offer = () => ({ x402Version: 2, resource: { url: EXTRACT_ENDPOINT }, accepts: [{ scheme: 'exact', network: 'eip155:8453', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', payTo: recipient, amount: '12000' }], extensions: { xguard: { paymentIdentifier: 'pay_fixture' } } });
test('checkout rejects changed financial destination, network, asset, price and resource', () => {
  validateExtractOffer(offer(), recipient, '12000');
  for (const change of [x => x.accepts[0].payTo = '0x' + '1'.repeat(40), x => x.accepts[0].amount = '12001', x => x.accepts[0].network = 'eip155:1', x => x.accepts[0].asset = '0x' + '1'.repeat(40), x => x.resource.url += '/other', x => x.accepts.push(x.accepts[0])]) { const x = offer(); change(x); assert.throws(() => validateExtractOffer(x, recipient, '12000')); }
});
test('extraction normalization bounds and binds exact public URLs and explicit budget', () => {
  const n = normalizeLivePaid('extract', EXTRACT_SERVICE.example);
  assert.equal(n.capability, 'live-extract'); assert.equal(n.sources[0].url, 'https://example.com/');
  for (const urls of [[], Array(4).fill('https://example.com/'), ['https://127.0.0.1/'], ['https://a.local/'], ['https://user:pass@example.com/'], ['https://example.com/#fragment'], ['https://example.com/', 'https://example.com/']]) assert.throws(() => normalizeLivePaid('extract', { urls, max_amount_atomic: '12000' }));
});
