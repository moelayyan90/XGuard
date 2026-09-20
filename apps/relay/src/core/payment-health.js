import { digestBytes } from "./execution-contract.js";
const validUrl = value => { try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash ? u.href.replace(/\/$/, "") : null; } catch { return null; } };
export function paymentHealthStub(env) { return env.PAID_GATEWAY.get(env.PAID_GATEWAY.idFromName("payment-health-v1")); }
export async function recordPaymentHealth(storage, body, now = Date.now()) {
  if (!validUrl(body.url) || !["verify", "settle"].includes(body.phase) || !["eip155:8453", "eip155:84532"].includes(body.network)) throw new Error("invalid_health_event");
  const key = await digestBytes(`${body.network}:${body.url}`);
  await storage.transaction(async tx => {
    const state = await tx.get("facilitator-health:v1") || {};
    if (!state[key] && Object.keys(state).length >= 16) return;
    // Keep every value comfortably below Durable Object storage's 128 KiB limit.
    // The index contains only rail identifiers; each rail owns its bounded sample.
    const row = await tx.get(`facilitator-health:rail:${key}`) || { url: validUrl(body.url), network: body.network, observations: [], consecutive_transport_failures: 0, circuit_until: 0, last_success: null };
    const event = { at: now, phase: body.phase, ok: body.ok === true, transport_failure: body.transport_failure === true, invalid_response: body.invalid_response === true,
      ambiguous: body.ambiguous === true, latency_ms: Math.max(0, Math.min(120000, Number(body.latency_ms) || 0)) };
    row.observations = row.observations.filter(x => x.at >= now - 3600000).slice(-255); row.observations.push(event);
    row.phase_failures ||= { verify: 0, settle: 0 };
    if (event.ok) {
      row.last_success = now; row.phase_failures[event.phase] = 0;
      if (Object.values(row.phase_failures).every(count => count < 3)) row.circuit_until = 0;
    } else if (event.transport_failure || event.invalid_response) {
      row.phase_failures[event.phase]++;
      if (row.phase_failures[event.phase] >= 3) row.circuit_until = now + 60000;
    }
    // A successful verification cannot hide repeated settlement transport failures.
    row.consecutive_transport_failures = Math.max(...Object.values(row.phase_failures));
    state[key] = true;
    await tx.put(`facilitator-health:rail:${key}`, row);
    await tx.put("facilitator-health:v1", state);
  });
}
export async function paymentHealthSnapshot(storage, now = Date.now()) {
  const state = await storage.get("facilitator-health:v1") || {};
  const rows = (await Promise.all(Object.keys(state).map(key => storage.get(`facilitator-health:rail:${key}`)))).filter(Boolean);
  return { window: "last hour, at most 256 observations per configured rail", facilitators: rows.map(row => {
    const events = row.observations.filter(x => x.at >= now - 3600000);
    const phase = name => { const group = events.filter(x => x.phase === name), latencies = group.map(x => x.latency_ms).sort((a, b) => a - b);
      return { count: group.length, success_rate: group.length ? group.filter(x => x.ok).length / group.length : null,
        p50_ms: latencies.length ? latencies[Math.ceil(latencies.length * .5) - 1] : null, p95_ms: latencies.length ? latencies[Math.ceil(latencies.length * .95) - 1] : null,
        transport_failures: group.filter(x => x.transport_failure).length, invalid_responses: group.filter(x => x.invalid_response).length, ambiguous_attempts: group.filter(x => x.ambiguous).length }; };
    return { url: row.url, network: row.network, circuit: row.circuit_until > now ? "open" : "closed", circuit_until: row.circuit_until, last_success: row.last_success ? new Date(row.last_success).toISOString() : null, verify: phase("verify"), settle: phase("settle") };
  }) };
}
export async function selectFacilitator(env, config) {
  let fallback = [];
  try { fallback = JSON.parse(env.XGUARD_PAID_FACILITATOR_FALLBACKS || "[]"); } catch { throw new Error("invalid_facilitator_fallback_config"); }
  if (!Array.isArray(fallback) || fallback.length > 4 || fallback.some(x => !validUrl(x))) throw new Error("invalid_facilitator_fallback_config");
  const candidates = [...new Set([config.facilitator, ...(!config.testnet ? fallback : [])])];
  const response = await paymentHealthStub(env).fetch("https://health/facilitator/snapshot");
  if (!response.ok) throw new Error("facilitator_health_unavailable");
  const health = await response.json();
  for (const url of candidates) {
    const row = health.facilitators?.find(x => x.url === url && x.network === config.network);
    if (row?.circuit === "open") continue;
    if (url !== config.facilitator) {
      try {
        const supported = await fetch(`${url}/supported`, { redirect: "manual", signal: AbortSignal.timeout(3000) });
        if (!supported.ok || !(await supported.json()).kinds?.some(k => k.x402Version === 2 && k.scheme === "exact" && k.network === config.network)) continue;
      } catch { continue; }
    }
    return url; // Pinned durably before verify; never changed during settlement or reconciliation.
  }
  throw new Error("all_facilitator_circuits_open");
}
export async function observePaymentHealth(env, config, phase, started, details) {
  try { await paymentHealthStub(env).fetch("https://health/facilitator/record", { method: "POST", body: JSON.stringify({ url: config.facilitator, network: config.network, phase, latency_ms: Date.now() - started, ...details }) }); }
  catch { /* Settlement truth is persisted in the operation ledger independently. */ }
}
