import { describe, expect, it } from "vitest";
import { xguardMigrationResponse } from "../apps/worker/src/migration-kit.js";

const ORIGIN = "https://xguard-mainnet.maqamapp.workers.dev";

interface MigrationStep {
  id?: string;
  request?: unknown;
  createIntent?: unknown;
  claimAfterFinality?: { requiredBodyFields?: string[] };
  sideEffects?: boolean;
  requests?: string[];
  requiresOperatorAction?: boolean;
  note?: string;
}

interface MigrationKitBody {
  schemaVersion: string;
  protocol: string;
  network: string;
  sideEffects: boolean;
  paymentExecution: boolean;
  target: {
    merchant: string;
    resource?: string | null;
    sourceFacilitators: string[];
  };
  steps: MigrationStep[];
  automationBoundary: Record<string, boolean>;
}

describe("safe merchant migration kit", () => {
  it("returns side-effect-free instructions with the documented registration and top-up contracts", async () => {
    const response = xguardMigrationResponse(
      new Request(
        `${ORIGIN}/.well-known/xguard/migrate?from=cdp,payai&name=my-service&resource=${encodeURIComponent("https://user:secret@example.com/api#fragment")}`,
      ),
    );
    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);
    expect(response!.headers.get("access-control-allow-origin")).toBe("*");
    expect(response!.headers.get("x-content-type-options")).toBe("nosniff");
    const body = (await response!.json()) as MigrationKitBody;

    expect(body).toMatchObject({
      schemaVersion: "2",
      protocol: "x402-v2",
      network: "eip155:8453",
      sideEffects: false,
      paymentExecution: false,
      target: {
        merchant: "my-service",
        sourceFacilitators: ["cdp", "payai"],
      },
    });
    expect(body.target.resource).toBe("https://example.com/api");
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(JSON.stringify(body)).not.toContain("user@");

    const register = body.steps.find((step) => step.id === "register");
    expect(register?.request).toMatchObject({
      method: "POST",
      url: `${ORIGIN}/v1/register`,
      body: { name: "my-service" },
    });

    const funding = body.steps.find(
      (step) => step.id === "fund-service-balance",
    );
    expect(funding?.createIntent).toMatchObject({
      method: "POST",
      url: `${ORIGIN}/v1/topups/intents`,
      requiredBodyField: "amountUsd",
      exampleBody: { amountUsd: "1.00" },
    });
    expect(funding?.claimAfterFinality?.requiredBodyFields).toEqual([
      "claimToken",
      "transactionHash",
    ]);
  });

  it("keeps pre-cutover verification non-paying and refuses synthetic settlement guidance", async () => {
    const response = xguardMigrationResponse(
      new Request(`${ORIGIN}/.well-known/xguard/migrate?from=cdp`),
    );
    const body = (await response!.json()) as MigrationKitBody;
    const checks = body.steps.find(
      (step) => step.id === "safe-precutover-checks",
    );
    expect(checks?.sideEffects).toBe(false);
    expect(checks?.requests?.every((item) => item.startsWith("GET "))).toBe(
      true,
    );
    expect(checks?.requests?.join("\n")).not.toContain("/verify");
    expect(checks?.requests?.join("\n")).not.toContain("/settle");

    const cutover = body.steps.find(
      (step) => step.id === "real-payment-cutover",
    );
    expect(cutover?.requiresOperatorAction).toBe(true);
    expect(cutover?.note).toContain("Do not synthesize /verify or /settle");
    expect(body.automationBoundary).toEqual({
      generatedInstructionsOnly: true,
      registersMerchantAutomatically: false,
      fundsBalanceAutomatically: false,
      changesThirdPartyConfigurationAutomatically: false,
      createsSyntheticPayments: false,
      callsVerifyOrSettleWithoutRealProtocolTraffic: false,
    });
  });

  it("ignores unsupported source hints and does not handle other routes or methods", async () => {
    const response = xguardMigrationResponse(
      new Request(`${ORIGIN}/.well-known/xguard/migrate?from=unknown,cdp,evil`),
    );
    const body = (await response!.json()) as MigrationKitBody;
    expect(body.target.sourceFacilitators).toEqual(["cdp"]);

    expect(xguardMigrationResponse(new Request(`${ORIGIN}/status`))).toBeNull();
    expect(
      xguardMigrationResponse(
        new Request(`${ORIGIN}/.well-known/xguard/migrate`, { method: "POST" }),
      ),
    ).toBeNull();
  });
});
