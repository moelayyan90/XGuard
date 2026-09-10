// Run from the repository root after:
// npm install --no-save --package-lock=false @x402/core@2.24.0 @x402/evm@2.24.0 viem
// Set XGUARD_PAYER_PRIVATE_KEY privately in your process environment, then:
// node sdk/examples/outcome-paid.mjs
// Requires >= 0.002 USDC on Base; sends one payment of at most 0.002 USDC.
// Official signer interface: https://docs.x402.org/getting-started/quickstart-for-buyers
import { createXGuardOutcomeClient } from '../outcomes.js';

if (!/^0x[0-9a-fA-F]{64}$/.test(process.env.XGUARD_PAYER_PRIVATE_KEY || '')) {
  console.error('Configure a funded caller-owned signer through XGUARD_PAYER_PRIVATE_KEY. Never paste a key into chat.');
  process.exit(1);
}
const { x402Client } = await import('@x402/core/client');
const { ExactEvmScheme } = await import('@x402/evm/exact/client');
const { privateKeyToAccount } = await import('viem/accounts');
const signer = privateKeyToAccount(process.env.XGUARD_PAYER_PRIVATE_KEY);
const payer = new x402Client().register('eip155:8453', new ExactEvmScheme(signer));
const client = createXGuardOutcomeClient({ payer, maxAmountAtomic: '2000',
  headers: { 'x-xguard-traffic-class': 'synthetic' } });
try {
  const outcome = await client.execute({ intent: 'Get a technology news digest', limit: 5 });
  // Log only the public outcome and transaction; keep the recovery quote private.
  console.log(JSON.stringify({ ok: outcome.ok, capability: outcome.capability,
    transaction: outcome.settlement.transaction, result: outcome.result, receipt: outcome.receipt }, null, 2));
  const recovered = await client.getResult(outcome.recovery);
  if (JSON.stringify(recovered.result) !== JSON.stringify(outcome.result)) throw new Error('Recovery did not match delivery');
  console.log('Read-only recovery matched; no second payment.');
} catch (error) {
  console.error(error.message);
  if (error.recovery) console.error('Payment delivery is uncertain. Use error.recovery with client.getResult; do not issue a fresh payment.');
  process.exitCode = 1;
}
