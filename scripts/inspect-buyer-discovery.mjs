// Read-only buyer-side discovery evidence. No signer, settlement or registration.
const cdp = "https://api.cdp.coinbase.com/platform/v2/x402";
const resource = "https://api.xguardgate.com/v1/execute";
async function probe(path, options, summarize) {
  try {
    const response = await fetch(cdp + path, {
      ...options, redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { accept: "application/json", "content-type": "application/json", "user-agent": "XGuard-Discovery-Observer/1.0" },
    });
    if (!response.ok) return { status: "unknown", http_status: response.status };
    return { http_status: response.status, ...summarize(await response.json()) };
  } catch (error) { return { status: "unknown", reason: error.name === "TimeoutError" ? "timeout" : "network_or_response_error" }; }
}
const results = await Promise.all([
  probe("/discovery/search?url=api.xguardgate.com&limit=20", {}, data => {
    if (!Array.isArray(data.resources)) return { status: "unknown", reason: "unexpected_schema" };
    const matches = data.resources.filter(item => {
      try { return new URL(item.resource).hostname === "api.xguardgate.com"; } catch { return false; }
    });
    return { status: matches.length ? "records_returned" : "no_matching_records_returned", partial_results: data.partialResults ?? null,
      resources: matches.map(item => ({ resource: item.resource, curated: item.curated ?? null, quality: item.quality ?? null })) };
  }),
  probe("/validate", { method: "POST", body: JSON.stringify({ resource, method: "POST" }) }, data => ({
    status: typeof data.valid === "boolean" ? "observed" : "unknown", valid: data.valid ?? null,
    resource_http_status: data.statusCode ?? null, simulation: data.simulation?.outcome ?? null,
    index_active: data.index?.active ?? null,
    checks: Array.isArray(data.preflight) ? data.preflight.map(check => ({ check: check.check, passed: check.passed, severity: check.severity })) : [],
  })),
]);
console.log(JSON.stringify({ observed_at: new Date().toISOString(), source: cdp, resource,
  search: results[0], empty_post_validation: results[1], payment_performed: false,
  limitations: ["The public validator cannot send an intent body; an empty POST is intentionally rejected",
    "Bazaar metadata is not proof of listing, curation or demand", "Coinbase documents indexing after a settled call through its CDP Facilitator"],
}, null, 2));
