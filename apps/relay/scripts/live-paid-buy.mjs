import { readFile, writeFile } from 'node:fs/promises';
import { createLivePaidClient, verifyLiveDelivery } from '../../../sdk/live-paid.js';
const args = process.argv.slice(2), flags = {};
async function main() {
  if (!args.length || args.includes('--help')) { console.log('Catalog only: node apps/relay/scripts/live-paid-buy.mjs --catalog\nAuthorized purchase: node apps/relay/scripts/live-paid-buy.mjs --pay --service batch --input INPUT.json --max-amount-atomic 10000 [--synthetic]\nRecovery only: node apps/relay/scripts/live-paid-buy.mjs --recover PRIVATE_RECOVERY.json\nA purchase requires an explicitly supplied XGUARD_PAYER_PRIVATE_KEY in the local environment. Never provide it in chat, source control or arguments.'); return; }
  for (let i = 0; i < args.length; i++) {
    const key = args[i]; if (!['--catalog', '--pay', '--synthetic', '--service', '--input', '--max-amount-atomic', '--recover'].includes(key) || key in flags) throw new Error('Unknown or duplicate option');
    flags[key] = ['--catalog', '--pay', '--synthetic'].includes(key) ? true : args[++i];
  }
  if (flags['--catalog']) {
    if (flags['--pay'] || flags['--recover']) throw new Error('Catalog inspection is separate from purchase and recovery');
    const r = await fetch('https://api.xguardgate.com/api/paid/v1/catalog', { headers: { accept: 'application/json', 'x-xguard-traffic-class': flags['--synthetic'] ? 'synthetic' : 'external' }, redirect: 'error' });
    const catalog = await r.json(); console.log(JSON.stringify({ status: r.status, services: catalog.services?.map(x => ({ service: x.route, price: x.price, availability: x.availability })), readiness: catalog.readiness }, null, 2)); return;
  }
  let payer;
  if (flags['--pay']) {
    if (flags['--recover'] || !['batch', 'history', 'compare'].includes(flags['--service']) || !flags['--input'] || !/^[1-9]\d{0,8}$/.test(flags['--max-amount-atomic'] || '') || !/^0x[a-fA-F0-9]{64}$/.test(process.env.XGUARD_PAYER_PRIVATE_KEY || '')) throw new Error('Purchase needs --pay, a valid service, input file, explicit cap and an authorized payer key; no payment was prepared');
    const { x402Client } = await import('@x402/core/client'); const { ExactEvmScheme } = await import('@x402/evm/exact/client'); const { privateKeyToAccount } = await import('viem/accounts');
    payer = new x402Client().register('eip155:8453', new ExactEvmScheme(privateKeyToAccount(process.env.XGUARD_PAYER_PRIVATE_KEY)));
  } else if (!flags['--recover']) throw new Error('Use --catalog, --recover or an explicitly authorized --pay');
  const save = async (kind, data) => { const path = `live-paid-${kind}-${crypto.randomUUID()}.private.json`; await writeFile(path, JSON.stringify(data), { mode: 0o600, flag: 'wx' }); console.log(JSON.stringify({ private_file: path })); return path; };
  const client = createLivePaidClient({ payer, maxAmountAtomic: flags['--max-amount-atomic'], trafficClass: flags['--synthetic'] ? 'synthetic' : undefined, onPaymentPrepared: data => save('recovery', data) });
  const r = flags['--recover'] ? await client.recover(JSON.parse(await readFile(flags['--recover'], 'utf8'))) : await client.request(flags['--service'], JSON.parse(await readFile(flags['--input'], 'utf8')));
  const data = await r.json(); await save('result', data);
  const key = r.ok ? await (await fetch('https://api.xguardgate.com/api/paid/v1/proof-key')).json() : null;
  console.log(JSON.stringify({ status: r.status, synthetic: Boolean(flags['--synthetic']), issuer_signatures_and_result_digest_valid: key ? await verifyLiveDelivery(data, key.jwk) : null }));
  if (!r.ok) process.exitCode = 1;
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
