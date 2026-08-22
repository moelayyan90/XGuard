import {
  configuredSlots,
  decimalUsdToMicro,
  InferenceError,
  type InferenceEnv,
  microUsd,
  NETWORK_ID,
  percentage,
  type RouteCandidate,
  routeCostBreakdown,
  type SlotConfig,
  tokenCost,
} from "./inference-provider-types.js";

interface HealthRow {
  status: RouteCandidate["healthStatus"];
  latency_ms: number | null;
  checked_at: string;
}

interface MetricsRow {
  requests: number;
  successes: number;
  latency_sum_ms: number;
}

interface FinancialRow {
  real_requests: number;
  settled_revenue_micro_usd: number;
  pending_revenue_micro_usd: number;
  withdrawable_micro_usd: number;
  paid_to_owner_micro_usd: number;
  cost_micro_usd: number;
  net_profit_micro_usd: number;
}

export interface RequestRecord {
  requestId: string;
  quotedRevenueMicroUsd: number;
}

export interface AttemptRecord {
  upstreamRequestId: string;
  attempt: number;
  estimatedCostMicroUsd: number;
}

export interface UsageAccounting {
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  upstreamCostMicroUsd: number;
  networkCostMicroUsd: number;
  variableInfraCostMicroUsd: number;
  totalCostMicroUsd: number;
  actualRevenueMicroUsd: number;
  costBasis: "ESTIMATED" | "USAGE_REPORTED";
}

export async function syncRuntimeConfiguration(
  env: InferenceEnv,
): Promise<void> {
  const now = new Date().toISOString();
  const slots = configuredSlots(env);
  for (const slot of slots) await syncSlot(env, slot, now);
  const configuredIds = slots.map((slot) => slot.providerId);
  if (configuredIds.length === 0) {
    await env.DB.prepare(
      "UPDATE upstream_providers SET enabled=0,updated_at=? WHERE provider_id LIKE 'runtime-slot-%'",
    )
      .bind(now)
      .run();
    await env.DB.prepare(
      "UPDATE models SET enabled=0,status='BLOCKED',status_reason='Runtime upstream configuration is unavailable',updated_at=? WHERE provider_id LIKE 'runtime-slot-%'",
    )
      .bind(now)
      .run();
  } else {
    const placeholders = configuredIds.map(() => "?").join(",");
    await env.DB.prepare(
      `UPDATE upstream_providers SET enabled=0,updated_at=? WHERE provider_id LIKE 'runtime-slot-%' AND provider_id NOT IN (${placeholders})`,
    )
      .bind(now, ...configuredIds)
      .run();
    await env.DB.prepare(
      `UPDATE models SET enabled=0,status='BLOCKED',status_reason='Runtime upstream configuration is unavailable',updated_at=? WHERE provider_id LIKE 'runtime-slot-%' AND provider_id NOT IN (${placeholders})`,
    )
      .bind(now, ...configuredIds)
      .run();
  }
}

async function syncSlot(
  env: InferenceEnv,
  slot: SlotConfig,
  now: string,
): Promise<void> {
  const hasPrices = [
    slot.upstreamInputMicroUsdPerMillion,
    slot.upstreamOutputMicroUsdPerMillion,
    slot.saleInputMicroUsdPerMillion,
    slot.saleOutputMicroUsdPerMillion,
  ].every((value) => value >= 0);
  const upstreamAtNominal = tokenCost(
    1_000,
    1_000,
    slot.upstreamInputMicroUsdPerMillion,
    slot.upstreamOutputMicroUsdPerMillion,
  );
  const saleAtNominal = tokenCost(
    1_000,
    1_000,
    slot.saleInputMicroUsdPerMillion,
    slot.saleOutputMicroUsdPerMillion,
  );
  const routeCosts = routeCostBreakdown(env, saleAtNominal, upstreamAtNominal);
  const approved =
    slot.resaleApproved && slot.legalEvidenceUrl !== null && hasPrices;
  const profitable =
    approved &&
    routeCosts !== null &&
    profitAllowed(env, saleAtNominal, routeCosts.totalMicroUsd);
  const enabled = approved && profitable;
  const legalStatus = approved ? "APPROVED" : "REVIEW_REQUIRED";
  const reason = !slot.resaleApproved
    ? "Resale approval is not configured"
    : slot.legalEvidenceUrl === null
      ? "Legal evidence URL is not configured"
      : !hasPrices
        ? "Verified upstream and sale prices are incomplete"
        : routeCosts === null
          ? "Network fee or variable infrastructure cost is unverified"
          : !profitable
            ? "Configured route fails the profit guard"
            : null;

  await env.DB.prepare(
    `INSERT INTO upstream_providers(
      provider_id,display_name,slot,base_url,api_style,legal_status,
      legal_evidence_url,legal_evidence_note,enabled,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(provider_id) DO UPDATE SET
      display_name=excluded.display_name,slot=excluded.slot,base_url=excluded.base_url,
      legal_status=excluded.legal_status,legal_evidence_url=excluded.legal_evidence_url,
      legal_evidence_note=excluded.legal_evidence_note,enabled=excluded.enabled,
      updated_at=excluded.updated_at`,
  )
    .bind(
      slot.providerId,
      slot.name,
      slot.slot,
      slot.baseUrl,
      "OPENAI_CHAT",
      legalStatus,
      slot.legalEvidenceUrl,
      approved
        ? "Operator-attested contract or compute-hosting authority"
        : "Route remains disabled until operator provides evidence",
      enabled ? 1 : 0,
      now,
      now,
    )
    .run();

  const modelId = `${slot.providerId}:${slot.networkModel}`;
  await env.DB.prepare(
    `INSERT INTO models(
      model_id,display_name,modality,upstream_model,provider_id,network_id,
      network_model_id,input_price_micro_usd_per_million,
      output_price_micro_usd_per_million,status,status_reason,enabled,
      created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(model_id) DO UPDATE SET
      display_name=excluded.display_name,upstream_model=excluded.upstream_model,
      network_model_id=excluded.network_model_id,
      input_price_micro_usd_per_million=excluded.input_price_micro_usd_per_million,
      output_price_micro_usd_per_million=excluded.output_price_micro_usd_per_million,
      status=excluded.status,status_reason=excluded.status_reason,
      enabled=excluded.enabled,updated_at=excluded.updated_at`,
  )
    .bind(
      modelId,
      slot.networkModel,
      "text",
      slot.upstreamModel,
      slot.providerId,
      NETWORK_ID,
      slot.networkModel,
      slot.saleInputMicroUsdPerMillion,
      slot.saleOutputMicroUsdPerMillion,
      enabled ? "READY" : "BLOCKED",
      reason,
      enabled ? 1 : 0,
      now,
      now,
    )
    .run();

  await env.DB.prepare(
    `INSERT INTO provider_prices(
      price_id,provider,service,model,billing_mode,
      input_micro_usd_per_million,output_micro_usd_per_million,
      request_cost_micro_usd,currency,quality_tier,capabilities_json,
      terms_mode,source_url,effective_at,last_verified_at,enabled
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(price_id) DO UPDATE SET
      input_micro_usd_per_million=excluded.input_micro_usd_per_million,
      output_micro_usd_per_million=excluded.output_micro_usd_per_million,
      terms_mode=excluded.terms_mode,source_url=excluded.source_url,
      last_verified_at=excluded.last_verified_at,enabled=excluded.enabled`,
  )
    .bind(
      `${slot.providerId}-current`,
      slot.providerId,
      "ai.inference",
      slot.upstreamModel,
      "token",
      Math.max(0, slot.upstreamInputMicroUsdPerMillion),
      Math.max(0, slot.upstreamOutputMicroUsdPerMillion),
      0,
      "USD",
      2,
      '["chat","streaming","openai-compatible"]',
      approved ? "contract-required" : "excluded",
      slot.legalEvidenceUrl ?? "https://xguardgate.com/security",
      now,
      now,
      enabled ? 1 : 0,
    )
    .run();

  const pricingId = `${modelId}:${slot.upstreamInputMicroUsdPerMillion}:${slot.upstreamOutputMicroUsdPerMillion}:${slot.saleInputMicroUsdPerMillion}:${slot.saleOutputMicroUsdPerMillion}`;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO pricing_history(
      pricing_id,model_id,provider_id,network_id,
      upstream_input_micro_usd_per_million,upstream_output_micro_usd_per_million,
      sale_input_micro_usd_per_million,sale_output_micro_usd_per_million,
      minimum_margin_micro_usd,minimum_margin_percent,source_url,
      effective_at,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      pricingId,
      modelId,
      slot.providerId,
      NETWORK_ID,
      Math.max(0, slot.upstreamInputMicroUsdPerMillion),
      Math.max(0, slot.upstreamOutputMicroUsdPerMillion),
      Math.max(0, slot.saleInputMicroUsdPerMillion),
      Math.max(0, slot.saleOutputMicroUsdPerMillion),
      decimalUsdToMicro(env.MIN_MARGIN_USD, 1_000),
      percentage(env.MIN_MARGIN_PERCENT, 15),
      slot.legalEvidenceUrl,
      now,
      now,
    )
    .run();
}

export async function activeModels(env: InferenceEnv): Promise<
  Array<{
    id: string;
    status: "available" | "degraded";
    latency_ms: number | null;
  }>
> {
  await syncRuntimeConfiguration(env);
  const candidates = configuredSlots(env).filter(
    (slot) => slot.resaleApproved && slot.legalEvidenceUrl !== null,
  );
  const byModel = new Map<
    string,
    { id: string; status: "available" | "degraded"; latency_ms: number | null }
  >();
  for (const slot of candidates) {
    const health = await latestHealth(env, slot.providerId);
    if (!health || !isFreshHealth(health.checked_at)) continue;
    if (health.status !== "HEALTHY" && health.status !== "DEGRADED") continue;
    const row = await env.DB.prepare(
      "SELECT enabled,status FROM models WHERE provider_id=? AND network_model_id=?",
    )
      .bind(slot.providerId, slot.networkModel)
      .first<{ enabled: number; status: string }>();
    if (row?.enabled !== 1 || !["READY", "ACTIVE"].includes(row.status))
      continue;
    const existing = byModel.get(slot.networkModel);
    const value = {
      id: slot.networkModel,
      status: health.status === "HEALTHY" ? "available" : "degraded",
      latency_ms: health.latency_ms,
    } as const;
    if (
      !existing ||
      (value.latency_ms ?? Infinity) < (existing.latency_ms ?? Infinity)
    )
      byModel.set(slot.networkModel, value);
  }
  return [...byModel.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function routeCandidates(
  env: InferenceEnv,
  networkModel: string,
): Promise<RouteCandidate[]> {
  await syncRuntimeConfiguration(env);
  const slots = configuredSlots(env).filter(
    (slot) =>
      slot.networkModel === networkModel &&
      slot.resaleApproved &&
      slot.legalEvidenceUrl !== null,
  );
  const routes: RouteCandidate[] = [];
  for (const slot of slots) {
    const modelId = `${slot.providerId}:${slot.networkModel}`;
    const model = await env.DB.prepare(
      "SELECT enabled,status FROM models WHERE model_id=?",
    )
      .bind(modelId)
      .first<{ enabled: number; status: string }>();
    if (model?.enabled !== 1 || !["READY", "ACTIVE"].includes(model.status))
      continue;
    const health = await latestHealth(env, slot.providerId);
    if (!health || !isFreshHealth(health.checked_at)) continue;
    if (health.status !== "HEALTHY" && health.status !== "DEGRADED") continue;
    const metrics = await env.DB.prepare(
      `SELECT COALESCE(SUM(requests),0) requests,
        COALESCE(SUM(successes),0) successes,
        COALESCE(SUM(latency_sum_ms),0) latency_sum_ms
       FROM routing_metrics WHERE provider_id=? AND bucket_at>=?`,
    )
      .bind(slot.providerId, new Date(Date.now() - 86_400_000).toISOString())
      .first<MetricsRow>();
    const requests = metrics?.requests ?? 0;
    routes.push({
      ...slot,
      modelId,
      healthStatus: health.status,
      latencyMs: health.latency_ms,
      successRate: requests > 0 ? (metrics?.successes ?? 0) / requests : 1,
    });
  }
  return routes.sort((a, b) => routeScore(a) - routeScore(b));
}

function routeScore(candidate: RouteCandidate): number {
  const nominalCost =
    candidate.upstreamInputMicroUsdPerMillion +
    candidate.upstreamOutputMicroUsdPerMillion;
  const healthPenalty =
    candidate.healthStatus === "DEGRADED" ? 1_000_000_000 : 0;
  const reliabilityPenalty = Math.round(
    (1 - candidate.successRate) * 500_000_000,
  );
  return (
    nominalCost +
    healthPenalty +
    reliabilityPenalty +
    (candidate.latencyMs ?? 60_000)
  );
}

export async function assertProfitGuard(
  env: InferenceEnv,
  revenueMicroUsd: number,
  costMicroUsd: number,
): Promise<void> {
  if (!profitAllowed(env, revenueMicroUsd, costMicroUsd))
    throw new InferenceError("route_blocked_by_profit_guard", 503);
  const today = await dailyFinancials(env);
  const maximumLoss = decimalUsdToMicro(env.MAX_DAILY_LOSS_USD, 5_000_000);
  if (today.net_profit_micro_usd <= -maximumLoss)
    throw new InferenceError("daily_loss_limit_reached", 503);
}

function profitAllowed(
  env: InferenceEnv,
  revenueMicroUsd: number,
  costMicroUsd: number,
): boolean {
  if (revenueMicroUsd <= 0 || costMicroUsd < 0) return false;
  const margin = revenueMicroUsd - costMicroUsd;
  const minimumMargin = decimalUsdToMicro(env.MIN_MARGIN_USD, 1_000);
  const minimumPercent = percentage(env.MIN_MARGIN_PERCENT, 15);
  return (
    margin >= minimumMargin &&
    (margin / revenueMicroUsd) * 100 >= minimumPercent
  );
}

export async function createNetworkRequest(
  env: InferenceEnv,
  input: {
    requestId: string;
    networkRequestId: string | null;
    requestHash: string;
    clientHash: string | null;
    modelId: string;
    stream: boolean;
    quotedRevenueMicroUsd: number;
  },
): Promise<RequestRecord> {
  const now = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO network_requests(
          request_id,network_id,network_request_id,request_hash,client_hash,
          model_id,stream,quoted_revenue_micro_usd,status,received_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        input.requestId,
        NETWORK_ID,
        input.networkRequestId,
        input.requestHash,
        input.clientHash,
        input.modelId,
        input.stream ? 1 : 0,
        input.quotedRevenueMicroUsd,
        "RECEIVED",
        now,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO revenue(
          revenue_id,request_id,network_id,amount_micro_usd,currency,state,
          evidence_reference,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?)`,
      ).bind(
        `rev_${input.requestId}`,
        input.requestId,
        NETWORK_ID,
        input.quotedRevenueMicroUsd,
        "USD",
        "QUOTED",
        null,
        now,
        now,
      ),
    ]);
  } catch (error) {
    if (input.networkRequestId) {
      const existing = await env.DB.prepare(
        "SELECT request_id,status FROM network_requests WHERE network_id=? AND network_request_id=?",
      )
        .bind(NETWORK_ID, input.networkRequestId)
        .first<{ request_id: string; status: string }>();
      if (existing)
        throw new InferenceError("duplicate_network_request", 409, {
          request_id: existing.request_id,
          status: existing.status,
        });
    }
    throw error;
  }
  return {
    requestId: input.requestId,
    quotedRevenueMicroUsd: input.quotedRevenueMicroUsd,
  };
}

export async function startAttempt(
  env: InferenceEnv,
  requestId: string,
  candidate: RouteCandidate,
  attempt: number,
  estimatedCostMicroUsd: number,
): Promise<AttemptRecord> {
  const upstreamRequestId = `xgiu_${crypto.randomUUID().replaceAll("-", "")}`;
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE network_requests SET status='ROUTING',updated_at=? WHERE request_id=?",
    ).bind(now, requestId),
    env.DB.prepare(
      `INSERT INTO upstream_requests(
        upstream_request_id,request_id,provider_id,attempt,upstream_model,
        estimated_cost_micro_usd,cost_basis,status,started_at
      ) VALUES(?,?,?,?,?,?,?,?,?)`,
    ).bind(
      upstreamRequestId,
      requestId,
      candidate.providerId,
      attempt,
      candidate.upstreamModel,
      estimatedCostMicroUsd,
      "ESTIMATED",
      "STARTED",
      now,
    ),
  ]);
  return { upstreamRequestId, attempt, estimatedCostMicroUsd };
}

export async function recordAttemptFailure(
  env: InferenceEnv,
  input: {
    requestId: string;
    upstreamRequestId: string;
    providerId: string;
    modelId: string;
    latencyMs: number;
    errorCode: string;
    timedOut: boolean;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const bucket = hourBucket(now);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE upstream_requests SET status=?,error_code=?,latency_ms=?,completed_at=?
       WHERE upstream_request_id=?`,
    ).bind(
      input.timedOut ? "TIMED_OUT" : "FAILED",
      input.errorCode,
      input.latencyMs,
      now,
      input.upstreamRequestId,
    ),
    env.DB.prepare(
      `INSERT INTO routing_metrics(
        bucket_at,network_id,model_id,provider_id,requests,failures,latency_sum_ms
      ) VALUES(?,?,?,?,1,1,?)
      ON CONFLICT(bucket_at,network_id,model_id,provider_id) DO UPDATE SET
        requests=requests+1,failures=failures+1,
        latency_sum_ms=latency_sum_ms+excluded.latency_sum_ms`,
    ).bind(
      bucket,
      NETWORK_ID,
      input.modelId,
      input.providerId,
      input.latencyMs,
    ),
  ]);
}

export async function completeRequest(
  env: InferenceEnv,
  requestId: string,
  upstreamRequestId: string,
  candidate: RouteCandidate,
  accounting: UsageAccounting,
): Promise<void> {
  const now = new Date().toISOString();
  const bucket = hourBucket(now);
  const costId = `cost_${upstreamRequestId}`;
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE upstream_requests SET
        actual_cost_micro_usd=?,cost_basis=?,prompt_tokens=?,completion_tokens=?,
        latency_ms=?,status='SUCCEEDED',completed_at=?
       WHERE upstream_request_id=?`,
    ).bind(
      accounting.upstreamCostMicroUsd,
      accounting.costBasis,
      accounting.promptTokens,
      accounting.completionTokens,
      accounting.latencyMs,
      now,
      upstreamRequestId,
    ),
    env.DB.prepare(
      `UPDATE network_requests SET
        prompt_tokens=?,completion_tokens=?,status='SUCCEEDED',completed_at=?,updated_at=?
       WHERE request_id=?`,
    ).bind(
      accounting.promptTokens,
      accounting.completionTokens,
      now,
      now,
      requestId,
    ),
    env.DB.prepare(
      `UPDATE revenue SET amount_micro_usd=?,state='PENDING',updated_at=?
       WHERE request_id=? AND state='QUOTED'`,
    ).bind(accounting.actualRevenueMicroUsd, now, requestId),
    env.DB.prepare(
      `INSERT OR IGNORE INTO costs(
        cost_id,request_id,upstream_request_id,provider_id,cost_type,
        amount_micro_usd,currency,basis,incurred_at,evidence_reference
      ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      `${costId}_upstream`,
      requestId,
      upstreamRequestId,
      candidate.providerId,
      "UPSTREAM",
      accounting.upstreamCostMicroUsd,
      "USD",
      accounting.costBasis,
      now,
      `usage:${upstreamRequestId}`,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO costs(
        cost_id,request_id,upstream_request_id,provider_id,cost_type,
        amount_micro_usd,currency,basis,incurred_at,evidence_reference
      ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      `${costId}_network`,
      requestId,
      upstreamRequestId,
      candidate.providerId,
      "NETWORK",
      accounting.networkCostMicroUsd,
      "USD",
      "NETWORK_TERMS",
      now,
      `configured-network-fee:${requestId}`,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO costs(
        cost_id,request_id,upstream_request_id,provider_id,cost_type,
        amount_micro_usd,currency,basis,incurred_at,evidence_reference
      ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      `${costId}_infra`,
      requestId,
      upstreamRequestId,
      candidate.providerId,
      "VARIABLE_INFRA",
      accounting.variableInfraCostMicroUsd,
      "USD",
      "CONFIGURED_RATE",
      now,
      `configured-infra-rate:${requestId}`,
    ),
    env.DB.prepare(
      `INSERT INTO routing_metrics(
        bucket_at,network_id,model_id,provider_id,requests,successes,
        prompt_tokens,completion_tokens,latency_sum_ms,revenue_micro_usd,cost_micro_usd
      ) VALUES(?,?,?,?,1,1,?,?,?,?,?)
      ON CONFLICT(bucket_at,network_id,model_id,provider_id) DO UPDATE SET
        requests=requests+1,successes=successes+1,
        prompt_tokens=prompt_tokens+excluded.prompt_tokens,
        completion_tokens=completion_tokens+excluded.completion_tokens,
        latency_sum_ms=latency_sum_ms+excluded.latency_sum_ms,
        revenue_micro_usd=revenue_micro_usd+excluded.revenue_micro_usd,
        cost_micro_usd=cost_micro_usd+excluded.cost_micro_usd`,
    ).bind(
      bucket,
      NETWORK_ID,
      candidate.modelId,
      candidate.providerId,
      accounting.promptTokens,
      accounting.completionTokens,
      accounting.latencyMs,
      accounting.actualRevenueMicroUsd,
      accounting.totalCostMicroUsd,
    ),
  ]);
  await refreshProfitBuckets(env, now);
  await refreshOperationalAlerts(env);
}

export async function failRequest(
  env: InferenceEnv,
  requestId: string,
  errorCode: string,
): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE network_requests SET status='FAILED',error_code=?,completed_at=?,updated_at=?
     WHERE request_id=? AND status!='SUCCEEDED'`,
  )
    .bind(errorCode, now, now, requestId)
    .run();
}

export async function markStreaming(
  env: InferenceEnv,
  requestId: string,
): Promise<void> {
  await env.DB.prepare(
    "UPDATE network_requests SET status='STREAMING',updated_at=? WHERE request_id=?",
  )
    .bind(new Date().toISOString(), requestId)
    .run();
}

export async function recordHealth(
  env: InferenceEnv,
  input: {
    providerId: string;
    status: RouteCandidate["healthStatus"];
    latencyMs: number | null;
    httpStatus: number | null;
    errorCode: string | null;
  },
): Promise<void> {
  const latest = await latestHealth(env, input.providerId);
  const failures =
    input.status === "HEALTHY"
      ? 0
      : (latest?.status === "HEALTHY"
          ? 0
          : await latestFailures(env, input.providerId)) + 1;
  await env.DB.prepare(
    `INSERT INTO provider_health(
      health_id,provider_id,checked_at,status,latency_ms,http_status,
      consecutive_failures,error_code
    ) VALUES(?,?,?,?,?,?,?,?)`,
  )
    .bind(
      `health_${crypto.randomUUID().replaceAll("-", "")}`,
      input.providerId,
      new Date().toISOString(),
      input.status,
      input.latencyMs,
      input.httpStatus,
      failures,
      input.errorCode,
    )
    .run();
}

async function latestHealth(
  env: InferenceEnv,
  providerId: string,
): Promise<HealthRow | null> {
  return env.DB.prepare(
    `SELECT status,latency_ms,checked_at FROM provider_health
     WHERE provider_id=? ORDER BY checked_at DESC LIMIT 1`,
  )
    .bind(providerId)
    .first<HealthRow>();
}

async function latestFailures(
  env: InferenceEnv,
  providerId: string,
): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT consecutive_failures FROM provider_health WHERE provider_id=? ORDER BY checked_at DESC LIMIT 1",
  )
    .bind(providerId)
    .first<{ consecutive_failures: number }>();
  return row?.consecutive_failures ?? 0;
}

function isFreshHealth(checkedAt: string): boolean {
  return Date.now() - Date.parse(checkedAt) <= 7_200_000;
}

export async function runOptimization(env: InferenceEnv): Promise<void> {
  const startedAt = new Date().toISOString();
  const runId = `opt_${crypto.randomUUID().replaceAll("-", "")}`;
  await env.DB.prepare(
    "INSERT INTO optimization_runs(run_id,started_at,status) VALUES(?,?,'RUNNING')",
  )
    .bind(runId, startedAt)
    .run();
  try {
    await syncRuntimeConfiguration(env);
    const slots = configuredSlots(env);
    const models = [...new Set(slots.map((slot) => slot.networkModel))];
    const decisions: Array<Record<string, unknown>> = [];
    let changes = 0;
    for (const model of models) {
      const routes = await routeCandidates(env, model);
      for (const [index, route] of routes.entries()) {
        const desired = index === 0 ? "ACTIVE" : "READY";
        const update = await env.DB.prepare(
          "UPDATE models SET status=?,status_reason=?,updated_at=? WHERE model_id=? AND status!=?",
        )
          .bind(
            desired,
            index === 0
              ? "Selected by six-hour optimizer"
              : "Healthy failover route",
            new Date().toISOString(),
            route.modelId,
            desired,
          )
          .run();
        changes += update.meta.changes ?? 0;
        decisions.push({
          model,
          provider_id: route.providerId,
          rank: index + 1,
          status: desired,
          health: route.healthStatus,
          success_rate: route.successRate,
          latency_ms: route.latencyMs,
        });
      }
    }
    const completedAt = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE optimization_runs SET completed_at=?,status='SUCCEEDED',
       models_examined=?,routes_changed=?,decisions_json=? WHERE run_id=?`,
    )
      .bind(
        completedAt,
        models.length,
        changes,
        JSON.stringify(decisions),
        runId,
      )
      .run();
    await refreshProfitBuckets(env, completedAt);
  } catch (error) {
    await env.DB.prepare(
      "UPDATE optimization_runs SET completed_at=?,status='FAILED',reason=? WHERE run_id=?",
    )
      .bind(
        new Date().toISOString(),
        error instanceof Error ? error.name : "unknown_error",
        runId,
      )
      .run();
    throw error;
  }
}

export async function refreshOperationalAlerts(
  env: InferenceEnv,
): Promise<void> {
  const today = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
  const [financial, network, outages, payoutFailures, settlementFailures] =
    await Promise.all([
      dailyFinancials(env),
      env.DB.prepare(
        "SELECT application_status FROM networks WHERE network_id=?",
      )
        .bind(NETWORK_ID)
        .first<{ application_status: string }>(),
      env.DB.prepare(
        `SELECT COUNT(*) total FROM upstream_providers p
         JOIN provider_health h ON h.health_id=(
           SELECT health_id FROM provider_health WHERE provider_id=p.provider_id
           ORDER BY checked_at DESC LIMIT 1
         ) WHERE p.enabled=1 AND h.status='UNHEALTHY'`,
      ).first<{ total: number }>(),
      env.DB.prepare(
        "SELECT COUNT(*) total FROM payouts WHERE status='FAILED' AND requested_at>=?",
      )
        .bind(today)
        .first<{ total: number }>(),
      env.DB.prepare(
        "SELECT COUNT(*) total FROM settlements WHERE status='REJECTED' AND recorded_at>=?",
      )
        .bind(today)
        .first<{ total: number }>(),
    ]);
  const maximumLoss = decimalUsdToMicro(env.MAX_DAILY_LOSS_USD, 5_000_000);
  const conditions = [
    {
      id: "dgrid-not-live",
      type: "DGRID_DISCONNECTED",
      severity: "WARNING" as const,
      active: network?.application_status !== "LIVE",
      message: `DGrid provider state is ${network?.application_status ?? "UNKNOWN"}`,
    },
    {
      id: "negative-daily-margin",
      type: "NEGATIVE_DAILY_MARGIN",
      severity: "CRITICAL" as const,
      active: financial.net_profit_micro_usd < 0,
      message: "Settled revenue minus recorded real cost is negative today",
    },
    {
      id: "abnormal-daily-spending",
      type: "ABNORMAL_SPENDING",
      severity: "CRITICAL" as const,
      active: financial.cost_micro_usd >= maximumLoss,
      message: "Recorded daily cost reached the configured loss limit",
    },
    {
      id: "upstream-outage",
      type: "PROVIDER_OUTAGE",
      severity: "CRITICAL" as const,
      active: (outages?.total ?? 0) > 0,
      message: "At least one enabled upstream is unhealthy",
    },
    {
      id: "payout-failure",
      type: "PAYOUT_FAILURE",
      severity: "CRITICAL" as const,
      active: (payoutFailures?.total ?? 0) > 0,
      message: "A payout failed today",
    },
    {
      id: "settlement-failure",
      type: "SETTLEMENT_FAILURE",
      severity: "CRITICAL" as const,
      active: (settlementFailures?.total ?? 0) > 0,
      message: "A network settlement was rejected today",
    },
  ];
  for (const condition of conditions)
    await reconcileAlert(env, condition, new Date().toISOString());
}

async function reconcileAlert(
  env: InferenceEnv,
  condition: {
    id: string;
    type: string;
    severity: "INFO" | "WARNING" | "CRITICAL";
    active: boolean;
    message: string;
  },
  now: string,
): Promise<void> {
  if (condition.active) {
    await env.DB.prepare(
      `INSERT INTO alerts(
        alert_id,alert_type,severity,status,message,first_seen_at,last_seen_at
      ) VALUES(?,?,?,'OPEN',?,?,?)
      ON CONFLICT(alert_id) DO UPDATE SET
        alert_type=excluded.alert_type,severity=excluded.severity,status='OPEN',
        message=excluded.message,last_seen_at=excluded.last_seen_at,resolved_at=NULL`,
    )
      .bind(
        condition.id,
        condition.type,
        condition.severity,
        condition.message,
        now,
        now,
      )
      .run();
    return;
  }
  await env.DB.prepare(
    "UPDATE alerts SET status='RESOLVED',resolved_at=?,last_seen_at=? WHERE alert_id=? AND status='OPEN'",
  )
    .bind(now, now, condition.id)
    .run();
}

export async function publicStatus(
  env: InferenceEnv,
): Promise<Record<string, unknown>> {
  const [models, network, health] = await Promise.all([
    activeModels(env),
    env.DB.prepare(
      "SELECT application_status,provider_interface_status,payout_mode FROM networks WHERE network_id=?",
    )
      .bind(NETWORK_ID)
      .first<{
        application_status: string;
        provider_interface_status: string;
        payout_mode: string;
      }>(),
    env.DB.prepare(
      `SELECT status,latency_ms,checked_at FROM provider_health
       ORDER BY checked_at DESC LIMIT 1`,
    ).first<HealthRow>(),
  ]);
  return {
    service: "XGuard Autonomous AI Inference Provider",
    live: models.length > 0,
    environment: env.XGUARD_ENVIRONMENT,
    release: env.XGUARD_RELEASE,
    git_commit: env.XGUARD_GIT_COMMIT,
    deployed_at: env.XGUARD_DEPLOYED_AT,
    api: models.length > 0 ? "ready" : "blocked",
    network: {
      id: NETWORK_ID,
      application_status: network?.application_status ?? "NOT_APPLIED",
      provider_interface_status:
        network?.provider_interface_status ?? "UNVERIFIED",
    },
    models,
    latest_health: health
      ? {
          status: health.status,
          latency_ms: health.latency_ms,
          checked_at: health.checked_at,
        }
      : null,
  };
}

export async function ownerMetrics(
  env: InferenceEnv,
): Promise<Record<string, unknown>> {
  const financial = await dailyFinancials(env);
  const [
    status,
    network,
    optimization,
    providers,
    opportunities,
    alerts,
    lastSevenDays,
    lastThirtyDays,
  ] = await Promise.all([
    publicStatus(env),
    env.DB.prepare("SELECT * FROM networks WHERE network_id=?")
      .bind(NETWORK_ID)
      .first<Record<string, unknown>>(),
    env.DB.prepare(
      "SELECT * FROM optimization_runs ORDER BY started_at DESC LIMIT 1",
    ).first<Record<string, unknown>>(),
    env.DB.prepare(
      `SELECT p.provider_id,p.display_name,p.legal_status,p.enabled,
          h.status health_status,h.latency_ms,h.checked_at
         FROM upstream_providers p
         LEFT JOIN provider_health h ON h.health_id=(
           SELECT health_id FROM provider_health WHERE provider_id=p.provider_id
           ORDER BY checked_at DESC LIMIT 1
         ) ORDER BY p.slot`,
    ).all<Record<string, unknown>>(),
    env.DB.prepare(
      `SELECT model_id,signal_type,observed_input_micro_usd_per_million,
          observed_output_micro_usd_per_million,demand_value,competition_value,
          demand_score,competition_score,price_score,cost_score,latency_score,
          margin_score,opportunity_score,score_status,source_url,observed_at,note
          FROM opportunity_snapshots
         ORDER BY observed_at DESC LIMIT 20`,
    ).all<Record<string, unknown>>(),
    env.DB.prepare(
      `SELECT alert_type,severity,message,first_seen_at,last_seen_at
         FROM alerts WHERE status='OPEN'
         ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END,
           last_seen_at DESC`,
    ).all<Record<string, unknown>>(),
    periodFinancials(env, 7),
    periodFinancials(env, 30),
  ]);
  return {
    ...status,
    dgrid: network,
    financial: formattedFinancials(financial),
    periods: {
      last_7_days: formattedFinancials(lastSevenDays),
      last_30_days: formattedFinancials(lastThirtyDays),
    },
    payout_destination_configured: Boolean(env.XGUARD_PAYOUT_DESTINATION),
    automatic_payout: "NOT_SUPPORTED",
    payout_policy: {
      threshold_usd: env.PAYOUT_THRESHOLD_USD,
      minimum_reserve_usd: env.MIN_RESERVE_USD,
      operating_reserve_percent: env.OPERATING_RESERVE_PERCENT,
    },
    automatic_optimization: "ON",
    optimization,
    providers: providers.results,
    opportunities: opportunities.results,
    alerts: alerts.results,
  };
}

function formattedFinancials(financial: FinancialRow): Record<string, unknown> {
  return {
    real_requests: financial.real_requests,
    settled_revenue_usd: microUsd(financial.settled_revenue_micro_usd),
    pending_revenue_usd: microUsd(financial.pending_revenue_micro_usd),
    withdrawable_usd: microUsd(financial.withdrawable_micro_usd),
    paid_to_owner_usd: microUsd(financial.paid_to_owner_micro_usd),
    real_cost_usd: microUsd(financial.cost_micro_usd),
    net_profit_usd: microUsd(financial.net_profit_micro_usd),
  };
}

async function periodFinancials(
  env: InferenceEnv,
  days: number,
): Promise<FinancialRow> {
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - (days - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return (
    (await env.DB.prepare(
      `SELECT COALESCE(SUM(real_requests),0) real_requests,
        COALESCE(SUM(settled_revenue_micro_usd),0) settled_revenue_micro_usd,
        COALESCE(SUM(pending_revenue_micro_usd),0) pending_revenue_micro_usd,
        COALESCE(SUM(withdrawable_micro_usd),0) withdrawable_micro_usd,
        COALESCE(SUM(paid_to_owner_micro_usd),0) paid_to_owner_micro_usd,
        COALESCE(SUM(cost_micro_usd),0) cost_micro_usd,
        COALESCE(SUM(net_profit_micro_usd),0) net_profit_micro_usd
       FROM profit_daily WHERE day>=? AND day<=?`,
    )
      .bind(start, end)
      .first<FinancialRow>()) ?? {
      real_requests: 0,
      settled_revenue_micro_usd: 0,
      pending_revenue_micro_usd: 0,
      withdrawable_micro_usd: 0,
      paid_to_owner_micro_usd: 0,
      cost_micro_usd: 0,
      net_profit_micro_usd: 0,
    }
  );
}

async function dailyFinancials(env: InferenceEnv): Promise<FinancialRow> {
  const day = new Date().toISOString().slice(0, 10);
  const row = await env.DB.prepare("SELECT * FROM profit_daily WHERE day=?")
    .bind(day)
    .first<FinancialRow>();
  if (row) return row;
  await refreshProfitBuckets(env, new Date().toISOString());
  return (
    (await env.DB.prepare("SELECT * FROM profit_daily WHERE day=?")
      .bind(day)
      .first<FinancialRow>()) ?? {
      real_requests: 0,
      settled_revenue_micro_usd: 0,
      pending_revenue_micro_usd: 0,
      withdrawable_micro_usd: 0,
      paid_to_owner_micro_usd: 0,
      cost_micro_usd: 0,
      net_profit_micro_usd: 0,
    }
  );
}

export async function refreshProfitBuckets(
  env: InferenceEnv,
  now: string,
): Promise<void> {
  const day = now.slice(0, 10);
  const hour = hourBucket(now);
  const revenue = await env.DB.prepare(
    `SELECT
      COALESCE(SUM(CASE WHEN state='SETTLED' THEN amount_micro_usd ELSE 0 END),0) settled,
      COALESCE(SUM(CASE WHEN state='PENDING' THEN amount_micro_usd ELSE 0 END),0) pending,
      COALESCE(SUM(CASE WHEN state='WITHDRAWABLE' THEN amount_micro_usd ELSE 0 END),0) withdrawable,
      COALESCE(SUM(CASE WHEN state='RECEIVED_BY_OWNER' THEN amount_micro_usd ELSE 0 END),0) paid
     FROM revenue WHERE created_at>=? AND created_at<?`,
  )
    .bind(`${day}T00:00:00.000Z`, `${day}T23:59:59.999Z`)
    .first<{
      settled: number;
      pending: number;
      withdrawable: number;
      paid: number;
    }>();
  const costs = await env.DB.prepare(
    "SELECT COALESCE(SUM(amount_micro_usd),0) total FROM costs WHERE incurred_at>=? AND incurred_at<?",
  )
    .bind(`${day}T00:00:00.000Z`, `${day}T23:59:59.999Z`)
    .first<{ total: number }>();
  const requests = await env.DB.prepare(
    "SELECT COUNT(*) total FROM network_requests WHERE status='SUCCEEDED' AND received_at>=? AND received_at<?",
  )
    .bind(`${day}T00:00:00.000Z`, `${day}T23:59:59.999Z`)
    .first<{ total: number }>();
  const settled = revenue?.settled ?? 0;
  const cost = costs?.total ?? 0;
  await env.DB.prepare(
    `INSERT INTO profit_daily(
      day,settled_revenue_micro_usd,pending_revenue_micro_usd,
      withdrawable_micro_usd,paid_to_owner_micro_usd,cost_micro_usd,
      net_profit_micro_usd,real_requests,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(day) DO UPDATE SET
      settled_revenue_micro_usd=excluded.settled_revenue_micro_usd,
      pending_revenue_micro_usd=excluded.pending_revenue_micro_usd,
      withdrawable_micro_usd=excluded.withdrawable_micro_usd,
      paid_to_owner_micro_usd=excluded.paid_to_owner_micro_usd,
      cost_micro_usd=excluded.cost_micro_usd,
      net_profit_micro_usd=excluded.net_profit_micro_usd,
      real_requests=excluded.real_requests,updated_at=excluded.updated_at`,
  )
    .bind(
      day,
      settled,
      revenue?.pending ?? 0,
      revenue?.withdrawable ?? 0,
      revenue?.paid ?? 0,
      cost,
      settled - cost,
      requests?.total ?? 0,
      now,
    )
    .run();

  const hourRevenue = await env.DB.prepare(
    `SELECT
      COALESCE(SUM(CASE WHEN state='SETTLED' THEN amount_micro_usd ELSE 0 END),0) settled,
      COALESCE(SUM(CASE WHEN state='PENDING' THEN amount_micro_usd ELSE 0 END),0) pending
     FROM revenue WHERE created_at>=? AND created_at<?`,
  )
    .bind(hour, new Date(Date.parse(hour) + 3_600_000).toISOString())
    .first<{ settled: number; pending: number }>();
  const hourCosts = await env.DB.prepare(
    "SELECT COALESCE(SUM(amount_micro_usd),0) total FROM costs WHERE incurred_at>=? AND incurred_at<?",
  )
    .bind(hour, new Date(Date.parse(hour) + 3_600_000).toISOString())
    .first<{ total: number }>();
  const hourRequests = await env.DB.prepare(
    "SELECT COUNT(*) total FROM network_requests WHERE status='SUCCEEDED' AND received_at>=? AND received_at<?",
  )
    .bind(hour, new Date(Date.parse(hour) + 3_600_000).toISOString())
    .first<{ total: number }>();
  const hourSettled = hourRevenue?.settled ?? 0;
  const hourCost = hourCosts?.total ?? 0;
  await env.DB.prepare(
    `INSERT INTO profit_hourly(
      bucket_at,settled_revenue_micro_usd,pending_revenue_micro_usd,
      cost_micro_usd,net_profit_micro_usd,real_requests,updated_at
    ) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(bucket_at) DO UPDATE SET
      settled_revenue_micro_usd=excluded.settled_revenue_micro_usd,
      pending_revenue_micro_usd=excluded.pending_revenue_micro_usd,
      cost_micro_usd=excluded.cost_micro_usd,
      net_profit_micro_usd=excluded.net_profit_micro_usd,
      real_requests=excluded.real_requests,updated_at=excluded.updated_at`,
  )
    .bind(
      hour,
      hourSettled,
      hourRevenue?.pending ?? 0,
      hourCost,
      hourSettled - hourCost,
      hourRequests?.total ?? 0,
      now,
    )
    .run();
}

function hourBucket(value: string): string {
  return `${value.slice(0, 13)}:00:00.000Z`;
}
