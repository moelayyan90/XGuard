import { discoveryResponse } from "./discovery.js";

const X402_ALIAS = "/.well-known/x402";
const MONETIZATION_PATH = "/.well-known/monetization";
const PROVIDER_PATH = "/.well-known/x402/facilitator.json";
const DISCOVERY_CACHE_CONTROL =
  "public, max-age=3600, stale-while-revalidate=86400";
const MONETIZATION_ETAG = '"xguard-monetization-v1"';

export async function compatibilityDiscoveryResponse(
  request: Request,
): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;

  const url = new URL(request.url);
  if (url.pathname === X402_ALIAS) return x402AliasResponse(request);
  if (url.pathname === MONETIZATION_PATH)
    return monetizationResponse(request);
  return null;
}

function x402AliasResponse(request: Request): Response | null {
  const target = canonicalProviderUrl(request.url);
  const headers = new Headers();
  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch !== null) headers.set("If-None-Match", ifNoneMatch);

  return discoveryResponse(
    new Request(target, {
      method: request.method,
      headers,
    }),
  );
}

async function monetizationResponse(request: Request): Promise<Response> {
  if (request.headers.get("if-none-match") === MONETIZATION_ETAG)
    return new Response(null, {
      status: 304,
      headers: discoveryHeaders({ ETag: MONETIZATION_ETAG }),
    });

  const providerResponse = discoveryResponse(
    new Request(canonicalProviderUrl(request.url)),
  );
  if (providerResponse === null || !providerResponse.ok) {
    return jsonResponse(
      request,
      { error: "provider_manifest_unavailable" },
      503,
    );
  }

  const provider = asRecord(await providerResponse.json());
  const origin = new URL(request.url).origin;
  const body = {
    manifest: "xguard-monetization-v1",
    schemaVersion: 1,
    service: {
      id: provider.id,
      name: provider.name,
      version: provider.version,
    },
    pricing: provider.pricing,
    onboarding: provider.onboarding,
    x402: {
      providerManifest: `${origin}${PROVIDER_PATH}`,
      discovery: `${origin}${X402_ALIAS}`,
      supported: `${origin}/supported`,
      verify: `${origin}/verify`,
      settle: `${origin}/settle`,
    },
    note:
      "XGuard compatibility metadata for machine pricing discovery. Use /supported for live x402 capabilities and signer attribution.",
  };

  return jsonResponse(request, body, 200, { ETag: MONETIZATION_ETAG });
}

function canonicalProviderUrl(requestUrl: string): string {
  const target = new URL(requestUrl);
  target.pathname = PROVIDER_PATH;
  target.search = "";
  return target.toString();
}

function jsonResponse(
  request: Request,
  value: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(
    request.method === "HEAD" ? null : JSON.stringify(value, null, 2),
    {
      status,
      headers: discoveryHeaders({
        "Content-Type": "application/json; charset=utf-8",
        ...extraHeaders,
      }),
    },
  );
}

function discoveryHeaders(extra: Record<string, string>): Headers {
  return new Headers({
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": DISCOVERY_CACHE_CONTROL,
    "X-Content-Type-Options": "nosniff",
    ...extra,
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("expected_provider_manifest_object");
  return value as Record<string, unknown>;
}
