const BILLING = "https://hooks.xguardgate.com";
const health = await fetch(`${BILLING}/healthz`, { signal: AbortSignal.timeout(12_000) });
const status = await health.json().catch(() => ({}));
if (!health.ok || status.status !== "ready" || status.version !== "5.1.0" || status.webhook_signature !== "configured") throw new Error(`Billing is not ready: HTTP ${health.status} ${JSON.stringify(status)}`);
if (status.package?.credits !== 5000 || status.package?.amount_minor !== 355 || status.package?.currency !== "JOD") throw new Error("Billing package does not match the public Lemon Squeezy variant mapping");

const invalid = await fetch(`${BILLING}/webhooks/lemonsqueezy`, { method: "POST", headers: { "content-type": "application/json", "x-signature": "0".repeat(64) }, body: JSON.stringify({ meta: { event_name: "verification_probe" }, data: { id: "readiness-probe" } }), signal: AbortSignal.timeout(12_000) });
if (invalid.status !== 401) throw new Error(`Webhook did not reject an invalid signature: HTTP ${invalid.status}`);
console.log(JSON.stringify({ ok: true, billing: BILLING, version: status.version, signature_rejection: 401, package: status.package }));
