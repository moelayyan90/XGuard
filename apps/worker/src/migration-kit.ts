const BASE_MAINNET = "eip155:8453";

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
    requestedName ||
    (resource === null ? "merchant" : new URL(resource).hostname);

  return new Response(
    JSON.stringify({
      schemaVersion: "1",
      title: "XGuard x402 facilitator switch kit",
      protocol: "x402-v2",
      network: BASE_MAINNET,
      target: {
        merchant: merchantName,
        resource,
        sourceFacilitators: sources.length > 0 ? sources : ["unknown"],
      },
      xguard: {
        origin: url.origin,
        register: `${url.origin}/v1/register`,
        balance: `${url.origin}/v1/balance`,
        topUpIntent: `${url.origin}/v1/topups/intents`,
        supported: `${url.origin}/supported`,
        verify: `${url.origin}/verify`,
        settle: `${url.origin}/settle`,
        discovery: `${url.origin}/discovery/resources`,
      },
      steps: [
        {
          id: "register",
          request: {
            method: "POST",
            url: `${url.origin}/v1/register`,
            headers: { "Content-Type": "application/json" },
            body: { name: merchantName },
          },
          output: "Store the returned apiKey; XGuard stores only its hash.",
        },
        {
          id: "fund-service-balance",
          request: {
            method: "POST",
            url: `${url.origin}/v1/topups/intents`,
            authorization: "Bearer <apiKey>",
          },
          note: "Create a Base USDC prepaid service-balance intent before billable settlements.",
        },
        {
          id: "switch-facilitator",
          facilitatorBaseUrl: url.origin,
          authorization: "Bearer <apiKey>",
          preserve: [
            "existing x402 middleware",
            "payment requirements",
            "payTo recipient",
            "resource pricing",
          ],
        },
        {
          id: "verify-cutover",
          checks: [
            `GET ${url.origin}/supported`,
            `POST ${url.origin}/verify`,
            `POST ${url.origin}/settle`,
            `GET ${url.origin}/discovery/resources?network=${encodeURIComponent(BASE_MAINNET)}`,
          ],
        },
      ],
      sideEffects: false,
      note: "This endpoint generates instructions only. It does not register, fund, modify, or contact any third-party service.",
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
    resource.hash = "";
    return resource.toString();
  } catch {
    return null;
  }
}
