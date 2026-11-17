import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recoverMessageAddress } from 'viem';
import { XGUARD_TREASURY_OWNERSHIP_PROOF as proof } from '../src/network/treasury-ownership.js';
import { paymentCoverage } from '../src/network/payments.ts';

test('treasury address must be controlled by the signer of the XGuard ERC-191 challenge', async () => {
  const recovered = await recoverMessageAddress({ message: proof.message, signature: proof.signature });
  assert.equal(recovered.toLowerCase(), proof.address.toLowerCase());
  assert.ok(proof.message.includes('Domain: xguardgate.com'));
  assert.ok(proof.message.includes('Wallet: ' + proof.address));
  assert.ok(proof.message.includes('Network: Base (eip155:8453)'));
  assert.ok(proof.message.includes('does not authorize transfers, token approvals, or payments'));
  const wrangler = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const env = { XGUARD_TREASURY_USDC_ADDRESS: proof.address, XGUARD_PAID_FACILITATOR: 'https://facilitator.example' };
  assert.ok(wrangler.includes('"XGUARD_TREASURY_USDC_ADDRESS": "' + proof.address + '"'));
  assert.ok(wrangler.includes('"XGUARD_TESTNET_PAY_TO": "' + proof.address + '"'));
  const receiving = paymentCoverage(env).receiving[0];
  assert.equal(receiving.owner_control_verified, true);
  assert.equal(receiving.destination.toLowerCase(), recovered.toLowerCase());
  assert.equal(paymentCoverage({ ...env, XGUARD_TREASURY_USDC_ADDRESS: '0x0000000000000000000000000000000000000001' }).receiving[0].owner_control_verified, false);
});
