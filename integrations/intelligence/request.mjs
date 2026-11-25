import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyLiveDelivery } from '../../sdk/live-paid.js';
import { createPaidAPIClient, inspectIntelligenceOffer } from '../../sdk/paid-api.js';

const api = 'https://api.xguardgate.com/api/intelligence/v1/';
const requireRelay = createRequire(new URL('../../apps/relay/package.json', import.meta.url));
async function signer() {
  const secret = process.env.XGUARD_PAYER_PRIVATE_KEY;
  if (!/^0x[a-fA-F0-9]{64}$/.test(secret || '')) throw Error('A local funded signer must be configured for buy mode.');
  const { x402Client } = requireRelay('@x402/core/client');
  const { ExactEvmScheme } = requireRelay('@x402/evm/exact/client');
  const { privateKeyToAccount } = requireRelay('viem/accounts');
  return new x402Client().register('eip155:8453',new ExactEvmScheme(privateKeyToAccount(secret)));
}
async function emitDelivery(response) {
  const data = await response.json();
  if (!response.ok || response.status === 202) throw Error('Delivery pending or unavailable (HTTP '+response.status+'). Recover using the same private file.');
  if (!data.receipt || !data.result || !data.settlement || !response.headers.has('payment-response')) throw Error('Incomplete paid response. Preserve the recovery file.');
  const keyResponse=await fetch(api+'proof-key',{redirect:'error',signal:AbortSignal.timeout(10000)});
  if (!keyResponse.ok || !await verifyLiveDelivery(data,(await keyResponse.json()).jwk)) throw Error('Receipt or result digest could not be verified. Preserve the recovery file.');
  process.stdout.write(JSON.stringify(data)+'\n');
}
async function main() {
  const [mode,service,inputFile,recoveryFile] = process.argv.slice(2);
  if (mode === 'recover') {
    if (!service || inputFile) throw Error('Usage: recover PRIVATE_RECOVERY_FILE');
    const data = JSON.parse(await readFile(service,'utf8'));
    return emitDelivery(await createPaidAPIClient().recover(data));
  }
  if (!['quote','buy'].includes(mode) || !/^[a-z][a-z-]{1,39}$/.test(service || '') || !inputFile) throw Error('Usage: quote SERVICE INPUT_JSON_FILE or buy SERVICE INPUT_JSON_FILE PRIVATE_RECOVERY_FILE');
  const raw=await readFile(inputFile,'utf8');
  if (Buffer.byteLength(raw)>24000) throw Error('Input exceeds the service limit.');
  const input=JSON.parse(raw), url=api+service;
  const init={method:'POST',headers:{'content-type':'application/json'},body:raw};
  if (mode==='quote') {
    const client=createPaidAPIClient({trafficClass:'monitoring'});
    const response=await client.request(url,init);
    if (response.status!==402 || !response.headers.has('payment-required')) throw Error('Expected an unsigned HTTP 402 challenge, received '+response.status);
    const wire=JSON.parse(Buffer.from(response.headers.get('payment-required'),'base64').toString('utf8'));
    const offer=inspectIntelligenceOffer(url,input,wire);
    const bodyOffer=inspectIntelligenceOffer(url,input,await response.json());
    if (offer.amount_atomic!==bodyOffer.amount_atomic) throw Error('Inconsistent challenge.');
    process.stdout.write(JSON.stringify({...offer,purchases_enabled:response.headers.get('x-xguard-intelligence-writer')==='enabled',payment_submitted:false})+'\n');
    return;
  }
  const key=process.env.XGUARD_OPERATION_ID,cap=process.env.XGUARD_MAX_AMOUNT_ATOMIC;
  if (!recoveryFile || !/^[A-Za-z0-9_-]{8,128}$/.test(key||'') || !/^[1-9][0-9]{0,8}$/.test(cap||'')) throw Error('Buy mode requires a private recovery path, stable XGUARD_OPERATION_ID and explicit XGUARD_MAX_AMOUNT_ATOMIC.');
  // A reused path can only recover the original payment, across process restarts.
  try {
    const record=JSON.parse(await readFile(recoveryFile,'utf8'));
    if (record.endpoint!==url || record.idempotency_key!==key || record.input!==raw) throw Error('The recovery file belongs to a different operation.');
    return emitDelivery(await createPaidAPIClient().recover(record));
  } catch (e) { if (e.code!=='ENOENT') throw e; }
  const client=createPaidAPIClient({payer:await signer(),maxAmountAtomic:cap,
    onPaymentPrepared:record=>writeFile(recoveryFile,JSON.stringify({...record,input:raw}),{mode:0o600,flag:'wx'})});
  init.headers['idempotency-key']=key;
  await emitDelivery(await client.request(url,init));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error=>{ console.error(error.message); process.exitCode=1; });
}
