import { describe, expect, it, vi } from "vitest";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { declareOfferReceiptExtension } from "@x402/extensions/offer-receipt";
import {
  PAYMENT_IDENTIFIER,
  declarePaymentIdentifierExtension,
} from "@x402/extensions/payment-identifier";
import {
  checkEndpoint,
  type EndpointCheckerDependencies,
} from "../apps/gateway/src/checker.js";
import { fixturePayment } from "./fixtures.js";

function dependencies(
  response: Response,
  addresses: { address: string; family: number }[] = [
    { address: "1.1.1.1", family: 4 },
  ],
): EndpointCheckerDependencies {
  return {
    lookup: vi.fn(async () => addresses),
    fetch: vi.fn(async () => response),
  };
}

function paymentHeader(
  options: {
    scheme?: string;
    network?: `${string}:${string}`;
    paymentFlow?: string;
    includeEip712Domain?: boolean;
  } = {},
): string {
  const payment = fixturePayment({ network: options.network });
  payment.requirements.scheme = options.scheme ?? "exact";
  payment.payload.accepted.scheme = options.scheme ?? "exact";
  payment.requirements.extra = {
    ...payment.requirements.extra,
    paymentFlow: options.paymentFlow ?? "authorization",
    ...(options.includeEip712Domain === false
      ? {}
      : { name: "USDC", version: "2" }),
  };
  payment.payload.accepted = structuredClone(payment.requirements);
  return encodePaymentRequiredHeader({
    x402Version: 2,
    resource: payment.payload.resource,
    accepts: [payment.requirements],
    extensions: {
      [PAYMENT_IDENTIFIER]: declarePaymentIdentifierExtension(false),
      ...declareDiscoveryExtension({
        method: "GET",
        output: {
          example: { ok: true },
          schema: {
            type: "object",
            properties: { ok: { type: "boolean" } },
            required: ["ok"],
          },
        },
      }),
      ...declareOfferReceiptExtension(),
    },
  });
}

describe("public endpoint compatibility checker", () => {
  it("validates an exact EVM 402 and reports discovery features", async () => {
    const deps = dependencies(
      new Response("payment required", {
        status: 402,
        headers: {
          "Payment-Required": paymentHeader(),
          "Cache-Control": "private, no-store",
        },
      }),
    );
    const result = await checkEndpoint("https://merchant.example/paid", deps);
    expect(result).toMatchObject({
      compatible: true,
      status: 402,
      protocolVersion: 2,
      facilitatorMigration: "YES",
      compatibilityScope: "x402-v2-exact-eip155:84532-authorization",
      features: {
        paymentIdentifier: true,
        bazaar: true,
        offerReceipt: true,
      },
      issues: [],
    });
    expect(result.featureEvidence.paymentIdentifier).toMatch(/not exercised/);
    expect(result.featureEvidence.bazaar).toMatch(/not verified/);
    expect(deps.lookup).toHaveBeenCalledWith("merchant.example", {
      all: true,
      verbatim: true,
    });
    expect(deps.fetch).toHaveBeenCalledOnce();
  });

  it("reports non-compatible scheme and unsafe shared caching", async () => {
    const result = await checkEndpoint(
      "https://merchant.example/paid",
      dependencies(
        new Response("payment required", {
          status: 402,
          headers: {
            "Payment-Required": paymentHeader({ scheme: "upto" }),
            "Cache-Control": "public, s-maxage=60",
          },
        }),
      ),
    );
    expect(result.compatible).toBe(false);
    expect(result.issues).toContain(
      "No structurally valid x402 v2 exact authorization option for eip155:84532 is advertised",
    );
    expect(result.issues).toContain("HTTP 402 is marked as shared-cacheable");
  });

  it("does not advertise unsupported networks, flows, or incomplete EIP-3009 terms", async () => {
    for (const header of [
      paymentHeader({ network: "eip155:8453" }),
      paymentHeader({ paymentFlow: "upfront" }),
      paymentHeader({ includeEip712Domain: false }),
    ]) {
      const result = await checkEndpoint(
        "https://merchant.example/paid",
        dependencies(
          new Response("payment required", {
            status: 402,
            headers: { "Payment-Required": header },
          }),
        ),
      );
      expect(result.compatible).toBe(false);
      expect(result.facilitatorMigration).toBe("UNKNOWN");
    }
  });

  it("blocks private DNS, credentialed URLs, local names, and non-443 ports", async () => {
    await expect(
      checkEndpoint(
        "https://merchant.example/paid",
        dependencies(new Response(""), [{ address: "127.0.0.1", family: 4 }]),
      ),
    ).rejects.toThrow(/non-public/);
    await expect(
      checkEndpoint(
        "https://user:secret@merchant.example/paid",
        dependencies(new Response("")),
      ),
    ).rejects.toThrow(/credentials/);
    await expect(
      checkEndpoint("https://localhost/paid", dependencies(new Response(""))),
    ).rejects.toThrow(/Local/);
    await expect(
      checkEndpoint(
        "https://merchant.example:8443/paid",
        dependencies(new Response("")),
      ),
    ).rejects.toThrow(/443/);
  });

  it("rejects oversized response bodies and malformed headers", async () => {
    await expect(
      checkEndpoint(
        "https://merchant.example/paid",
        dependencies(
          new Response("a".repeat(70_000), {
            status: 402,
            headers: { "Payment-Required": paymentHeader() },
          }),
        ),
      ),
    ).rejects.toThrow(/response exceeds/);

    const malformed = await checkEndpoint(
      "https://merchant.example/paid",
      dependencies(
        new Response("", {
          status: 402,
          headers: { "Payment-Required": "not-base64-json" },
        }),
      ),
    );
    expect(malformed.compatible).toBe(false);
    expect(malformed.issues).toContain(
      "PAYMENT-REQUIRED is not valid base64-encoded strict JSON",
    );
  });
});
