const base = (process.env.XGUARD_BASE_URL || "https://xguardgate.com").replace(
  /\/$/u,
  "",
);

const health = await fetch(`${base}/healthz`);
if (!health.ok) throw new Error(`liveness failed: HTTP ${health.status}`);
const statusResponse = await fetch(`${base}/v1/status`);
if (!statusResponse.ok)
  throw new Error(`status failed: HTTP ${statusResponse.status}`);
const status = await statusResponse.json();
if (status?.service !== "XGuard Autonomous AI Inference Provider")
  throw new Error("unexpected production service identity");

const modelsResponse = await fetch(`${base}/v1/models`);
if (!modelsResponse.ok)
  throw new Error(`models failed: HTTP ${modelsResponse.status}`);
const models = await modelsResponse.json();
const active = Array.isArray(models?.data) ? models.data : [];
const token = process.env.DGRID_PROVIDER_API_KEY;
if (!token) {
  console.log(
    `Public smoke passed; real inference skipped because DGRID_PROVIDER_API_KEY is not available to this runner. Active models: ${active.length}.`,
  );
  process.exit(0);
}
if (active.length === 0)
  throw new Error("credential exists but no model is active");

const response = await fetch(`${base}/v1/chat/completions`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-request-id": `deployment-smoke-${Date.now()}`,
  },
  body: JSON.stringify({
    model: active[0].id,
    messages: [{ role: "user", content: "Reply with exactly: XGUARD_OK" }],
    max_tokens: 16,
    temperature: 0,
  }),
});
const body = await response.text();
if (!response.ok)
  throw new Error(
    `real inference failed: HTTP ${response.status} ${body.slice(0, 200)}`,
  );
const result = JSON.parse(body);
if (!Array.isArray(result?.choices) || result.choices.length === 0)
  throw new Error("real inference response has no choices");
console.log(`Real inference passed for ${active[0].id}.`);
