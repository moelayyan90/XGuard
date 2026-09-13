// Customer purchase example. Does not run or sign without --pay and an explicit cap.
// Configure XGUARD_PAYER_PRIVATE_KEY privately; never paste it into a webpage or chat.
import { writeFile, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createXGuardOutcomeClient } from '../outcomes.js';

const usage = `Purchase: node sdk/examples/outcome-buy.mjs --pay --max-amount-atomic 2000 --request '{"intent":"Get a technology news digest","limit":5}'
Recover:  node sdk/examples/outcome-buy.mjs --recover ./xguard-recovery-ID.json
Amounts use USDC atomic units: 2000 = 0.002 USDC. Purchases require funded Base USDC.
Add --synthetic for operator tests; tests are excluded from customer/revenue counters.`;
const args = process.argv.slice(2);
async function main() {
  if (!args.length || args.includes('--help')) { console.log(usage); return; }
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--pay', '--synthetic', '--max-amount-atomic', '--request', '--recover'].includes(key) || key in options) throw new Error('Unknown or repeated option. Use --help.');
    if (['--pay', '--synthetic'].includes(key)) options[key] = true;
    else { const value = args[++i]; if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}.`); options[key] = value; }
  }
  const headers = options['--synthetic'] ? { 'x-xguard-traffic-class': 'synthetic' } : {};
  if (options['--recover']) {
    if (options['--pay'] || options['--request'] || options['--max-amount-atomic']) throw new Error('Recovery must not be combined with purchase options.');
    const recovery = JSON.parse(await readFile(options['--recover'], 'utf8'));
    const client = createXGuardOutcomeClient({ headers });
    const data = await client.getResult(recovery);
    console.log(JSON.stringify({ ok: data.ok, capability: data.capability, result: data.result, receipt: data.receipt }, null, 2));
    return;
  }
  if (!options['--pay'] || !/^[1-9]\d{0,11}$/.test(options['--max-amount-atomic'] || '') || !options['--request']) throw new Error('Purchase requires --pay, a positive --max-amount-atomic and --request. Use --help.');
  const request = JSON.parse(options['--request']);
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Request must be a JSON object.');
  if (!/^0x[0-9a-fA-F]{64}$/.test(process.env.XGUARD_PAYER_PRIVATE_KEY || '')) throw new Error('Configure XGUARD_PAYER_PRIVATE_KEY privately in your process environment. No request was sent.');
  const { x402Client } = await import('@x402/core/client');
  const { ExactEvmScheme } = await import('@x402/evm/exact/client');
  const { privateKeyToAccount } = await import('viem/accounts');
  const signer = privateKeyToAccount(process.env.XGUARD_PAYER_PRIVATE_KEY);
  const payer = new x402Client().register('eip155:8453', new ExactEvmScheme(signer));
  const saveRecovery = async recovery => {
    if (!/^pay_[a-zA-Z0-9_-]+$/.test(recovery?.payment_identifier || '') || !recovery?.quote) throw new Error('Missing recovery data. Payment was not submitted.');
    const filename = `xguard-recovery-${randomUUID()}.json`;
    await writeFile(filename, JSON.stringify(recovery), { mode: 0o600, flag: 'wx' });
    console.error(`Private recovery file: ${filename}. Keep it out of Git, logs and shared folders.`);
  };
  const client = createXGuardOutcomeClient({ payer, maxAmountAtomic: options['--max-amount-atomic'], headers, onPaymentPrepared: saveRecovery });
  let data;
  try { data = await client.execute(request); }
  catch (error) {
    if (error.recovery) {
      // Preserve an issued execution credit and repair details without printing
      // bearer credentials to a terminal, CI log or agent conversation.
      if (error.data) {
        const filename = `xguard-response-${randomUUID()}.json`;
        await writeFile(filename, JSON.stringify({ request, response: error.data }), { mode: 0o600, flag: 'wx' });
        console.error(`Private failure details: ${filename}. An issued execution credit is retained there.`);
      }
      throw new Error('Delivery is uncertain. Use --recover with the saved file; do not start a new purchase.');
    }
    throw error;
  }
  console.log(JSON.stringify({ ok: data.ok, capability: data.capability, result: data.result, cost: data.cost, receipt: data.receipt, settlement: data.settlement }, null, 2));
}
main().catch(error => { console.error(error instanceof SyntaxError ? 'Invalid JSON. Use --help.' : error.message); process.exitCode = 1; });
