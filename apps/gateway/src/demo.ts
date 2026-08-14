import type { FacilitatorClient } from "@x402/core/http";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from "@x402/core/types";
import {
  RoutingEngine,
  SettlementCoordinator,
  SqliteFinancialStore,
  formatMicroUsd,
} from "@xguard/core";

const payer = "0x1111111111111111111111111111111111111111";
const payTo = "0x2222222222222222222222222222222222222222";
const asset = "0x3333333333333333333333333333333333333333";

class DeterministicTestnetFacilitator implements FacilitatorClient {
  public verifyCalls = 0;
  public settleCalls = 0;
  public async getSupported(): Promise<SupportedResponse> {
    return {
      kinds: [
        {
          x402Version: 2,
          scheme: "exact",
          network: "eip155:84532",
          extra: {
            assetTransferMethod: "eip3009",
            paymentFlow: "authorization",
          },
        },
      ],
      extensions: ["payment-identifier"],
      signers: { eip155: [] },
    };
  }
  public async verify(): Promise<VerifyResponse> {
    this.verifyCalls += 1;
    return { isValid: true, payer };
  }
  public async settle(
    _payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    this.settleCalls += 1;
    return {
      success: true,
      transaction: `0x${"ef".repeat(32)}`,
      network: requirements.network,
      payer,
      amount: requirements.amount,
    };
  }
}

const requirements: PaymentRequirements = {
  scheme: "exact",
  network: "eip155:84532",
  asset,
  amount: "1000",
  payTo,
  maxTimeoutSeconds: 60,
  extra: { assetTransferMethod: "eip3009", paymentFlow: "authorization" },
};
const payload: PaymentPayload = {
  x402Version: 2,
  resource: {
    url: "https://demo.xguard.example/paid",
    description: "XGuard deterministic test flow",
    mimeType: "application/json",
  },
  accepted: structuredClone(requirements),
  payload: {
    signature: `0x${"ab".repeat(65)}`,
    authorization: {
      from: payer,
      to: payTo,
      value: requirements.amount,
      validAfter: "0",
      validBefore: (BigInt(Math.floor(Date.now() / 1_000)) + 3_600n).toString(),
      nonce: `0x${"12".repeat(32)}`,
    },
  },
  extensions: {
    "payment-identifier": {
      info: { required: false, id: "demo_1234567890abcdef1234567890abcdef" },
    },
  },
};

const client = new DeterministicTestnetFacilitator();
const store = new SqliteFinancialStore();
store.createMerchant({
  id: "demo",
  name: "Deterministic demo",
  apiKeyHash: "not-a-real-key",
  openingBalanceMicroUsd: 1_000_000n,
});
const router = new RoutingEngine(
  [
    {
      id: "deterministic-testnet",
      url: "https://mock.invalid",
      client,
      downstreamCostMicroUsd: 0n,
    },
  ],
  2_000n,
  0n,
);
const coordinator = new SettlementCoordinator(store, router, {
  mainnetEnabled: false,
  feeMicroUsd: 2_000n,
  supportedNetworks: new Set(["eip155:84532"]),
});

await coordinator.initialize();
const verified = await coordinator.verify("demo", payload, requirements);
const settled = await coordinator.settle("demo", payload, requirements);
const replayed = await coordinator.settle("demo", payload, requirements);
const report = store.getFinancialReport();
const ledger = store.verifyLedgerBalance();

console.log(
  JSON.stringify(
    {
      evidenceType: "deterministic_protocol_simulation",
      simulation: true,
      chainBroadcast: false,
      x402Version: 2,
      network: requirements.network,
      verified: verified.result.isValid,
      settled: settled.result.success,
      transactionReference: settled.result.transaction,
      duplicateReturnedCachedResult: replayed.replayed,
      logicalPaymentKey: settled.paymentKey,
      outboundSettlementCalls: client.settleCalls,
      billableSettlementCount: report.billableSettlementCount.toString(),
      grossXGuardRevenueUsd: formatMicroUsd(report.grossRevenueMicroUsd),
      testnetFeeChargedUsd: "0.000000",
      ledgerBalanced: ledger.balanced,
    },
    null,
    2,
  ),
);
store.close();
