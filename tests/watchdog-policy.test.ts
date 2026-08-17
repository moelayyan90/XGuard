import { describe, expect, it } from "vitest";
import {
  canonicalRouteKey,
  classifyTailEvent,
  isProtectedWriteRoute,
} from "../apps/worker/src/watchdog-policy.js";

const PRODUCER = "xguard-mainnet";
const BASE = "https://xguard-mainnet.maqamapp.workers.dev";

function tailItem(input: {
  method?: string;
  path?: string;
  status?: number;
  outcome?: string;
  exceptions?: unknown[];
  logs?: unknown[];
}) {
  return {
    scriptName: PRODUCER,
    eventTimestamp: Date.now(),
    outcome: input.outcome ?? "ok",
    event: {
      request: {
        method: input.method ?? "GET",
        url: `${BASE}${input.path ?? "/healthz"}`,
      },
      response: { status: input.status ?? 200 },
    },
    exceptions: input.exceptions ?? [],
    logs: input.logs ?? [],
  };
}

describe("watchdog policy", () => {
  it("does not classify normal auth and rate-limit responses as runtime incidents", async () => {
    await expect(
      classifyTailEvent(
        tailItem({ method: "POST", path: "/settle", status: 401 }),
        PRODUCER,
      ),
    ).resolves.toBeNull();
    await expect(
      classifyTailEvent(
        tailItem({ method: "POST", path: "/settle", status: 429 }),
        PRODUCER,
      ),
    ).resolves.toBeNull();
  });

  it("does not turn expected client errors with error logs into write breakers", async () => {
    const errorLog = [
      {
        level: "error",
        message: ['{"event":"request_rejected","code":"unauthorized"}'],
      },
    ];
    await expect(
      classifyTailEvent(
        tailItem({
          method: "POST",
          path: "/verify",
          status: 401,
          logs: errorLog,
        }),
        PRODUCER,
      ),
    ).resolves.toBeNull();
    await expect(
      classifyTailEvent(
        tailItem({
          method: "POST",
          path: "/verify",
          status: 400,
          logs: errorLog,
        }),
        PRODUCER,
      ),
    ).resolves.toBeNull();
  });

  it("ignores its own circuit-open 503 so retries cannot extend the breaker forever", async () => {
    await expect(
      classifyTailEvent(
        tailItem({
          method: "POST",
          path: "/settle",
          status: 503,
          outcome: "ok",
          logs: [
            {
              level: "warn",
              message: [
                '{"event":"watchdog_circuit_open","route":"POST:/settle"}',
              ],
            },
          ],
        }),
        PRODUCER,
      ),
    ).resolves.toBeNull();
  });

  it("opens the fast threshold for repeated runtime exceptions on protected writes", async () => {
    const signal = await classifyTailEvent(
      tailItem({
        method: "POST",
        path: "/settle",
        status: 500,
        outcome: "exception",
        exceptions: [{ name: "TypeError", message: "boom" }],
      }),
      PRODUCER,
    );
    expect(signal).toMatchObject({
      category: "worker_runtime_failure",
      severity: "critical",
      routeKey: "POST:/settle",
      protectedRoute: true,
      threshold: 2,
    });
    expect(signal?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("requires a larger burst before circuit-breaking ordinary 5xx responses", async () => {
    const signal = await classifyTailEvent(
      tailItem({ method: "POST", path: "/verify", status: 503 }),
      PRODUCER,
    );
    expect(signal).toMatchObject({
      category: "http_5xx",
      severity: "high",
      protectedRoute: true,
      threshold: 5,
    });
  });

  it("tracks advertised 404s without treating them as a money-path circuit event", async () => {
    const signal = await classifyTailEvent(
      tailItem({ method: "GET", path: "/v1/register", status: 404 }),
      PRODUCER,
    );
    expect(signal).toMatchObject({
      category: "advertised_endpoint_404",
      severity: "medium",
      protectedRoute: false,
    });
  });

  it("canonicalizes high-cardinality settlement and proxy paths", () => {
    expect(
      canonicalRouteKey("POST", `/v1/settlements/${"a".repeat(64)}/resolve`),
    ).toBe("POST:/v1/settlements/:logicalPaymentKey/resolve");
    expect(
      canonicalRouteKey("POST", "/v1/gateway/proxy/openai/v1/responses"),
    ).toBe("POST:/v1/gateway/proxy/:provider/*");
  });

  it("protects side-effecting XGuard routes but not read-only discovery", () => {
    expect(isProtectedWriteRoute("POST", "/v1/topups/claim")).toBe(true);
    expect(isProtectedWriteRoute("POST", "/v1/gateway/analyze")).toBe(true);
    expect(isProtectedWriteRoute("GET", "/.well-known/x402")).toBe(false);
  });
});
