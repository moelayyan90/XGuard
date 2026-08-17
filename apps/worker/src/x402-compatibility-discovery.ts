const PROVIDER_PATHS = new Set([
  "/.well-known/x402/facilitator.json",
  "/.well-known/x402.json",
  "/provider.json",
]);

export async function augmentCompatibilityDiscovery(
  response: Response,
  path: string,
): Promise<Response> {
  if (!response.ok || !isCompatibilityDiscoveryPath(path)) return response;
  try {
    const parsed = (await response.clone().json()) as unknown;
    if (!isRecord(parsed)) return response;

    const compatibility = {
      mode: "transaction-compatibility-bridge",
      canonical: {
        x402Version: 2,
        scheme: "exact",
        network: "eip155:8453",
      },
      acceptedLegacy: [
        {
          x402Version: 1,
          scheme: "exact",
          network: "base",
          translation: "maxAmountRequired->amount; base->eip155:8453",
        },
      ],
      invariant:
        "The EIP-3009 authorization payload and signature are preserved verbatim; only the x402 protocol envelope is normalized.",
      endpoints: {
        verify: "/verify",
        settle: "/settle",
        supported: "/supported",
      },
    };

    parsed.compatibility = compatibility;

    if (PROVIDER_PATHS.has(path)) {
      const protocol = isRecord(parsed.protocol) ? parsed.protocol : {};
      parsed.protocol = {
        ...protocol,
        version: 2,
        canonicalVersion: 2,
        supportedVersions: [1, 2],
      };
      const facilitator = isRecord(parsed.facilitator)
        ? parsed.facilitator
        : {};
      parsed.facilitator = {
        ...facilitator,
        compatibilityBridge: {
          accepts: ["x402-v1 exact@base", "x402-v2 exact@eip155:8453"],
          canonicalizesTo: "x402-v2 exact@eip155:8453",
        },
      };

      const safety = isRecord(parsed.safety) ? parsed.safety : {};
      parsed.safety = {
        ...safety,
        merchantFacingSettlementTruth: true,
        activeAmbiguityResolution: true,
        releaseSafeOnlyAfterIndependentFinality: true,
        blindResubmissionAfterAmbiguity: false,
      };
      parsed.settlementTruth = {
        version: "xguard-settlement-truth-v1",
        role: "independent-finality-and-recovery-layer",
        states: ["FINALIZED", "PENDING", "PROVEN_FAILED", "CONFLICT"],
        releaseSafeState: "FINALIZED",
        truthEndpoint: "/v1/settlements/{logicalPaymentKey}/truth",
        resolveEndpoint: "/v1/settlements/{logicalPaymentKey}/resolve",
        authentication: "merchant-bearer",
        evidence: [
          "finalized Base USDC transfer",
          "EIP-3009 AuthorizationUsed",
          "EIP-3009 AuthorizationCanceled",
        ],
        invariant:
          "An ambiguous post-submit outcome is never treated as permission for a blind second settlement submission.",
      };
    }

    if (
      path === "/.well-known/agent-card.json" ||
      path === "/.well-known/agent.json"
    ) {
      const capabilities = isRecord(parsed.capabilities)
        ? parsed.capabilities
        : {};
      parsed.capabilities = {
        ...capabilities,
        x402CompatibilityBridge: true,
      };
    }

    const headers = new Headers(response.headers);
    headers.set("Content-Type", "application/json; charset=utf-8");
    headers.delete("Content-Length");
    headers.set("X-XGuard-Compatibility", "x402-v1-v2");
    return new Response(JSON.stringify(parsed), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return response;
  }
}

function isCompatibilityDiscoveryPath(path: string): boolean {
  return (
    path === "/" ||
    PROVIDER_PATHS.has(path) ||
    path === "/.well-known/agent-card.json" ||
    path === "/.well-known/agent.json" ||
    path === "/.well-known/agent-market.json"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
