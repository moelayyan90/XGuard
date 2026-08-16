const BASE_MAINNET = "eip155:8453";
const DEFAULT_EXAMPLE_TOPUP_USD = "1.00";

export function xguardMigrationResponse(request: Request): Response | null {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  if (url.pathname !== "/.well-known/xguard/migrate") return null;

  const sources = [
    ...new Set(
      (url.searchParams.get("from") ?? "unknown")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value === "cdp" || value === "payai"),
    ),
  ];
  const resource = migrationResource(url.searchParams.get("resource"));
  const requestedName = (url.searchParams.get("name") ?? "")
    .trim()
    .slice(0, 160);
  const merchantName =
    requestedName || (resource === null ? "merchant" : new URL(resource).hostname);

  return new Response(
    JSON.stringify({
      schemaVersion: "2",
      title: "XGuard x402 facilitator switch kit",
      protocol: "x402-v2",
      network: BASE_MAINNET,
      sideEffects: false,
      paymentExecution: false,
      target: {
        merchant: merchantName,
        resource,
        sourceFacilitators: sources.length > 0 ? sources : ["unknown"],
      },
      prerequisites: {
        merchantControlsResourceServerConfiguration: true,
        asset: "native Base USDC",
        note: "XGuard cannot change another operator's service configuration or move funds on the merchant's behalf.",
      },
      xguard: {
        origin: url.origin,
        register: `${url.origin}/v1/register`,
        balance: `${url.origin}/v1/balance`,
        topUpIntent: `${url.origin}/v1/topups/intents`,
        topUpClaim: `${url.origin}/v1/topups/claim`,
        supported: `${url.origin}/supported`,
        ready: `${url.origin}/readyz`,
        providerManifest: `${url.origin}/.well-known/x402/facilitator.json`,
        verify: `${url.origin}/verify`,
        settle: `${url.origin}/settle`,
        discovery: `${url.origin}/discovery/resources`,
      },
      steps: [
        {
          id: "register",
          sideEffects: "creates-xguard-merchant-credential",
          requiresOperatorAction: true,
          request: {
            method: "POST",
            url: `${url.origin}/v1/register`,
            headers: { "Content-Type": "application/json" },
            body: { name: merchantName },
          },
          output: "Store the returned apiKey as a secret; XGuard stores only its hash.",
        },
        {
          id: "fund-service-balance",
          sideEffects: "requires-merchant-selected-usdc-transfer",
          requiresOperatorAction: true,
          createIntent: {
            method: "POST",
            url: `${url.origin}/v1/topups/intents`,
            authorization: "Bearer <apiKey>",
            requiredBodyField: "amountUsd",
            exampleBody: { amountUsd: DEFAULT_EXAMPLE_TOPUP_USD },
          },
          claimAfterFinality: {
            method: "POST",
            url: `${url.origin}/v1/topups/claim`,
            authorization: "Bearer <apiKey>",
            requiredBodyFields: ["claimToken", "transactionHash"],
          },
          note: "The merchant chooses the amount, sends exactly the returned native Base USDC amount to the returned treasury address, waits for Base finality, then claims it. A top-up is prepaid service balance, not earned XGuard revenue.",
        },
        {
          id: "switch-facilitator-client",
          sideEffects: "merchant-configuration-change",
          requiresOperatorAction: true,
          facilitatorBaseUrl: url.origin,
          authorization: "Bearer <apiKey>",
          preserve: [
            "existing x402 middleware",
            "payment requirements",
            "payTo recipient",
            "resource pricing",
          ],
          officialClientPattern: {
            package: "@x402/core/http",
            client: "HTTPFacilitatorClient",
            url: url.origin,
            authHeader: "Authorization: Bearer <apiKey>",
          },
        },
        {
          id: "safe-precutover-checks",
          sideEffects: false,
          requests: [
            `GET ${url.origin}/healthz`,
            `GET ${url.origin}/readyz`,
            `GET ${url.origin}/supported`,
            `GET ${url.origin}/.well-known/x402/facilitator.json`,
            `GET ${url.origin}/v1/balance with Authorization: Bearer <apiKey>`,
            `GET ${url.origin}/discovery/resources?network=${encodeURIComponent(BASE_MAINNET)}`,
          ],
        },
        {
          id: "real-payment-cutover",
          sideEffects: "merchant-controlled-real-x402-traffic",
          requiresOperatorAction: true,
          note: "Do not synthesize /verify or /settle calls merely to test cutover. Route the merchant's existing real x402 payment flow through the configured official facilitator client; XGuard's authenticated client invokes /verify and /settle with the real protocol payload.",
          endpoints: {
            verify: `${url.origin}/verify`,
            settle: `${url.origin}/settle`,
          },
        },
      ],
      automationBoundary: {
        generatedInstructionsOnly: true,
        registersMerchantAutomatically: false,
        fundsBalanceAutomatically: false,
        changesThirdPartyConfigurationAutomatically: false,
        createsSyntheticPayments: false,
        callsVerifyOrSettleWithoutRealProtocolTraffic: false,
      },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=300",
        "Access-Control-Allow-Origin": "*",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

function migrationResource(value: string | null): string | null {
  if (value === null || value.length === 0 || value.length > 2_048) return null;
  try {
    const resource = new URL(value);
    if (resource.protocol !== "https:" && resource.protocol !== "http:")
      return null;
    resource.username = "";
    resource.password = "";
    resource.hash = "";
    return resource.toString();
  } catch {
    return null;
  }
}
