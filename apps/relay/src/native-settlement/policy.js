import { getAddress, hashTypedData, keccak256, stringToHex } from 'viem';
import { authorizationTypes } from '@x402/evm';
export const BASE_NETWORK = 'eip155:8453';
export const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const NATIVE_STATUS = Object.freeze({ state: 'disabled', implementation: 'isolated-simulation', production_signer: false, production_settlement_proven: false, supported_scope: 'x402 v2 exact EIP-3009, Base USDC; no Permit2 or smart-wallet deployment', activation: 'Requires explicit operator approval, isolated production signing, gas funding, security review and an authorized real settlement.' });
export class SettlementError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export const requireThat = (condition, code, status) => { if (!condition) throw new SettlementError(code, status); };
export const stringify = value => JSON.stringify(value, (_, x) => typeof x === 'bigint' ? x.toString() : x);
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export const digest = value => keccak256(stringToHex(stringify(canonical(value))));
const uint = x => typeof x === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(x) && BigInt(x) < 2n ** 256n;
export function inspectNative(payment, requirements, { checkTime = true } = {}) {
  requireThat(payment?.x402Version === 2 && payment.accepted && payment.payload && requirements, 'invalid_x402_v2_payload');
  const accepted = payment.accepted, auth = payment.payload.authorization;
  requireThat(requirements.scheme === 'exact' && accepted.scheme === 'exact', 'unsupported_scheme');
  requireThat(requirements.network === BASE_NETWORK && accepted.network === BASE_NETWORK, 'network_mismatch');
  requireThat(typeof requirements.asset === 'string' && getAddress(requirements.asset) === BASE_USDC, 'unsupported_asset');
  requireThat(getAddress(accepted.asset) === BASE_USDC, 'asset_mismatch');
  requireThat(uint(requirements.amount) && BigInt(requirements.amount) > 0n && accepted.amount === requirements.amount, 'amount_mismatch');
  requireThat(getAddress(accepted.payTo) === getAddress(requirements.payTo), 'recipient_mismatch');
  requireThat(Number.isSafeInteger(requirements.maxTimeoutSeconds) && requirements.maxTimeoutSeconds > 0 && requirements.maxTimeoutSeconds <= 3600 && accepted.maxTimeoutSeconds === requirements.maxTimeoutSeconds, 'invalid_timeout');
  for (const x of [requirements.extra, accepted.extra]) requireThat(x?.name === 'USD Coin' && x?.version === '2' && (!x.assetTransferMethod || x.assetTransferMethod === 'eip3009'), 'unsupported_eip712_domain');
  requireThat(!payment.payload.permit2Authorization && auth && /^0x[0-9a-fA-F]{130}$/.test(payment.payload.signature || ''), 'unsupported_authorization_type');
  requireThat(uint(auth.value) && uint(auth.validAfter) && uint(auth.validBefore) && /^0x[0-9a-fA-F]{64}$/.test(auth.nonce || ''), 'invalid_authorization');
  requireThat(auth.value === requirements.amount && getAddress(auth.to) === getAddress(requirements.payTo), 'authorization_mismatch');
  requireThat(getAddress(auth.from) !== '0x0000000000000000000000000000000000000000', 'invalid_payer');
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (checkTime) {
    requireThat(BigInt(auth.validAfter) < now, 'authorization_not_yet_valid');
    requireThat(BigInt(auth.validBefore) > now + 6n, 'authorization_expired');
    requireThat(BigInt(auth.validBefore) <= now + BigInt(requirements.maxTimeoutSeconds), 'authorization_window_too_long');
  }
  const typedData = { domain: { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: BASE_USDC }, types: authorizationTypes, primaryType: 'TransferWithAuthorization', message: { ...auth, value: BigInt(auth.value), validAfter: BigInt(auth.validAfter), validBefore: BigInt(auth.validBefore) } };
  const authorizationKey = digest([BASE_NETWORK, BASE_USDC.toLowerCase(), auth.from.toLowerCase(), auth.nonce.toLowerCase()]);
  return { auth, typedData, authorizationKey, requestHash: digest({ authorization: hashTypedData(typedData), signature: payment.payload.signature.toLowerCase(), requirements: { scheme: requirements.scheme, network: requirements.network, asset: BASE_USDC, amount: requirements.amount, payTo: getAddress(requirements.payTo), maxTimeoutSeconds: requirements.maxTimeoutSeconds, extra: { name: 'USD Coin', version: '2' } } }) };
}
