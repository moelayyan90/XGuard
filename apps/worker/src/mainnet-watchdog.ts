import { classifyTailEvent, type TailEventLike } from "./watchdog-policy.js";
import {
  closeExpiredBreakers,
  closeGlobalProbeBreaker,
  openGlobalWriteBreaker,
  openRouteBreaker,
  recordProbeResult,
  recordWatchdogSignal,
  watchdogStatus,
} from "./watchdog-store.js";

interface WatchdogEnv {
  DB: D1Database;
  ANALYTICS: AnalyticsEngineDataset;
  WATCHDOG_PRODUCER?: string;
  WATCHDOG_MAINNET_URL?: string;
}

interface TelemetryPoint {
  method: string;
  path: string;
  status: number;
}

const DEFAULT_PRODUCER = "xguard-mainnet";
const DEFAULT_MAINNET_URL = "https://xguard-mainnet.maqamapp.workers.dev";
const PROBE_FAILURE_THRESHOLD = 3;

export default {
  fetch(request: Request, env: WatchdogEnv): Promise<Response> {
    return watchdogFetch(request, env);
  },

  tail(events: TailEventLike[], env: WatchdogEnv, ctx: ExecutionContext): void {
    ctx.waitUntil(processTail(events, env));
  },

  scheduled(
    controller: ScheduledController,
    env: WatchdogEnv,
    ctx: ExecutionContext,
  ): void {
    ctx.waitUntil(runSyntheticProbes(env, controller.scheduledTime));
  },
};

async function watchdogFetch(
  request: Request,
  env: WatchdogEnv,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== "/healthz" && url.pathname !== "/status")
    return jsonResponse({ error: "not_found" }, 404);
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response(null, {
      status: 405,
      headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" },
    });

  try {
    const state = await watchdogStatus(env.DB);
    const healthy = state.openBreakers === 0;
    const body = {
      service: "XGuard Watchdog",
      mode: "self-healing-control-plane",
      status: healthy ? "ok" : "degraded",
      producer: env.WATCHDOG_PRODUCER ?? DEFAULT_PRODUCER,
      openBreakers: state.openBreakers,
      openIncidents: state.openIncidents,
      protections: [
        "tail-runtime-detection",
        "synthetic-readiness-probes",
        "route-circuit-breakers",
        "bounded-auto-recovery",
      ],
    };
    return jsonResponse(request.method === "HEAD" ? null : body, 200);
  } catch (error) {
    return jsonResponse(
      request.method === "HEAD"
        ? null
        : { status: "unavailable", error: errorCode(error) },
      503,
    );
  }
}

async function processTail(
  events: TailEventLike[],
  env: WatchdogEnv,
): Promise<void> {
  const producer = env.WATCHDOG_PRODUCER ?? DEFAULT_PRODUCER;
  const tasks: Promise<void>[] = [];

  for (const item of events) {
    if ((item.scriptName ?? "unknown") !== producer) continue;
    writeTelemetry(env.ANALYTICS, item);
    tasks.push(processOneTailEvent(env.DB, item, producer));
  }

  await Promise.all(tasks);
}

async function processOneTailEvent(
  db: D1Database,
  item: TailEventLike,
  producer: string,
): Promise<void> {
  const signal = await classifyTailEvent(item, producer);
  if (signal === null) return;
  try {
    const recorded = await recordWatchdogSignal(db, signal);
    if (recorded.shouldOpenBreaker) await openRouteBreaker(db, signal);
    console.log(
      JSON.stringify({
        event: "watchdog_incident",
        fingerprint: signal.fingerprint,
        category: signal.category,
        severity: signal.severity,
        routeKey: signal.routeKey,
        failures: recorded.windowFailures,
        threshold: signal.threshold,
        circuitOpened: recorded.shouldOpenBreaker,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "watchdog_incident_persist_failed",
        code: errorCode(error),
      }),
    );
  }
}

function writeTelemetry(
  dataset: AnalyticsEngineDataset,
  item: TailEventLike,
): void {
  const telemetry = extractTelemetry(item.event);
  const outcome = typeof item.outcome === "string" ? item.outcome : "unknown";
  const scriptName = item.scriptName ?? "unknown";
  const route = `${telemetry.method}:${telemetry.path}`.slice(0, 96);
  dataset.writeDataPoint({
    indexes: [route],
    blobs: [
      scriptName,
      telemetry.method,
      telemetry.path,
      outcome,
      statusClass(telemetry.status),
    ],
    doubles: [1, telemetry.status],
  });
}

async function runSyntheticProbes(
  env: WatchdogEnv,
  scheduledTime: number,
): Promise<void> {
  const base = (env.WATCHDOG_MAINNET_URL ?? DEFAULT_MAINNET_URL).replace(
    /\/$/,
    "",
  );
  const probes = [
    { key: "healthz", path: "/healthz" },
    { key: "readyz", path: "/readyz" },
    { key: "register-discovery", path: "/v1/register" },
    { key: "x402-discovery", path: "/.well-known/x402/facilitator.json" },
  ];

  let allHealthy = true;
  let highestFailures = 0;
  const failures: string[] = [];

  for (const probe of probes) {
    const result = await executeProbe(`${base}${probe.path}`);
    const state = await recordProbeResult(env.DB, {
      key: probe.key,
      ok: result.ok,
      status: result.status,
      errorCode: result.errorCode,
      checkedAtMs: scheduledTime,
    });
    if (!result.ok) {
      allHealthy = false;
      highestFailures = Math.max(highestFailures, state.consecutiveFailures);
      failures.push(
        `${probe.key}:${result.errorCode ?? result.status ?? "failed"}`,
      );
    }
  }

  await closeExpiredBreakers(env.DB, scheduledTime);

  if (allHealthy) {
    await closeGlobalProbeBreaker(env.DB, scheduledTime);
    console.log(
      JSON.stringify({ event: "watchdog_probe_cycle", status: "healthy" }),
    );
    return;
  }

  if (highestFailures >= PROBE_FAILURE_THRESHOLD) {
    await openGlobalWriteBreaker(
      env.DB,
      `probe:${failures.join(",").slice(0, 220)}`,
      scheduledTime,
      120_000,
    );
  }
  console.error(
    JSON.stringify({
      event: "watchdog_probe_cycle",
      status: "degraded",
      highestFailures,
      threshold: PROBE_FAILURE_THRESHOLD,
      failures,
    }),
  );
}

async function executeProbe(url: string): Promise<{
  ok: boolean;
  status: number | null;
  errorCode: string | null;
}> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Cache-Control": "no-cache",
        "User-Agent": "XGuard-Watchdog/1.0",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    const ok = response.status >= 200 && response.status < 300;
    return {
      ok,
      status: response.status,
      errorCode: ok ? null : `http_${response.status}`,
    };
  } catch (error) {
    return { ok: false, status: null, errorCode: errorCode(error) };
  }
}

function extractTelemetry(value: unknown): TelemetryPoint {
  const event = record(value);
  const request = record(event?.request);
  const response = record(event?.response);
  const method =
    typeof request?.method === "string" ? request.method : "UNKNOWN";
  const rawUrl = typeof request?.url === "string" ? request.url : "";
  let path = "unknown";
  if (rawUrl.length > 0) {
    try {
      path = new URL(rawUrl).pathname;
    } catch {
      path = "invalid-url";
    }
  }
  const status =
    typeof response?.status === "number" && Number.isFinite(response.status)
      ? response.status
      : 0;
  return { method, path, status };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function statusClass(status: number): string {
  if (status < 100) return "none";
  return `${Math.floor(status / 100)}xx`;
}

function jsonResponse(value: unknown, status: number): Response {
  return new Response(value === null ? null : JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return "unknown_error";
  return error.name === "AbortError" || error.name === "TimeoutError"
    ? error.name
    : error.message.slice(0, 96).replace(/[^a-zA-Z0-9_.:-]/g, "_");
}
