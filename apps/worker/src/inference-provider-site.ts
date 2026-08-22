import { ORIGIN, VERSION } from "./inference-provider-types.js";

interface PublicStatus {
  live?: boolean;
  api?: string;
  network?: {
    id?: string;
    application_status?: string;
    provider_interface_status?: string;
  };
  models?: Array<{
    id?: string;
    status?: string;
    latency_ms?: number | null;
  }>;
}

export function renderPublicSite(status: Record<string, unknown>): Response {
  const data = status as PublicStatus;
  const models = data.models ?? [];
  const modelRows =
    models.length > 0
      ? models
          .map(
            (model) =>
              `<tr><td>${escapeHtml(model.id ?? "")}</td><td><span class="dot good"></span>${escapeHtml(model.status ?? "unknown")}</td><td>${model.latency_ms === null || model.latency_ms === undefined ? "—" : `${Math.round(model.latency_ms)} ms`}</td></tr>`,
          )
          .join("")
      : '<tr><td colspan="3" class="empty">No model is active. XGuard will not route inference until an approved upstream, verified pricing, current health check, and the profit guard all pass.</td></tr>';
  return html(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="XGuard Autonomous AI Inference Provider — high-availability routing with strict cost and margin controls.">
<title>XGuard Autonomous AI Inference Provider</title><style>${styles()}</style></head>
<body><main>
  <nav><a class="brand" href="/">XGUARD</a><a href="/v1/status">API status</a></nav>
  <section class="hero"><div class="eyebrow">AUTONOMOUS AI INFERENCE PROVIDER</div>
    <h1>Inference that<br><span>protects the route.</span></h1>
    <p>High-availability AI inference provider optimized for automated routing, competitive pricing, reliability and low latency.</p>
  </section>
  <section class="status-grid">
    ${statusCard("Provider", data.live ? "LIVE" : "NOT LIVE", data.live === true)}
    ${statusCard("API", String(data.api ?? "blocked").toUpperCase(), data.api === "ready")}
    ${statusCard("Network", String(data.network?.id ?? "dgrid").toUpperCase(), data.network?.application_status === "LIVE")}
    ${statusCard("Provider interface", String(data.network?.provider_interface_status ?? "UNVERIFIED"), data.network?.provider_interface_status === "VERIFIED")}
  </section>
  <section class="panel"><div><div class="eyebrow">ACTIVE MODELS</div><h2>Availability and latency</h2></div>
    <table><thead><tr><th>Model</th><th>Availability</th><th>Latest latency</th></tr></thead><tbody>${modelRows}</tbody></table>
  </section>
</main><footer><span>XGuard Autonomous AI Inference Provider</span><span><a href="/.well-known/security.txt">Security</a> · <a href="/openapi.json">OpenAPI</a></span></footer></body></html>`);
}

export function renderOwnerDashboard(
  metrics: Record<string, unknown>,
): Response {
  const encoded = escapeHtml(JSON.stringify(metrics, null, 2));
  const financial = (metrics.financial ?? {}) as Record<string, unknown>;
  const periods = (metrics.periods ?? {}) as Record<string, unknown>;
  const sevenDays = (periods.last_7_days ?? {}) as Record<string, unknown>;
  const thirtyDays = (periods.last_30_days ?? {}) as Record<string, unknown>;
  const alerts = Array.isArray(metrics.alerts)
    ? (metrics.alerts as Array<Record<string, unknown>>)
    : [];
  const providers = Array.isArray(metrics.providers)
    ? (metrics.providers as Array<Record<string, unknown>>)
    : [];
  const providerRows = providers
    .map(
      (provider) =>
        `<tr><td>${escapeHtml(String(provider.display_name ?? provider.provider_id ?? ""))}</td><td>${escapeHtml(String(provider.legal_status ?? ""))}</td><td>${escapeHtml(String(provider.health_status ?? "UNCONFIGURED"))}</td><td>${provider.latency_ms === null || provider.latency_ms === undefined ? "—" : `${Number(provider.latency_ms)} ms`}</td></tr>`,
    )
    .join("");
  const alertRows = alerts
    .map(
      (alert) =>
        `<tr><td>${escapeHtml(String(alert.severity ?? ""))}</td><td>${escapeHtml(String(alert.alert_type ?? ""))}</td><td>${escapeHtml(String(alert.message ?? ""))}</td><td>${escapeHtml(String(alert.last_seen_at ?? ""))}</td></tr>`,
    )
    .join("");
  return html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>XGuard owner control plane</title><style>${styles()}</style></head><body><main>
    <nav><span class="brand">XGUARD / OWNER</span><span>Private control plane</span></nav>
    <section class="hero small"><div class="eyebrow">REAL ACCOUNTING ONLY</div><h1>Inference control plane.</h1></section>
    <section class="status-grid">
      ${statusCard("Requests today", String(financial.real_requests ?? 0), true)}
      ${statusCard("Settled revenue", `$${String(financial.settled_revenue_usd ?? "0")}`, Number(financial.settled_revenue_usd ?? 0) > 0)}
      ${statusCard("Real cost", `$${String(financial.real_cost_usd ?? "0")}`, true)}
      ${statusCard("Net profit", `$${String(financial.net_profit_usd ?? "0")}`, Number(financial.net_profit_usd ?? 0) >= 0)}
      ${statusCard("Withdrawable", `$${String(financial.withdrawable_usd ?? "0")}`, Number(financial.withdrawable_usd ?? 0) > 0)}
      ${statusCard("Paid to owner", `$${String(financial.paid_to_owner_usd ?? "0")}`, Number(financial.paid_to_owner_usd ?? 0) > 0)}
    </section>
    <section class="panel"><div class="eyebrow">VERIFIED PERIODS</div><h2>Last 7 and 30 days</h2><table><thead><tr><th>Period</th><th>Requests</th><th>Settled revenue</th><th>Real cost</th><th>Net profit</th></tr></thead><tbody>
      ${financialRow("Last 7 days", sevenDays)}
      ${financialRow("Last 30 days", thirtyDays)}
    </tbody></table></section>
    <section class="panel"><div class="eyebrow">OPEN ALERTS</div><h2>Operational exceptions</h2><table><thead><tr><th>Severity</th><th>Type</th><th>Message</th><th>Last seen</th></tr></thead><tbody>${alertRows || '<tr><td colspan="4" class="empty">No open alert.</td></tr>'}</tbody></table></section>
    <section class="panel"><div class="eyebrow">UPSTREAM ROUTES</div><h2>Legal, health, and latency gates</h2><table><thead><tr><th>Provider</th><th>Legal</th><th>Health</th><th>Latency</th></tr></thead><tbody>${providerRows || '<tr><td colspan="4" class="empty">No configured upstream provider.</td></tr>'}</tbody></table></section>
    <details class="panel"><summary>Raw verified state</summary><pre>${encoded}</pre></details>
  </main></body></html>`);
}

function financialRow(
  label: string,
  financial: Record<string, unknown>,
): string {
  return `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(String(financial.real_requests ?? 0))}</td><td>$${escapeHtml(String(financial.settled_revenue_usd ?? "0"))}</td><td>$${escapeHtml(String(financial.real_cost_usd ?? "0"))}</td><td>$${escapeHtml(String(financial.net_profit_usd ?? "0"))}</td></tr>`;
}

export function openApiDocument(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "XGuard Autonomous AI Inference Provider",
      version: VERSION,
      description:
        "OpenAI-compatible provider surface. DGrid's public documentation does not publish its provider-channel handshake; DGrid compatibility is not claimed until that interface is verified during onboarding.",
    },
    servers: [{ url: `${ORIGIN}/v1` }],
    paths: {
      "/models": {
        get: {
          summary: "List active, health-checked models",
          responses: { "200": { description: "Active model list" } },
        },
      },
      "/chat/completions": {
        post: {
          summary: "Create a chat completion",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["model", "messages"],
                  properties: {
                    model: { type: "string" },
                    messages: { type: "array", items: { type: "object" } },
                    stream: { type: "boolean", default: false },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "OpenAI-compatible completion or SSE stream",
            },
            "401": { description: "Invalid network credential" },
            "503": { description: "No profitable healthy route" },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
      },
    },
  };
}

function statusCard(label: string, value: string, good: boolean): string {
  return `<article class="metric"><span>${escapeHtml(label)}</span><strong>${good ? '<i class="dot good"></i>' : '<i class="dot"></i>'}${escapeHtml(value)}</strong></article>`;
}

function html(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "permissions-policy":
        "camera=(), microphone=(), geolocation=(), payment=()",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
    },
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

function styles(): string {
  return `:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#07090c;color:#f5f7fa}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 70% 0,#15263b 0,transparent 34%),#07090c}a{color:inherit}main{width:min(1180px,calc(100% - 40px));margin:auto;min-height:calc(100vh - 90px)}nav{height:82px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #242a32;color:#9ba7b6;font-size:14px}.brand{font-weight:900;letter-spacing:.18em;color:#fff;text-decoration:none}.hero{padding:100px 0 70px;max-width:940px}.hero.small{padding-bottom:30px}.eyebrow{color:#5ce1e6;font-size:12px;font-weight:800;letter-spacing:.18em}.hero h1{font-size:clamp(48px,8vw,104px);line-height:.9;letter-spacing:-.065em;margin:18px 0 28px}.hero h1 span{color:#8291a5}.hero p{font-size:21px;color:#aeb8c6;line-height:1.65;max-width:780px}.status-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:20px}.metric,.panel{border:1px solid #252c35;background:rgba(15,19,25,.82);border-radius:18px}.metric{padding:20px}.metric span{display:block;color:#8290a1;font-size:12px;text-transform:uppercase;letter-spacing:.12em}.metric strong{display:flex;align-items:center;gap:9px;margin-top:14px;font-size:17px}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#ef6a6a;box-shadow:0 0 14px #ef6a6a88}.dot.good{background:#4ce6a1;box-shadow:0 0 14px #4ce6a188}.panel{padding:28px;margin:18px 0 42px}.panel h2{margin:10px 0 24px;font-size:28px}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:17px 12px;border-bottom:1px solid #242a32}th{color:#7e8a99;font-size:12px;text-transform:uppercase;letter-spacing:.1em}.empty{color:#8793a1;line-height:1.6}footer{width:min(1180px,calc(100% - 40px));height:90px;margin:auto;border-top:1px solid #242a32;display:flex;align-items:center;justify-content:space-between;color:#8290a1;font-size:13px}pre{overflow:auto;color:#aab5c3;font-size:12px;line-height:1.6}summary{cursor:pointer;font-weight:700}@media(max-width:850px){.status-grid{grid-template-columns:repeat(2,1fr)}.hero{padding-top:65px}}@media(max-width:560px){.status-grid{grid-template-columns:1fr}.hero h1{font-size:54px}.panel{padding:18px}th,td{padding:13px 7px;font-size:13px}footer{align-items:flex-start;flex-direction:column;justify-content:center;gap:8px}}`;
}
