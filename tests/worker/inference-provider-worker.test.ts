import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

const base = "https://xguardgate.com";
const adminHeaders = {
  authorization: "Bearer test-admin-token-00000000000000001",
};
const networkHeaders = {
  authorization: "Bearer test-network-key-0000000000000001",
  "content-type": "application/json",
};

afterEach(() => vi.unstubAllGlobals());

async function makeHealthy(): Promise<void> {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://upstream.test/v1/models")
      return Response.json({
        object: "list",
        data: [{ id: "Qwen/Qwen3-8B", object: "model" }],
      });
    throw new Error(`unexpected outbound request: ${url}`);
  });
  const maintenance = await exports.default.fetch(
    `${base}/v1/admin/maintenance`,
    { method: "POST", headers: adminHeaders },
  );
  expect(maintenance.status, await maintenance.clone().text()).toBe(200);
}

describe("autonomous inference provider Cloudflare integration", () => {
  it("starts truthfully blocked and exposes no public financial data", async () => {
    const status = await exports.default.fetch(`${base}/v1/status`);
    expect(status.status).toBe(200);
    const body = (await status.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      service: "XGuard Autonomous AI Inference Provider",
      live: false,
      api: "blocked",
      models: [],
    });
    expect(body).not.toHaveProperty("today");
    const ready = await exports.default.fetch(`${base}/readyz`);
    expect(ready.status).toBe(503);
  });

  it("protects network inference and the owner control plane", async () => {
    const inference = await exports.default.fetch(
      `${base}/v1/chat/completions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "xguard/qwen3-8b",
          messages: [{ role: "user", content: "hello" }],
        }),
      },
    );
    expect(inference.status).toBe(401);
    const owner = await exports.default.fetch(`${base}/v1/admin/metrics`);
    expect(owner.status).toBe(401);
  });

  it("activates only after an approved route passes a real health check", async () => {
    await makeHealthy();
    const models = await exports.default.fetch(`${base}/v1/models`);
    await expect(models.json()).resolves.toMatchObject({
      object: "list",
      data: [
        {
          id: "xguard/qwen3-8b",
          availability: "available",
        },
      ],
    });
    const ready = await exports.default.fetch(`${base}/readyz`);
    expect(ready.status).toBe(200);
  });

  it("routes a completion and records pending revenue separately from real cost", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        calls.push(url);
        if (url === "https://upstream.test/v1/models")
          return Response.json({ data: [{ id: "Qwen/Qwen3-8B" }] });
        if (url === "https://upstream.test/v1/chat/completions") {
          expect(new Headers(init?.headers).get("authorization")).toBe(
            "Bearer test-upstream-key-000000000000001",
          );
          const request = JSON.parse(String(init?.body)) as Record<
            string,
            unknown
          >;
          expect(request.model).toBe("Qwen/Qwen3-8B");
          return Response.json({
            id: "chatcmpl-real-1",
            object: "chat.completion",
            model: "Qwen/Qwen3-8B",
            choices: [
              { index: 0, message: { role: "assistant", content: "hello" } },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 4,
              total_tokens: 14,
            },
          });
        }
        throw new Error(`unexpected outbound request: ${url}`);
      },
    );
    const maintenance = await exports.default.fetch(
      `${base}/v1/admin/maintenance`,
      { method: "POST", headers: adminHeaders },
    );
    expect(maintenance.status).toBe(200);

    const response = await exports.default.fetch(
      `${base}/v1/chat/completions`,
      {
        method: "POST",
        headers: { ...networkHeaders, "x-request-id": "dgrid-real-request-1" },
        body: JSON.stringify({
          model: "xguard/qwen3-8b",
          messages: [{ role: "user", content: "Say hello" }],
          max_tokens: 16,
        }),
      },
    );
    const result = (await response.json()) as Record<string, unknown>;
    expect(response.status, JSON.stringify(result)).toBe(200);
    expect(result).toMatchObject({
      id: "chatcmpl-real-1",
      model: "xguard/qwen3-8b",
    });
    expect(response.headers.get("x-xguard-request-id")).toMatch(/^xgir_/u);
    expect(calls).toContain("https://upstream.test/v1/chat/completions");

    const owner = await exports.default.fetch(`${base}/v1/admin/metrics`, {
      headers: adminHeaders,
    });
    const metrics = (await owner.json()) as {
      financial: Record<string, unknown>;
      periods: Record<string, Record<string, unknown>>;
      alerts: Array<Record<string, unknown>>;
      payout_destination_configured: boolean;
      automatic_payout: string;
    };
    expect(metrics.financial).toMatchObject({
      real_requests: 1,
      settled_revenue_usd: "0",
      pending_revenue_usd: "0.000009",
      real_cost_usd: "0.000004",
      net_profit_usd: "-0.000004",
    });
    expect(metrics.periods.last_7_days).toMatchObject({
      real_requests: 1,
      settled_revenue_usd: "0",
      real_cost_usd: "0.000004",
      net_profit_usd: "-0.000004",
    });
    expect(metrics.periods.last_30_days).toEqual(metrics.periods.last_7_days);
    expect(metrics.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ alert_type: "DGRID_DISCONNECTED" }),
        expect.objectContaining({ alert_type: "NEGATIVE_DAILY_MARGIN" }),
      ]),
    );
    expect(metrics.payout_destination_configured).toBe(false);
    expect(metrics.automatic_payout).toBe("NOT_SUPPORTED");
  });

  it("streams SSE while accounting from usage frames only", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "https://upstream.test/v1/models")
        return Response.json({ data: [{ id: "Qwen/Qwen3-8B" }] });
      if (url === "https://upstream.test/v1/chat/completions") {
        const stream = [
          'data: {"id":"chatcmpl-stream-1","choices":[{"index":0,"delta":{"content":"hello"}}]}',
          "",
          'data: {"choices":[],"usage":{"prompt_tokens":8,"completion_tokens":3,"total_tokens":11}}',
          "",
          "data: [DONE]",
          "",
        ].join("\n");
        return new Response(stream, {
          headers: { "content-type": "text/event-stream" },
        });
      }
      throw new Error(`unexpected outbound request: ${url}`);
    });
    const maintenance = await exports.default.fetch(
      `${base}/v1/admin/maintenance`,
      { method: "POST", headers: adminHeaders },
    );
    expect(maintenance.status).toBe(200);
    const response = await exports.default.fetch(
      `${base}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          ...networkHeaders,
          "x-request-id": "dgrid-stream-request-1",
        },
        body: JSON.stringify({
          model: "xguard/qwen3-8b",
          messages: [{ role: "user", content: "Say hello" }],
          max_tokens: 16,
          stream: true,
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(await response.text()).toContain("chatcmpl-stream-1");

    await vi.waitFor(
      async () => {
        const row = await env.DB.prepare(
          `SELECT n.status,r.state,r.amount_micro_usd,
            COALESCE(SUM(c.amount_micro_usd),0) cost_micro_usd
           FROM network_requests n
           JOIN revenue r ON r.request_id=n.request_id
           LEFT JOIN costs c ON c.request_id=n.request_id
           WHERE n.network_request_id=?
           GROUP BY n.request_id,r.revenue_id`,
        )
          .bind("dgrid-stream-request-1")
          .first<{
            status: string;
            state: string;
            amount_micro_usd: number;
            cost_micro_usd: number;
          }>();
        expect(row).toMatchObject({
          status: "SUCCEEDED",
          state: "PENDING",
          amount_micro_usd: 7,
          cost_micro_usd: 4,
        });
      },
      { timeout: 5_000 },
    );
  });

  it("created every required inference accounting table", async () => {
    const required = [
      "networks",
      "models",
      "upstream_providers",
      "provider_prices",
      "provider_health",
      "network_requests",
      "upstream_requests",
      "routing_metrics",
      "settlements",
      "revenue",
      "costs",
      "payouts",
      "pricing_history",
      "profit_hourly",
      "profit_daily",
      "optimization_runs",
      "alerts",
    ];
    const rows = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'",
    ).all<{ name: string }>();
    const actual = new Set(rows.results.map((row) => row.name));
    for (const table of required) expect(actual.has(table), table).toBe(true);
  });
});
