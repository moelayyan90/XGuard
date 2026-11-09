import { ExactEvmScheme } from '@x402/evm/exact/facilitator';
import { BASE_USDC, SettlementError, inspectNative, requireThat } from './policy.js';
export class NativePaymentVerifier {
  constructor(readAdapter) { this.read = readAdapter; this.scheme = new ExactEvmScheme(readAdapter, { simulateInSettle: true, eip6492AllowedFactories: [] }); }
  async verify(payment, requirements) {
    try {
      const inspected = inspectNative(payment, requirements);
      requireThat(await this.read.getChainId() === 8453, 'rpc_chain_mismatch', 503);
      // Initial scope intentionally excludes ERC-1271/6492 deployment and any
      // extension that could create additional transactions or spending rights.
      const code = await this.read.getCode({ address: inspected.auth.from });
      requireThat(!code || code === '0x', 'smart_wallet_not_supported');
      requireThat(await this.read.readContract({ address: BASE_USDC, functionName: 'authorizationState', args: [inspected.auth.from, inspected.auth.nonce] }) === false, 'authorization_used');
      const result = await this.scheme.verify(payment, requirements);
      if (!result.isValid) return { isValid: false, invalidReason: result.invalidReason || 'invalid_payment' };
      return { isValid: true, payer: inspected.auth.from, inspected };
    } catch (error) {
      return { isValid: false, invalidReason: error instanceof SettlementError ? error.code : 'verification_rpc_or_payload_failure', retryable: !(error instanceof SettlementError) || error.status >= 500 };
    }
  }
}
