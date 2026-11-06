import { x402Client } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { encodePaymentSignatureHeader } from '@x402/core/http';
import { createWalletClient, custom } from 'viem';
import { verifyLiveDelivery } from '../../../../sdk/live-paid.js';

export const EXTRACT_ENDPOINT = 'https://api.xguardgate.com/api/paid/v1/extract';
const ASSET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export function validateExtractOffer(offer, recipient, cap) {
  const r = offer?.accepts?.[0];
  if (offer?.x402Version !== 2 || offer.resource?.url !== EXTRACT_ENDPOINT || offer.accepts?.length !== 1 || r.scheme !== 'exact' || r.network !== 'eip155:8453' || r.asset?.toLowerCase() !== ASSET.toLowerCase() || r.payTo?.toLowerCase() !== recipient.toLowerCase() || !/^[1-9][0-9]{0,8}$/.test(r.amount || '') || !/^[1-9][0-9]{0,8}$/.test(String(cap)) || BigInt(r.amount) > BigInt(cap)) throw new Error('Payment offer does not match the displayed network, recipient or spending limit.');
  if (!/^pay_[A-Za-z0-9_-]+$/.test(offer.extensions?.xguard?.paymentIdentifier || '')) throw new Error('Payment offer has no recovery identifier.');
  return r;
}

// Browser wallets retain the private key. Persist an authorization BEFORE sending
// it so a network interruption cannot cause a second signature or new purchase.
export function createExtractionCheckout({ recipient, cap = '12000', fetchImpl = globalThis.fetch, save, load } = {}) {
  let pending = load?.() || null;
  const persist = value => { save?.(value); pending = value; };
  async function deliver(response) {
    const value = await response.json();
    if (response.ok) {
      const keyResponse = await fetchImpl('https://api.xguardgate.com/api/paid/v1/proof-key', { headers: {}, redirect: 'error' });
      if (!keyResponse.ok || !await verifyLiveDelivery(value, (await keyResponse.json()).jwk)) throw new Error('Delivery signature could not be verified. Recover the original purchase.');
      persist(null); return value;
    }
    const error = new Error(value.error?.message || value.error_code || value.error || 'Delivery is uncertain. Recover the existing purchase.');
    const credit = value.error?.details?.execution_credit;
    if (typeof credit === 'string' && pending) persist({ ...pending, state: 'credited', credit });
    error.response = value; throw error;
  }
  return {
    pending: () => pending,
    async quote(urls) {
      if (pending && pending.state !== 'quoted') throw new Error('Recover or retry the existing paid operation before starting another purchase.');
      if (!Array.isArray(urls) || urls.length < 1 || urls.length > 3 || new Set(urls).size !== urls.length) throw new Error('Enter 1–3 different public HTTPS URLs.');
      for (const raw of urls) { const u = new URL(raw); if (u.protocol !== 'https:' || u.username || u.password || u.hash) throw new Error('Use public HTTPS URLs without credentials or fragments.'); }
      const body = JSON.stringify({ urls, max_amount_atomic: String(cap) }), key = crypto.randomUUID();
      const response = await fetchImpl(EXTRACT_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body, redirect: 'error' });
      const offer = await response.json();
      if (response.status !== 402) throw new Error(offer.error || offer.error_code || 'Purchase is unavailable. No payment was authorized.');
      validateExtractOffer(offer, recipient, cap);
      const quote = response.headers.get('x-xguard-quote');
      if (!quote) throw new Error('Missing signed quote.');
      persist({ state: 'quoted', endpoint: EXTRACT_ENDPOINT, body, key, quote, offer, payment_identifier: offer.extensions.xguard.paymentIdentifier });
      return offer;
    },
    async authorize(provider) {
      if (!pending || pending.state !== 'quoted') throw new Error('Get a price before authorizing payment.');
      validateExtractOffer(pending.offer, recipient, cap);
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      if (!/^0x[a-fA-F0-9]{40}$/.test(accounts?.[0] || '')) throw new Error('No wallet account selected.');
      if (BigInt(await provider.request({ method: 'eth_chainId' })) !== 8453n) throw new Error('Select Base in your wallet, then try again.');
      const wallet = createWalletClient({ transport: custom(provider) });
      const payer = new x402Client().register('eip155:8453', new ExactEvmScheme({ address: accounts[0], signTypedData: args => wallet.signTypedData({ ...args, account: accounts[0] }) }));
      const payload = await payer.createPaymentPayload(pending.offer);
      persist({ ...pending, state: 'prepared', signature: encodePaymentSignatureHeader(payload) });
      return this.sendPrepared();
    },
    async sendPrepared() {
      if (pending?.state !== 'prepared' || pending.endpoint !== EXTRACT_ENDPOINT) throw new Error('No saved authorization to resend.');
      validateExtractOffer(pending.offer, recipient, cap);
      return deliver(await fetchImpl(EXTRACT_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': pending.key, 'x-xguard-quote': pending.quote, 'payment-signature': pending.signature }, body: pending.body, redirect: 'error' }));
    },
    async recover() {
      if (!pending || !/^pay_[A-Za-z0-9_-]+$/.test(pending.payment_identifier || '')) throw new Error('No saved purchase to recover.');
      return deliver(await fetchImpl(`https://api.xguardgate.com/api/paid/v1/results/${pending.payment_identifier}`, { headers: { 'x-xguard-quote': pending.quote }, redirect: 'error' }));
    },
    async redeemCredit() {
      if (pending?.state !== 'credited' || typeof pending.credit !== 'string') throw new Error('No saved execution credit.');
      return deliver(await fetchImpl(EXTRACT_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': pending.key, 'x-xguard-quote': pending.quote, 'x-xguard-credit': pending.credit }, body: pending.body, redirect: 'error' }));
    },
  };
}
