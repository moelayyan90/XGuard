import { randomBytes } from 'node:crypto';
import { recordDecision } from './journal.mjs';
import { nowSeconds, reviewOffer } from './verify.mjs';

const authorizationFields = [
  ['from', 'address'], ['to', 'address'], ['value', 'uint256'],
  ['validAfter', 'uint256'], ['validBefore', 'uint256'], ['nonce', 'bytes32'],
];

// Call only in the trusted host. The wallet supplies a local or hardware-backed
// signTypedData method. Neither the wallet nor its output is sent through MCP.
export async function signApprovedOffer({ db, policy, operation, input, review, wallet, clock = nowSeconds }) {
  const sig = policy.signing;
  if (!sig || typeof wallet?.signTypedData !== 'function' || wallet.address?.toLowerCase() !== sig.payer)
    throw new Error('configured_wallet_required');
  const snapshot = structuredClone(input);
  const offer = reviewOffer(policy, snapshot, clock());
  if (review?.status !== 'reviewed' || ['requestHash', 'offerHash', 'termsHash'].some(k => offer[k] !== review[k]))
    throw new Error('host_review_mismatch');
  const terms = snapshot.challenge.accepts[0];
  const extra = terms.extra;
  if (!extra || !['eip3009', undefined].includes(extra.assetTransferMethod) ||
    Object.keys(extra).some(k => !['assetTransferMethod', 'name', 'version'].includes(k)) ||
    Object.keys(terms).some(k => !['scheme', 'network', 'asset', 'payTo', 'amount', 'maxTimeoutSeconds', 'extra'].includes(k)) ||
    extra.name !== sig.tokenName || extra.version !== sig.tokenVersion ||
    !Number.isSafeInteger(terms.maxTimeoutSeconds) || terms.maxTimeoutSeconds <= 0)
    throw new Error('unsupported_signing_terms');

  const nonce = '0x' + randomBytes(32).toString('hex');
  const used = recordDecision(db, 'consume', policy, operation, snapshot, clock);
  const validBefore = Math.min(used.expiresAt, used.consumedAt + Math.min(sig.maxValiditySeconds, terms.maxTimeoutSeconds));
  const authorization = { from: sig.payer, to: used.payTo, value: used.amountAtomic,
    validAfter: String(Math.max(0, used.consumedAt - 1)), validBefore: String(validBefore), nonce };
  const signature = await wallet.signTypedData({
    domain: { name: sig.tokenName, version: sig.tokenVersion, chainId: Number(used.network.slice(7)),
      verifyingContract: used.asset },
    primaryType: 'TransferWithAuthorization',
    types: { TransferWithAuthorization: authorizationFields.map(([name, type]) => ({ name, type })) },
    message: { ...authorization },
  });
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature))
    throw new Error('invalid_wallet_signature');
  if (clock() >= validBefore) throw new Error('authorization_expired_after_signing');
  return { operation, request: snapshot.request, paymentPayload: { x402Version: 2,
    resource: { url: used.resourceUrl }, accepted: terms, payload: { authorization, signature } } };
}
