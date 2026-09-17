import { pathToFileURL } from "node:url";

const PATH = "/v1/agent-token-usage/summary";
export async function verifyAgentUsage({ fetcher = fetch, origins = ["https://xguardgate.com", "https://api.xguardgate.com"], expectedTag = "" } = {}) {
  const results = [];
  for (const origin of origins) {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Verification origins must be credential-free HTTPS origins.");
    const headers = { "content-type": "application/json", "cache-control": "no-cache", "user-agent": "xguard-usage-contract-probe/1.0.0", "x-xguard-traffic-class": "synthetic" };
    // No credentials or valid event: this probe must never record real usage.
    const response = await fetcher(`${url.origin}${PATH}?tenantId=org_125646628718641154`, { method: "POST", redirect: "manual", headers, body: "{}", signal: AbortSignal.timeout(15000) });
    const data = await response.json().catch(() => null);
    if (![401, 403].includes(response.status) || data?.accepted !== false || data?.error?.code !== "tenant_identity_required") {
      throw new Error(`${url.origin}: expected explicit tenant authentication rejection, got HTTP ${response.status} (${data?.error?.code || "invalid_response"}).`);
    }
    const tag = response.headers.get("x-xguard-worker-version-tag");
    if (expectedTag && tag !== expectedTag) throw new Error(`${url.origin}: deployed version mismatch (${tag || "missing"}).`);
    const discovery = await fetcher(`${url.origin}/openapi.json?usage_contract_probe=${Date.now()}`, { redirect: "manual", headers, signal: AbortSignal.timeout(15000) });
    const spec = await discovery.json().catch(() => null);
    const operation = spec?.paths?.[PATH]?.post;
    if (!discovery.ok || operation?.operationId !== "recordAgentTokenUsage" || !operation.security?.length || !operation.responses?.[409] || !operation.responses?.[413]) {
      throw new Error(`${url.origin}: deployed OpenAPI does not advertise the secure usage contract.`);
    }
    const unknown = await fetcher(`${url.origin}/v1/unknown-agent-usage-probe`, { redirect: "manual", headers, signal: AbortSignal.timeout(15000) });
    const recovery = await unknown.json().catch(() => null);
    if (unknown.status !== 404 || recovery?.error?.code !== "unsupported_endpoint" || !recovery?.discovery?.openapi) throw new Error(`${url.origin}: unknown-route recovery contract is missing.`);
    results.push({ origin: url.origin, status: response.status, error: data.error.code, openapi: "verified", unknown_route_recovery: "verified", worker_version_tag: tag, usage_written: false });
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify({ ok: true, checks: await verifyAgentUsage({ expectedTag: process.env.EXPECTED_XGUARD_TAG || "" }) }, null, 2));
  } catch (error) { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; }
}
