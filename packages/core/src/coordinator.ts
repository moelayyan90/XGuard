import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import { SettleError } from "@x402/core/types";
import { AmbiguousSettlementError, XGuardError } from "./errors.js";
import { DEFAULT_XGUARD_FEE_MICRO_USD, parseUnsignedInteger } from "./money.js";
import { RoutingEngine } from "./router.js";
import {
  derivePaymentIdentities,
  isKnownTestnet,
  type PaymentIdentities,
} from "./safety.js";
import {
  SqliteFinancialStore,
  type DurableSettlementEvidence,
} from "./store.js";

export interface CoordinatorConfig {
  mainnetEnabled: boolean;
  feeMicroUsd: bigint;
  supportedNetworks: ReadonlySet<string>;
  paymentIdentifierTtlSeconds?: number;
  finalityAdapter?: SettlementFinalityAdapter;
}

export interface SettlementFinalityContext {
  paymentKey: string;
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
  facilitatorId: string;
  facilitatorResponse: SettleResponse;
  expectedPayer: string;
}

export interface SettlementFinalityEvidence {
  finalized: boolean;
  confirmations: number;
  network: string;
  transaction: string;
  payer: string;
  payTo: string;
  asset: string;
  amount: string;
  observedAt: string;
  evidenceReference: string;
}

export interface SettlementFinalityAdapter {
  validate(
    context: SettlementFinalityContext,
  ): Promise<SettlementFinalityEvidence>;
}

export interface CoordinatorResult<T> {
  paymentKey: string;
  facilitatorId: string | null;
  replayed: boolean;
  result: T;
}

export class SettlementCoordinator {
  public constructor(
    private readonly store: SqliteFinancialStore,
    private readonly router: RoutingEngine,
    private readonly config: CoordinatorConfig = {
      mainnetEnabled: false,
      feeMicroUsd: DEFAULT_XGUARD_FEE_MICRO_USD,
      supportedNetworks: new Set(["eip155:84532"]),
      paymentIdentifierTtlSeconds: 86_400,
    },
  ) {}

  public async initialize(): Promise<void> {
    await this.router.refreshCapabilities();
  }

  public supported() {
    const downstream = this.router.getCombinedSupported();
    return {
      ...downstream,
      kinds: downstream.kinds.filter((kind) =>
        this.config.supportedNetworks.has(kind.network),
      ),
    };
  }

  public async verify(
    merchantId: string,
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<CoordinatorResult<VerifyResponse>> {
    this.assertNetworkAllowed(paymentRequirements.network);
    const identities = derivePaymentIdentities(
      paymentPayload,
      paymentRequirements,
    );
    const routed = await this.router.verify(
      paymentPayload,
      paymentRequirements,
      identities.payer,
    );
    this.store.recordVerification({
      merchantId,
      logicalPaymentKey: identities.logicalPaymentKey,
      facilitatorId: routed.facilitatorId,
      result: routed.result,
      latencyMs: routed.latencyMs,
    });
    return {
      paymentKey: identities.logicalPaymentKey,
      facilitatorId: routed.facilitatorId,
      replayed: false,
      result: routed.result,
    };
  }

  public async settle(
    merchantId: string,
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<CoordinatorResult<SettleResponse>> {
    this.assertNetworkAllowed(paymentRequirements.network);
    const identities = derivePaymentIdentities(
      paymentPayload,
      paymentRequirements,
    );
    const testnet = isKnownTestnet(paymentRequirements.network);
    if (
      !testnet &&
      (!this.config.mainnetEnabled || this.config.finalityAdapter === undefined)
    ) {
      throw new XGuardError(
        "MAINNET_DISABLED",
        "Mainnet settlement requires an enabled release plus an independent chain-finality adapter",
        403,
      );
    }

    const requiredExtensions = Object.keys(
      paymentPayload.extensions ?? {},
    ).filter(
      (key) =>
        key !== "payment-identifier" &&
        key !== "offer-receipt" &&
        key !== "sign-in-with-x",
    );

    let selected =
      this.store.getPayment(identities.logicalPaymentKey) === null
        ? this.router.selectForSettlement(paymentRequirements, !testnet, {
            requiredExtensions,
          })
        : null;

    const paymentIdentifierTtlSeconds =
      this.config.paymentIdentifierTtlSeconds ?? 86_400;
    if (
      !Number.isSafeInteger(paymentIdentifierTtlSeconds) ||
      paymentIdentifierTtlSeconds < 1 ||
      paymentIdentifierTtlSeconds > 86_400
    )
      throw new XGuardError(
        "INTERNAL_ERROR",
        "Payment Identifier TTL configuration is invalid",
        500,
      );
    const nowSeconds = BigInt(Math.floor(Date.now() / 1_000));
    const identifierExpiry =
      identities.expiresAtSeconds <
      nowSeconds + BigInt(paymentIdentifierTtlSeconds)
        ? identities.expiresAtSeconds
        : nowSeconds + BigInt(paymentIdentifierTtlSeconds);

    const prepared = this.store.prepareSettlement({
      logicalPaymentKey: identities.logicalPaymentKey,
      settlementStepKey: identities.settlementStepKey,
      requestFingerprint: identities.requestFingerprint,
      paymentIdentifier: identities.paymentIdentifier,
      paymentIdentifierExpiresAtSeconds: identifierExpiry,
      merchantId,
      network: paymentRequirements.network,
      scheme: paymentRequirements.scheme,
      payer: identities.payer,
      asset: paymentRequirements.asset,
      payTo: paymentRequirements.payTo,
      amountAtomic: paymentRequirements.amount,
      expiresAtSeconds: identities.expiresAtSeconds,
      testnet,
      feeMicroUsd: this.config.feeMicroUsd,
    });

    if (prepared.kind === "CACHED") {
      const stored = this.store.getPayment(prepared.paymentKey);
      return {
        paymentKey: prepared.paymentKey,
        facilitatorId: stored?.facilitatorId ?? null,
        replayed: true,
        result: prepared.response,
      };
    }
    if (prepared.kind === "AMBIGUOUS") throw new AmbiguousSettlementError();
    if (prepared.kind === "IN_PROGRESS") {
      throw new XGuardError(
        "SETTLEMENT_IN_PROGRESS",
        "The identical logical payment is already being processed",
        409,
        true,
      );
    }
    if (prepared.kind === "FAILED") {
      const result =
        prepared.response ??
        this.failureResponse(
          paymentRequirements,
          "previous_settlement_failed",
          "Previous settlement failed definitively",
        );
      const stored = this.store.getPayment(prepared.paymentKey);
      return {
        paymentKey: prepared.paymentKey,
        facilitatorId: stored?.facilitatorId ?? null,
        replayed: true,
        result,
      };
    }

    selected ??= this.router.selectForSettlement(
      paymentRequirements,
      !testnet,
      {
        requiredExtensions,
      },
    );

    if (!this.store.markOutboundStarted(prepared.paymentKey, selected.id)) {
      throw new XGuardError(
        "SETTLEMENT_IN_PROGRESS",
        "Another worker owns the outbound settlement",
        409,
        true,
      );
    }

    try {
      const routed = await this.router.settleOnce(
        selected,
        paymentPayload,
        paymentRequirements,
        identities.payer,
      );
      if (routed.result.success) {
        let finalityEvidence: DurableSettlementEvidence;
        if (!testnet) {
          const evidence = await this.config.finalityAdapter?.validate({
            paymentKey: prepared.paymentKey,
            paymentPayload,
            paymentRequirements,
            facilitatorId: routed.facilitatorId,
            facilitatorResponse: routed.result,
            expectedPayer: identities.payer,
          });
          this.assertFinalityEvidence(
            evidence,
            prepared.paymentKey,
            routed.result,
            paymentRequirements,
            identities.payer,
          );
          if (evidence === undefined)
            throw new XGuardError(
              "PAYMENT_CONFLICT",
              "Independent finality evidence was not returned",
              409,
            );
          finalityEvidence = {
            ...evidence,
            finalized: true,
            source: "INDEPENDENT_CHAIN",
          };
        } else {
          finalityEvidence = {
            source: "FACILITATOR_TESTNET",
            finalized: true,
            confirmations: 1,
            network: routed.result.network,
            transaction: routed.result.transaction,
            payer: identities.payer,
            payTo: paymentRequirements.payTo,
            asset: paymentRequirements.asset,
            amount: routed.result.amount ?? paymentRequirements.amount,
            observedAt: new Date().toISOString(),
            evidenceReference: `testnet-facilitator:${routed.facilitatorId}:${routed.result.transaction}`,
          };
        }
        this.store.finalizeSuccess({
          paymentKey: prepared.paymentKey,
          response: routed.result,
          facilitatorId: routed.facilitatorId,
          downstreamCostMicroUsd: testnet ? 0n : routed.downstreamCostMicroUsd,
          finalityEvidence,
        });
      } else if (!testnet) {
        this.store.markAmbiguous(
          prepared.paymentKey,
          "A post-submission mainnet rejection requires independent proof that the authorization remains unused",
        );
        throw new AmbiguousSettlementError();
      } else {
        this.store.finalizeDefinitiveFailure({
          paymentKey: prepared.paymentKey,
          response: routed.result,
          reason: routed.result.errorReason ?? "downstream_rejected",
          rejectionEvidence: {
            source: "FACILITATOR_RESPONSE",
            facilitatorId: routed.facilitatorId,
            observedAt: new Date().toISOString(),
            evidenceReference: `facilitator-rejection:${routed.facilitatorId}:${prepared.paymentKey}`,
          },
        });
      }
      return {
        paymentKey: prepared.paymentKey,
        facilitatorId: routed.facilitatorId,
        replayed: false,
        result: routed.result,
      };
    } catch (error) {
      if (error instanceof AmbiguousSettlementError) throw error;
      if (error instanceof SettleError) {
        this.store.markAmbiguous(
          prepared.paymentKey,
          "Facilitator returned a non-success HTTP response after submission",
        );
        throw new AmbiguousSettlementError();
      }
      const reason =
        error instanceof Error
          ? error.message
          : "Unknown downstream settlement boundary failure";
      this.store.markAmbiguous(prepared.paymentKey, reason);
      throw new AmbiguousSettlementError();
    }
  }

  public deriveIdentities(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): PaymentIdentities {
    return derivePaymentIdentities(paymentPayload, paymentRequirements);
  }

  private assertNetworkAllowed(network: string): void {
    if (!this.config.supportedNetworks.has(network)) {
      throw new XGuardError(
        "UNSUPPORTED",
        `Network ${network} is outside XGuard's enabled compatibility matrix`,
        400,
      );
    }
  }

  private assertFinalityEvidence(
    evidence: SettlementFinalityEvidence | undefined,
    paymentKey: string,
    response: SettleResponse,
    requirements: PaymentRequirements,
    expectedPayer: string,
  ): void {
    let amountMatches = false;
    try {
      amountMatches =
        evidence !== undefined &&
        parseUnsignedInteger(evidence.amount, "finality.amount") ===
          parseUnsignedInteger(requirements.amount, "requirements.amount");
    } catch {
      amountMatches = false;
    }
    if (
      evidence === undefined ||
      evidence.finalized !== true ||
      !Number.isSafeInteger(evidence.confirmations) ||
      evidence.confirmations < 1 ||
      evidence.network !== requirements.network ||
      evidence.transaction.toLowerCase() !==
        response.transaction.toLowerCase() ||
      evidence.payer.toLowerCase() !== expectedPayer.toLowerCase() ||
      evidence.payTo.toLowerCase() !== requirements.payTo.toLowerCase() ||
      evidence.asset.toLowerCase() !== requirements.asset.toLowerCase() ||
      !amountMatches ||
      evidence.evidenceReference.length < 1 ||
      evidence.evidenceReference.length > 512 ||
      !Number.isFinite(Date.parse(evidence.observedAt)) ||
      paymentKey.length === 0
    )
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        "Independent chain evidence did not prove the complete settlement effect",
        409,
      );
  }

  private failureResponse(
    requirements: PaymentRequirements,
    errorReason: string,
    errorMessage: string,
  ): SettleResponse {
    return {
      success: false,
      transaction: "",
      network: requirements.network,
      errorReason,
      errorMessage,
    };
  }
}
