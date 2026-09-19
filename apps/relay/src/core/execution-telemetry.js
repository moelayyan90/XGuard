const HOUR = 3600000;
const EVENTS = new Set(["mcp_initialize", "mcp_tools_list", "mcp_tool_call", "execution", "provider_execution", "provider_replay", "preflight", "proof_verification", "credential_created", "capability_created", "capability_revoked"]);
const label = x => typeof x === "string" && /^[A-Za-z0-9_.:-]{1,100}$/.test(x) ? x : "unknown";
export function telemetryClass(request) {
  const declared = request.headers.get("x-xguard-traffic-class");
  if (["synthetic", "monitoring", "registry", "security_scan", "demo", "canary", "testnet", "self_test", "internal"].includes(declared)) return declared;
  if (/mcpbeat|uptime|healthcheck|pingdom|statuscake/i.test(request.headers.get("user-agent") || "")) return "monitoring";
  return "unattributed"; // A user-controlled header alone cannot establish a real external buyer.
}
export async function recordTelemetry(storage, raw, now = Date.now()) {
  if (!EVENTS.has(raw.event)) throw new Error("invalid_telemetry_event");
  const latency = Number.isFinite(raw.latency_ms) ? Math.max(0, Math.min(120000, raw.latency_ms)) : null;
  const group = `${raw.event}:${label(raw.traffic_class)}:${label(raw.operation || "all")}`;
  await storage.transaction(async tx => {
    const state = await tx.get("execution-telemetry:v1") || { started_at: now, hours: [] };
    const hour = Math.floor(now / HOUR);
    for (const old of state.hours || []) if (old <= hour - 24) await tx.delete(`telemetry-hour:${old}`);
    state.hours = (state.hours || []).filter(x => x > hour - 24);
    if (!state.hours.includes(hour)) state.hours.push(hour);
    const bucket = await tx.get(`telemetry-hour:${hour}`) || { hour, groups: {} };
    // Only server-chosen finite event/operation groups are accepted by the caller.
    if (!bucket.groups[group] && Object.keys(bucket.groups).length >= 64) return;
    const item = bucket.groups[group] ||= { requests: 0, successes: 0, failures: {}, latencies: [] };
    item.requests++;
    if (raw.ok === true) item.successes++;
    else { let reason = label(raw.reason || "request_failed"); if (!Object.hasOwn(item.failures, reason) && Object.keys(item.failures).length >= 8) reason = "other"; item.failures[reason] = (item.failures[reason] || 0) + 1; }
    if (latency !== null) { item.latencies.push(latency); if (item.latencies.length > 32) item.latencies.shift(); }
    state.updated_at = now;
    await tx.put(`telemetry-hour:${hour}`, bucket);
    await tx.put("execution-telemetry:v1", state);
  });
}
export async function telemetrySnapshot(storage, now = Date.now()) {
  const state = await storage.get("execution-telemetry:v1");
  const groups = {};
  const buckets = await Promise.all((state?.hours || []).filter(x => x > Math.floor(now / HOUR) - 24).map(x => storage.get(`telemetry-hour:${x}`)));
  for (const bucket of buckets.filter(Boolean)) {
    if (bucket.hour <= Math.floor(now / HOUR) - 24) continue;
    for (const [key, row] of Object.entries(bucket.groups)) {
      const item = groups[key] ||= { requests: 0, successes: 0, failures: {}, samples: [] };
      item.requests += row.requests; item.successes += row.successes; item.samples.push(...row.latencies);
      for (const [reason, count] of Object.entries(row.failures)) item.failures[reason] = (item.failures[reason] || 0) + count;
    }
  }
  for (const item of Object.values(groups)) {
    item.samples.sort((a, b) => a - b);
    const p = n => item.samples.length ? item.samples[Math.max(0, Math.ceil(n * item.samples.length) - 1)] : null;
    Object.assign(item, { success_rate: item.requests ? item.successes / item.requests : null,
      latency_ms: { p50: p(.5), p95: p(.95), p99: p(.99), sampled_requests: item.samples.length, sampling: "last 32 requests per hour per group" } });
    delete item.samples;
  }
  return { window: "current hour and preceding 23 UTC hours", observed_since: state ? new Date(state.started_at).toISOString() : null,
    last_observation: state?.updated_at ? new Date(state.updated_at).toISOString() : null, groups,
    empty_means: "No observations in this window; no uptime claim is inferred.", revenue: "These request counters do not measure revenue." };
}
export function executionTelemetryStub(env) {
  return env.EGRESS_METER?.get(env.EGRESS_METER.idFromName("execution-observability-v1"));
}
export function observeExecution(ctx, env, request, details) {
  if (!ctx?.waitUntil || !env.EGRESS_METER) return;
  ctx.waitUntil(executionTelemetryStub(env).fetch("https://meter/telemetry/record", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...details, traffic_class: telemetryClass(request) }) }).catch(() => {}));
}
