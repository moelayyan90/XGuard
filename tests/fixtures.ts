import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from "@x402/core/types";
import type { FacilitatorClient } from "@x402/core/http";

export const PAY_TO = "0x2222222222222222222222222222222222222222";
export const PAYER = "0x1111111111111111111111111111111111111111";
export const ASSET = "0x3333333333333333333333333333333333333333";

export function fixturePayment(
  options: {
    network?: `${string}:${string}`;
    nonce?: string;
    paymentId?: string | null;
    amount?: string;
    payTo?: string;
  } = {},
): { payload: PaymentPayload; requirements: PaymentRequirements } {
  const network = options.network ?? "eip155:84532";
  const amount = options.amount ?? "1000";
  const payTo = options.payTo ?? PAY_TO;
  const requirements: PaymentRequirements = {
    scheme: "exact",
    network,
    asset: ASSET,
    amount,
    payTo,
    maxTimeoutSeconds: 60,
    extra: { assetTransferMethod: "eip3009", paymentFlow: "authorization" },
  };
  const paymentId =
    options.paymentId === undefined
      ? "pay_1234567890abcdef1234567890abcdef"
      : options.paymentId;
  const payload: PaymentPayload = {
    x402Version: 2,
    resource: {
      url: "https://merchant.example/resource",
      description: "Test resource",
      mimeType: "application/json",
    },
    accepted: structuredClone(requirements),
    payload: {
      signature: `0x${"ab".repeat(65)}`,
      authorization: {
        from: PAYER,
        to: payTo,
        value: amount,
        validAfter: "0",
        validBefore: (
          BigInt(Math.floor(Date.now() / 1_000)) + 3_600n
        ).toString(),
        nonce: options.nonce ?? `0x${"12".repeat(32)}`,
      },
    },
    ...(paymentId === null
      ? {}
      : {
          extensions: {
            "payment-identifier": { info: { required: false, id: paymentId } },
          },
        }),
  };
  return { payload, requirements };
}

export class MockFacilitator implements FacilitatorClient {
  public verifyCalls = 0;
  public settleCalls = 0;
  public delayMs = 0;
  public settleMode: "success" | "failure" | "ambiguous" = "success";

  public constructor(
    private readonly networks: `${string}:${string}`[] = ["eip155:84532"],
  ) {}

  public async verify(
    _payload: PaymentPayload,
    _requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    this.verifyCalls += 1;
    if (this.delayMs > 0)
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return { isValid: true, payer: PAYER };
  }

  public async settle(
    _payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    this.settleCalls += 1;
    if (this.delayMs > 0)
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.settleMode === "ambiguous")
      throw new Error("socket reset after request body");
    if (this.settleMode === "failure")
      return {
        success: false,
        transaction: "",
        network: requirements.network,
        errorReason: "declined",
      };
    return {
      success: true,
      transaction: `0x${"ef".repeat(32)}`,
      network: requirements.network,
      payer: PAYER,
      amount: requirements.amount,
    };
  }

  public async getSupported(): Promise<SupportedResponse> {
    return {
      kinds: this.networks.map((network) => ({
        x402Version: 2,
        scheme: "exact",
        network,
        extra: { assetTransferMethod: "eip3009", paymentFlow: "authorization" },
      })),
      extensions: ["payment-identifier", "bazaar", "offer-receipt"],
      signers: { eip155: ["0x4444444444444444444444444444444444444444"] },
    };
  }
}
