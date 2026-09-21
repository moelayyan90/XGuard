// No signing unless --pay, an explicit cap, and an operator-provided funded key
// are all present. --synthetic excludes operator trials from customer revenue.
import { writeFile, readFile } from 'node:fs/promises';
import { createPaidAPIClient } from '../paid-api.js';
const args = process.argv.slice(2), options = {};
async function main() {
  if (args.includes('--help')) { console.log('Inspect: node sdk/examples/paid-api-buy.mjs\nBuy: node sdk/examples/paid-api-buy.mjs --pay --max-amount-atomic 100000 --synthetic\nRecover: node sdk/examples/paid-api-buy.mjs --recover PRIVATE_RECOVERY_FILE\nOptional: --url https://api.xguardgate.com/p/SELLER/SERVICE/\nProvide XGUARD_PAYER_PRIVATE_KEY securely in the environment, never in chat.'); return; }
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--pay', '--synthetic', '--max-amount-atomic', '--url', '--recover'].includes(key) || key in options) throw new Error('Unknown or duplicate option. Use --help.');
    options[key] = ['--pay', '--synthetic'].includes(key) ? true : args[++i];
  }
  let payer;
  if (options['--recover'] && options['--pay']) throw new Error('Recovery cannot create a new payment.');
  if (options['--pay']) {
    if (!/^[1-9][0-9]{0,8}$/.test(options['--max-amount-atomic'] || '') || !/^0x[a-fA-F0-9]{64}$/.test(process.env.XGUARD_PAYER_PRIVATE_KEY || '')) throw new Error('A positive spending cap and securely configured funded payer key are required. No request was sent.');
    const { x402Client } = await import('@x402/core/client');
    const { ExactEvmScheme } = await import('@x402/evm/exact/client');
    const { privateKeyToAccount } = await import('viem/accounts');
    payer = new x402Client().register('eip155:8453', new ExactEvmScheme(privateKeyToAccount(process.env.XGUARD_PAYER_PRIVATE_KEY)));
  }
  const client = createPaidAPIClient({ payer, maxAmountAtomic: options['--max-amount-atomic'], trafficClass: options['--synthetic'] ? 'synthetic' : undefined, onPaymentPrepared: async recovery => {
    const file = `xguard-paid-api-recovery-${crypto.randomUUID()}.json`;
    await writeFile(file, JSON.stringify(recovery), { flag: 'wx', mode: 0o600 });
    console.error(`Private recovery file: ${file}. Preserve it; do not start a new purchase after uncertain delivery.`);
  } });
  const response = options['--recover'] ? await client.recover(JSON.parse(await readFile(options['--recover'], 'utf8'))) : await client.request(options['--url'] || 'https://api.xguardgate.com/p/xguard/feed-digest/');
  const result = await response.text();
  console.log(JSON.stringify({ status: response.status, synthetic: !!options['--synthetic'], payment_response: response.headers.get('payment-response'), receipt: response.headers.get('x-xguard-receipt'), proof: response.headers.get('x-xguard-proof'), accounting_status: response.headers.get('x-xguard-accounting-status'), platform_fee_atomic: response.headers.get('x-xguard-platform-fee-atomic'), seller_proceeds_atomic: response.headers.get('x-xguard-seller-proceeds-atomic'), result }, null, 2));
  if (options['--pay'] && !response.ok) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
