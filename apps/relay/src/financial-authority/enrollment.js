import { digest, keyId, need, unsigned, verify } from './crypto.js';

export const organizationForLicense = key => digest('xguard-afa-funded-enrollment/1:' + key).then(hash => 'org_' + hash);

export async function authorizeEnrollment(request, env, envelope) {
  const key = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/)?.[1];
  need(key && key.length >= 20 && key.length <= 200, 'operator_or_funded_license_required', 403);
  if (env.LIVE_ADMIN_KEY?.length >= 24 && await digest(key) === await digest(env.LIVE_ADMIN_KEY)) return;
  // A customer's existing license admits one sandbox tenant. It is never
  // stored, debited, delegated to an agent, or treated as a wallet authority.
  need(envelope.org_id === await organizationForLicense(key), 'license_organization_mismatch', 403);
  need(envelope.signer === await keyId(envelope.payload.owner_key) && await verify(unsigned(envelope), envelope.signature, envelope.payload.owner_key), 'invalid_agent_signature', 401);
  let response;
  try {
    response = await fetch('https://hooks.xguardgate.com/v1/balance', { method: 'GET', headers: { authorization: 'Bearer ' + key, accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(3000) });
  } catch { need(false, 'enrollment_billing_unavailable', 503); }
  need(response.ok, response.status === 401 || response.status === 404 ? 'funded_license_required' : 'enrollment_billing_unavailable', response.status === 401 || response.status === 404 ? 403 : 503);
  let balance;
  try { balance = await response.json(); } catch { need(false, 'enrollment_billing_unavailable', 503); }
  need(['credits','granted','consumed','refunded_credits','debt_credits'].every(k => Number.isSafeInteger(balance?.[k]) && balance[k] >= 0) && typeof balance.restricted === 'boolean', 'enrollment_billing_response_invalid', 503);
  need(balance.restricted === false && balance.debt_credits === 0 && balance.credits > 0 && balance.granted > balance.refunded_credits, 'funded_unrestricted_license_required', 403);
}
