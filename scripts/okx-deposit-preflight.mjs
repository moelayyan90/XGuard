import { createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const origins = new Set(['https://openapi.okx.com', 'https://us.okx.com', 'https://eea.okx.com']);
const currency = 'USDC';
const chain = 'USDC-Base';
const contract = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const addressPattern = /^0x[0-9a-f]{40}$/i;
const txPattern = /^0x[0-9a-f]{64}$/i;

function atomic(value) {
  if (typeof value !== 'string' || !/^\d{1,24}(?:\.\d{1,24})?$/.test(value)) throw new Error('invalid_usdc_amount');
  const [whole, fraction = ''] = value.split('.');
  if (/[1-9]/.test(fraction.slice(6))) throw new Error('invalid_usdc_precision');
  return BigInt(whole) * 1000000n + BigInt(fraction.slice(0, 6).padEnd(6, '0'));
}

export async function verifyOkxDeposit(env, { fetchImpl = fetch, now = () => new Date() } = {}) {
  const { OKX_API_ORIGIN: origin, OKX_API_KEY: apiKey, OKX_API_SECRET: secret,
    OKX_API_PASSPHRASE: passphrase, OKX_APPROVED_DEPOSIT_ADDRESS: destination,
    OKX_EXPECTED_NET_USDC: amount, OKX_EXISTING_TX_HASH: txHash } = env;
  if (![apiKey, secret, passphrase].every(value => typeof value === 'string' && value.trim())) {
    throw new Error('okx_read_only_credentials_unavailable');
  }
  if (!origins.has(origin)) throw new Error('invalid_okx_api_origin');
  if (!addressPattern.test(destination || '') || /^0x0{40}$/i.test(destination)) throw new Error('approved_deposit_address_required');
  if (txHash && (!txPattern.test(txHash) || !amount)) throw new Error('existing_transaction_requires_hash_and_amount');
  const amountAtomic = amount === undefined ? null : atomic(amount);
  if (amountAtomic === 0n) throw new Error('invalid_usdc_amount');

  async function read(path) {
    const timestamp = now().toISOString();
    const signature = createHmac('sha256', secret).update(timestamp + 'GET' + path).digest('base64');
    const response = await fetchImpl(origin + path, { method: 'GET', redirect: 'error',
      signal: AbortSignal.timeout(10000), headers: {
        'OK-ACCESS-KEY': apiKey, 'OK-ACCESS-SIGN': signature, 'OK-ACCESS-TIMESTAMP': timestamp,
        'OK-ACCESS-PASSPHRASE': passphrase, accept: 'application/json',
      } }).catch(() => { throw new Error('okx_read_unavailable'); });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.code !== '0' || !Array.isArray(body.data)) throw new Error('okx_read_rejected');
    return body.data;
  }

  const configuration = await read('/api/v5/account/config');
  if (configuration.length !== 1 || configuration[0].perm !== 'read_only') throw new Error('read_only_okx_key_required');
  const [currencies, addresses] = await Promise.all([
    read('/api/v5/asset/currencies?ccy=USDC'), read('/api/v5/asset/deposit-address?ccy=USDC'),
  ]);
  const supported = currencies.filter(row => row.ccy === currency && row.chain === chain);
  if (supported.length !== 1) throw new Error('okx_base_usdc_chain_unconfirmed');
  const asset = supported[0];
  if (String(asset.ctAddr || '').toLowerCase() !== contract) throw new Error('okx_usdc_contract_mismatch');
  if (asset.canDep !== true || asset.needTag !== false) throw new Error('okx_deposit_unavailable_or_requires_tag');
  const matched = addresses.filter(row => row.ccy === currency && row.chain === chain &&
    String(row.addr || '').toLowerCase() === destination.toLowerCase());
  if (matched.length !== 1 || matched[0].tag || matched[0].memo || matched[0].pmtId) throw new Error('okx_deposit_destination_mismatch');
  const minimum = atomic(asset.minDep);
  if (minimum <= 0n) throw new Error('okx_deposit_minimum_unconfirmed');
  if (amountAtomic !== null && amountAtomic < minimum) throw new Error('amount_below_okx_deposit_minimum');

  let depositStatus = 'not_checked';
  if (txHash) {
    const history = await read('/api/v5/asset/deposit-history?ccy=USDC&txId=' + encodeURIComponent(txHash));
    const candidates = history.filter(row => String(row.txId || '').toLowerCase() === txHash.toLowerCase());
    if (candidates.length === 0) {
      depositStatus = 'not_found';
    } else {
      if (candidates.length !== 1 || candidates[0].ccy !== currency || candidates[0].chain !== chain ||
          String(candidates[0].to || '').toLowerCase() !== destination.toLowerCase() ||
          atomic(candidates[0].amt) !== amountAtomic) throw new Error('okx_deposit_record_mismatch');
      depositStatus = { '0': 'waiting_confirmation', '1': 'credited_not_final', '2': 'confirmed' }[candidates[0].state] ?? 'not_confirmed';
    }
  }
  return { verified: true, currency, chain, minimumDeposit: asset.minDep,
    amountChecked: amountAtomic !== null, depositStatus, transfersSubmitted: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await verifyOkxDeposit(process.env);
    console.log(JSON.stringify(result));
    if (process.env.OKX_EXISTING_TX_HASH && result.depositStatus !== 'confirmed') process.exitCode = 1;
  } catch (error) {
    const code = /^([a-z_]+)$/.test(error?.message || '') ? error.message : 'okx_preflight_failed';
    console.error(JSON.stringify({ verified: false, reason: code, transfersSubmitted: 0 }));
    process.exitCode = 1;
  }
}
