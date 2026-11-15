import { readFile, writeFile } from 'node:fs/promises';
import { x402Client } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';
import { createComputeClient, verifyComputeReceipt } from '../../sdk/compute.js';

const recoveryFile = process.env.XGUARD_COMPUTE_RECOVERY_FILE || './xguard-compute-recovery.json';
const maximum = process.env.XGUARD_BUYER_MAX_ATOMIC;
if (!maximum) throw new Error('Set XGUARD_BUYER_MAX_ATOMIC explicitly. 10000 = 0.01 USDC.');
let prepared;
try { prepared = JSON.parse(await readFile(recoveryFile, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const payer = prepared ? null : new x402Client().register('eip155:8453', new ExactEvmScheme(privateKeyToAccount(process.env.XGUARD_BUYER_PRIVATE_KEY)));
const client = createComputeClient({ payer, maxAmountAtomic: maximum, onPaymentPrepared: async value => { prepared = value; await writeFile(recoveryFile, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' }); } });
const response = prepared ? await client.recover(prepared) : await client.request('inference', { model: process.env.XGUARD_COMPUTE_MODEL, messages: [{ role: 'user', content: 'Explain gravity in one sentence.' }], max_tokens: 64, accept_provider_terms: true });
const delivery = await response.json();
if (delivery.status === 'SUCCEEDED') {
  const publicKey = await (await fetch('https://api.xguardgate.com/v1/compute/proof-key')).json();
  if (!await verifyComputeReceipt(delivery, publicKey.jwk)) throw new Error('Execution receipt verification failed.');
}
console.log(JSON.stringify(delivery, null, 2));
