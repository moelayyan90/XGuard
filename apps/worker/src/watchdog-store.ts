import {
  canonicalRouteKey,
  isProtectedWriteRoute,
  type WatchdogSignal,
} from "./watchdog-policy.js";

const GLOBAL_WRITE_BREAKER = "__all_protected_writes__";
const DEFAULT_BREAKER_TTL_MS = 120_000;

interface IncidentWindowRow {
  window_started_at: string;
  window_failures: number;
}

interface BreakerRow {
  route_key: string;
  state: "OPEN" | "CLOSED";
  reason: string;
  fingerprint: string | null;
  opened_at: string | null;
  expires_at: string | null;
  updated_at: string;
  failures: number;
  successes: number;
}

interface ProbeRow {
  consecutive_failures: number;
  consecutive_successes: number;
}

export interface ActiveWatchdogBreaker {
  route: string;
  category: string;
  expiresAt: string | null;
}

export async function recordWatchdogSignal(
  db: D1Database,
  signal: WatchdogSignal,
): Promise<{ windowFailures: number; shouldOpenBreaker: boolean }> {
  const observedAt = new Date(signal.observedAtMs).toISOString();
  const previous = await db
    .prepare(
      `SELECT window_started_at,window_failures
       FROM watchdog_incidents WHERE fingerprint=?`,
    )
    .bind(signal.fingerprint)
    .first<IncidentWindowRow>();

  const previousStartMs = previous?.window_started_at
    ? Date.parse(previous.window_started_at)
    : Number.NaN;
  const sameWindow =
    Number.isFinite(previousStartMs) &&
    signal.observedAtMs - previousStartMs <= signal.windowMs;
  const windowStartedAt = sameWindow ? previous!.window_started_at : observedAt;
  const windowFailures = sameWindow ? previous!.window_failures + 1 : 1;

  await db
    .prepare(
      `INSERT INTO watchdog_incidents(
         fingerprint,category,severity,status,script_name,route_key,method,path,
         outcome,http_status,error_code,first_seen_at,last_seen_at,occurrences,
         window_started_at,window_failures,auto_action,action_state,action_count,
         cooldown_until
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(fingerprint) DO UPDATE SET
         category=excluded.category,
         severity=excluded.severity,
         status='OPEN',
         script_name=excluded.script_name,
         route_key=excluded.route_key,
         method=excluded.method,
         path=excluded.path,
         outcome=excluded.outcome,
         http_status=excluded.http_status,
         error_code=excluded.error_code,
         last_seen_at=excluded.last_seen_at,
         occurrences=watchdog_incidents.occurrences+1,
         window_started_at=excluded.window_started_at,
         window_failures=excluded.window_failures`,
    )
    .bind(
      signal.fingerprint,
      signal.category,
      signal.severity,
      "OPEN",
      signal.scriptName,
      signal.routeKey,
      signal.method,
      signal.path,
      signal.outcome,
      signal.httpStatus,
      signal.errorCode,
      observedAt,
      observedAt,
      1,
      windowStartedAt,
      windowFailures,
      null,
      null,
      0,
      null,
    )
    .run();

  return {
    windowFailures,
    shouldOpenBreaker:
      signal.protectedRoute && windowFailures >= signal.threshold,
  };
}

export async function openRouteBreaker(
  db: D1Database,
  signal: WatchdogSignal,
  ttlMs = DEFAULT_BREAKER_TTL_MS,
): Promise<void> {
  if (signal.routeKey === null || !signal.protectedRoute) return;
  await upsertOpenBreaker(
    db,
    signal.routeKey,
    `${signal.category}:${signal.errorCode}`,
    signal.fingerprint,
    signal.observedAtMs,
    ttlMs,
  );
  await db
    .prepare(
      `UPDATE watchdog_incidents
       SET auto_action='OPEN_CIRCUIT',action_state='APPLIED',
           action_count=action_count+1,cooldown_until=?
       WHERE fingerprint=?`,
    )
    .bind(
      new Date(signal.observedAtMs + ttlMs).toISOString(),
      signal.fingerprint,
    )
    .run();
}

export async function openGlobalWriteBreaker(
  db: D1Database,
  reason: string,
  nowMs = Date.now(),
  ttlMs = DEFAULT_BREAKER_TTL_MS,
): Promise<void> {
  await upsertOpenBreaker(db, GLOBAL_WRITE_BREAKER, reason, null, nowMs, ttlMs);
}

export async function watchdogGuardResponse(
  request: Request,
  db: D1Database,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!isProtectedWriteRoute(request.method, url.pathname)) return null;
  const routeKey = canonicalRouteKey(request.method, url.pathname);
  if (routeKey === null) return null;

  let breaker: BreakerRow | null = null;
  try {
    const now = new Date().toISOString();
    breaker = await db
      .prepare(
        `SELECT route_key,state,reason,fingerprint,opened_at,expires_at,updated_at,
                failures,successes
         FROM watchdog_breakers
         WHERE state='OPEN' AND expires_at>? AND route_key IN (?,?)
         ORDER BY CASE WHEN route_key=? THEN 0 ELSE 1 END
         LIMIT 1`,
      )
      .bind(now, routeKey, GLOBAL_WRITE_BREAKER, routeKey)
      .first<BreakerRow>();
  } catch {
    return null;
  }

  if (breaker === null) return null;
  const expiresAtMs = breaker.expires_at
    ? Date.parse(breaker.expires_at)
    : Date.now();
  const retryAfter = Math.max(1, Math.ceil((expiresAtMs - Date.now()) / 1000));
  return new Response(
    JSON.stringify({
      error: "xguard_watchdog_circuit_open",
      route: routeKey,
      reason: breaker.reason,
      retryAfterSeconds: retryAfter,
      safety: "request_not_executed",
    }),
    {
      status: 503,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Retry-After": String(retryAfter),
        "X-XGuard-Watchdog": "circuit-open",
        "X-XGuard-Watchdog-Route": breaker.route_key,
      },
    },
  );
}

export async function closeExpiredBreakers(
  db: D1Database,
  nowMs = Date.now(),
): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE watchdog_breakers
       SET state='CLOSED',updated_at=?
       WHERE state='OPEN' AND expires_at<=?`,
    )
    .bind(new Date(nowMs).toISOString(), new Date(nowMs).toISOString())
    .run();
  return result.meta.changes ?? 0;
}

export async function closeGlobalProbeBreaker(
  db: D1Database,
  nowMs = Date.now(),
): Promise<void> {
  await db
    .prepare(
      `UPDATE watchdog_breakers
       SET state='CLOSED',successes=successes+1,updated_at=?
       WHERE route_key=? AND state='OPEN' AND reason LIKE 'probe:%'`,
    )
    .bind(new Date(nowMs).toISOString(), GLOBAL_WRITE_BREAKER)
    .run();
}

export async function recordProbeResult(
  db: D1Database,
  input: {
    key: string;
    ok: boolean;
    status: number | null;
    errorCode: string | null;
    checkedAtMs?: number;
  },
): Promise<{ consecutiveFailures: number; consecutiveSuccesses: number }> {
  const checkedAt = new Date(input.checkedAtMs ?? Date.now()).toISOString();
  const previous = await db
    .prepare(
      `SELECT consecutive_failures,consecutive_successes
       FROM watchdog_probe_state WHERE probe_key=?`,
    )
    .bind(input.key)
    .first<ProbeRow>();
  const consecutiveFailures = input.ok
    ? 0
    : (previous?.consecutive_failures ?? 0) + 1;
  const consecutiveSuccesses = input.ok
    ? (previous?.consecutive_successes ?? 0) + 1
    : 0;

  await db
    .prepare(
      `INSERT INTO watchdog_probe_state(
         probe_key,consecutive_failures,consecutive_successes,last_status,
         last_error_code,last_checked_at
       ) VALUES(?,?,?,?,?,?)
       ON CONFLICT(probe_key) DO UPDATE SET
         consecutive_failures=excluded.consecutive_failures,
         consecutive_successes=excluded.consecutive_successes,
         last_status=excluded.last_status,
         last_error_code=excluded.last_error_code,
         last_checked_at=excluded.last_checked_at`,
    )
    .bind(
      input.key,
      consecutiveFailures,
      consecutiveSuccesses,
      input.status,
      input.errorCode,
      checkedAt,
    )
    .run();

  return { consecutiveFailures, consecutiveSuccesses };
}

export async function watchdogStatus(db: D1Database): Promise<{
  openBreakers: number;
  openIncidents: number;
  activeBreakers: ActiveWatchdogBreaker[];
}> {
  const now = new Date().toISOString();
  const [breakers, incidents, active] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM watchdog_breakers
         WHERE state='OPEN' AND expires_at>?`,
      )
      .bind(now)
      .first<{ count: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM watchdog_incidents WHERE status='OPEN'`,
      )
      .first<{ count: number }>(),
    db
      .prepare(
        `SELECT route_key,reason,expires_at FROM watchdog_breakers
         WHERE state='OPEN' AND expires_at>?
         ORDER BY expires_at ASC
         LIMIT 8`,
      )
      .bind(now)
      .all<Pick<BreakerRow, "route_key" | "reason" | "expires_at">>(),
  ]);
  const activeBreakers = (active.results ?? []).map((row) => ({
    route: row.route_key,
    category: sanitizeBreakerCategory(row.reason),
    expiresAt: row.expires_at,
  }));
  return {
    openBreakers: breakers?.count ?? 0,
    openIncidents: incidents?.count ?? 0,
    activeBreakers,
  };
}

function sanitizeBreakerCategory(reason: string): string {
  if (reason.startsWith("probe:")) return "synthetic_probe";
  const separator = reason.indexOf(":");
  const category = separator >= 0 ? reason.slice(0, separator) : reason;
  return category.slice(0, 48).replace(/[^a-zA-Z0-9_.-]/g, "_");
}

async function upsertOpenBreaker(
  db: D1Database,
  routeKey: string,
  reason: string,
  fingerprint: string | null,
  nowMs: number,
  ttlMs: number,
): Promise<void> {
  const now = new Date(nowMs).toISOString();
  const expires = new Date(nowMs + ttlMs).toISOString();
  await db
    .prepare(
      `INSERT INTO watchdog_breakers(
         route_key,state,reason,fingerprint,opened_at,expires_at,updated_at,
         failures,successes
       ) VALUES(?,?,?,?,?,?,?,?,?)
       ON CONFLICT(route_key) DO UPDATE SET
         state='OPEN',reason=excluded.reason,fingerprint=excluded.fingerprint,
         opened_at=COALESCE(watchdog_breakers.opened_at,excluded.opened_at),
         expires_at=CASE
           WHEN watchdog_breakers.expires_at>excluded.expires_at
             THEN watchdog_breakers.expires_at
           ELSE excluded.expires_at
         END,
         updated_at=excluded.updated_at,
         failures=watchdog_breakers.failures+1`,
    )
    .bind(routeKey, "OPEN", reason, fingerprint, now, expires, now, 1, 0)
    .run();
}
