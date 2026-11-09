import { decodeFunctionData, encodeFunctionData, getAddress, keccak256, verifyTypedData } from 'viem';
import { authorizationTypes, eip3009ABI } from '@x402/evm';
import { BASE_USDC, requireThat } from './policy.js';
export function buildSettlementTransaction(inspected) {
  const { auth } = inspected, signature = inspected.signature;
  const data = encodeFunctionData({ abi: eip3009ABI, functionName: 'transferWithAuthorization', args: [getAddress(auth.from), getAddress(auth.to), BigInt(auth.value), BigInt(auth.validAfter), BigInt(auth.validBefore), auth.nonce, signature] });
  return { chainId: 8453, to: BASE_USDC, value: '0', data };
}
// This adapter can only use an explicitly supplied, unfunded local fixture
// account with a simulated chain. There is deliberately no production adapter,
// default key, environment-secret import, HTTP signer or RPC broadcast client.
export class SecureSimulationSigningAdapter {
  constructor(account, simulator) { requireThat(simulator?.isSimulation === true, 'production_signing_disabled', 503); this.account = account; this.simulator = simulator; this.isSimulation = true; this.address = account.address; }
  async quote(intent) {
    requireThat(intent.chainId === 8453 && getAddress(intent.to) === BASE_USDC && intent.value === '0', 'signing_policy_violation');
    const gas = await this.simulator.estimateGas(intent), fees = await this.simulator.estimateFeesPerGas();
    requireThat(gas > 0n && gas <= 300000n && fees.maxFeePerGas > 0n && fees.maxFeePerGas <= 100000000000n && fees.maxPriorityFeePerGas >= 0n && fees.maxPriorityFeePerGas <= fees.maxFeePerGas, 'gas_policy_violation');
    return { ...intent, gas: gas.toString(), maxFeePerGas: fees.maxFeePerGas.toString(), maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString() };
  }
  async sign(unsigned, expectedData) {
    requireThat(unsigned.chainId === 8453 && getAddress(unsigned.to) === BASE_USDC && unsigned.value === '0' && unsigned.data === expectedData, 'signing_policy_violation');
    // Recheck persisted fee caps before crossing the signing boundary.
    requireThat(BigInt(unsigned.gas) <= 300000n && BigInt(unsigned.maxFeePerGas) <= 100000000000n && BigInt(unsigned.maxPriorityFeePerGas) <= BigInt(unsigned.maxFeePerGas), 'gas_policy_violation');
    const { functionName, args } = decodeFunctionData({ abi: eip3009ABI, data: unsigned.data });
    requireThat(functionName === 'transferWithAuthorization' && args.length === 7, 'signing_policy_violation');
    const [from, to, value, validAfter, validBefore, nonce, signature] = args;
    const now = BigInt(Math.floor(Date.now() / 1000));
    requireThat(getAddress(from) !== getAddress(this.address) && BigInt(value) > 0n && BigInt(validAfter) < now && BigInt(validBefore) > now + 6n, 'signing_authorization_rejected');
    requireThat(await verifyTypedData({ address: from, domain: { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: BASE_USDC }, types: authorizationTypes, primaryType: 'TransferWithAuthorization', message: { from, to, value, validAfter, validBefore, nonce }, signature }), 'signing_authorization_rejected');
    const raw = await this.account.signTransaction({ ...unsigned, type: 'eip1559', value: 0n, gas: BigInt(unsigned.gas), maxFeePerGas: BigInt(unsigned.maxFeePerGas), maxPriorityFeePerGas: BigInt(unsigned.maxPriorityFeePerGas) });
    return { raw, hash: keccak256(raw) };
  }
}
