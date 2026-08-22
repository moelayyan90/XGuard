import {
  assertProfitGuard,
  completeRequest,
  createNetworkRequest,
  failRequest,
  markStreaming,
  recordAttemptFailure,
  recordHealth,
  refreshOperationalAlerts,
  routeCandidates,
  runOptimization,
  startAttempt,
  syncRuntimeConfiguration,
  type UsageAccounting,
} from "./inference-provider-store.js";
import {
  bearerToken,
  chatCompletionSchema,
  configuredSlots,
  estimateTokens,
  InferenceError,
  type InferenceEnv,
  json,
  positiveInteger,
  requestId,
  type RouteCandidate,
  routeCostBreakdown,
  sha256,
  tokenCost,
} from "./inference-provider-types.js";

interface UpstreamUsage {
  promptTokens: number;
  completionTokens: number;
  reported: boolean;
}

export async function handleChatCompletion(
  request: Request,
  env: InferenceEnv,
  context: ExecutionContext,
  raw: unknown,
): Promise<Response> {
  const input = chatCompletionSchema.parse(raw);
  const routes = await routeCandidates(env, input.model);
  if (routes.length === 0)
    throw new InferenceError("model_unavailable", 503, { model: input.model });

  const estimates = estimateTokens(input);
  const primary = routes[0];
  if (!primary) throw new InferenceError("model_unavailable", 503);
  const quotedRevenue = tokenCost(
    estimates.promptTokens,
    estimates.maximumCompletionTokens,
    primary.saleInputMicroUsdPerMillion,
    primary.saleOutputMicroUsdPerMillion,
  );
  const quotedUpstreamCost = tokenCost(
    estimates.promptTokens,
    estimates.maximumCompletionTokens,
    primary.upstreamInputMicroUsdPerMillion,
    primary.upstreamOutputMicroUsdPerMillion,
  );
  const quotedCosts = routeCostBreakdown(
    env,
    quotedRevenue,
    quotedUpstreamCost,
  );
  if (!quotedCosts) throw new InferenceError("route_costs_unverified", 503);
  await assertProfitGuard(env, quotedRevenue, quotedCosts.totalMicroUsd);

  const coordinator = env.INFERENCE_COORDINATOR.getByName(
    input.model,
  ) as unknown as {
    acquire(
      maxConcurrency: number,
      ttlSeconds: number,
    ): Promise<{
      acquired: boolean;
      leaseId?: string;
      retryAfterSeconds?: number;
    }>;
    release(leaseId: string): Promise<void>;
  };
  const timeoutMs = Math.min(
    120_000,
    Math.max(5_000, positiveInteger(env.XGUARD_UPSTREAM_TIMEOUT_MS, 60_000)),
  );
  const lease = await coordinator.acquire(
    Math.min(100, Math.max(1, positiveInteger(env.XGUARD_MAX_CONCURRENCY, 8))),
    Math.ceil(timeoutMs / 1_000) + 30,
  );
  if (!lease.acquired || !lease.leaseId)
    throw new InferenceError("model_concurrency_limit", 429, {
      retry_after_seconds: lease.retryAfterSeconds ?? 5,
    });

  const internalRequestId = requestId();
  let requestCreated = false;
  try {
    const canonicalBody = JSON.stringify(input);
    const clientIp = request.headers.get("cf-connecting-ip");
    await createNetworkRequest(env, {
      requestId: internalRequestId,
      networkRequestId:
        request.headers.get("x-request-id") ??
        request.headers.get("idempotency-key"),
      requestHash: await sha256(canonicalBody),
      clientHash: clientIp ? await sha256(clientIp) : null,
      modelId: input.model,
      stream: input.stream,
      quotedRevenueMicroUsd: quotedRevenue,
    });
    requestCreated = true;

    for (const [index, route] of routes.entries()) {
      const routeRevenue = tokenCost(
        estimates.promptTokens,
        estimates.maximumCompletionTokens,
        route.saleInputMicroUsdPerMillion,
        route.saleOutputMicroUsdPerMillion,
      );
      const estimatedUpstreamCost = tokenCost(
        estimates.promptTokens,
        estimates.maximumCompletionTokens,
        route.upstreamInputMicroUsdPerMillion,
        route.upstreamOutputMicroUsdPerMillion,
      );
      const estimatedCosts = routeCostBreakdown(
        env,
        routeRevenue,
        estimatedUpstreamCost,
      );
      if (!estimatedCosts) continue;
      await assertProfitGuard(env, routeRevenue, estimatedCosts.totalMicroUsd);
      const attempt = await startAttempt(
        env,
        internalRequestId,
        route,
        index + 1,
        estimatedUpstreamCost,
      );
      const started = Date.now();
      try {
        const upstream = await callUpstream(input, route, timeoutMs);
        const latencyMs = Date.now() - started;
        if (!upstream.ok) {
          await recordAttemptFailure(env, {
            requestId: internalRequestId,
            upstreamRequestId: attempt.upstreamRequestId,
            providerId: route.providerId,
            modelId: route.modelId,
            latencyMs,
            errorCode: `upstream_http_${upstream.status}`,
            timedOut: false,
          });
          if (
            upstream.status >= 400 &&
            upstream.status < 500 &&
            upstream.status !== 429
          )
            break;
          continue;
        }
        if (input.stream) {
          if (!upstream.body)
            throw new InferenceError("upstream_stream_missing", 502);
          await markStreaming(env, internalRequestId);
          const [clientBody, accountingBody] = upstream.body.tee();
          context.waitUntil(
            finalizeStream(
              accountingBody,
              env,
              internalRequestId,
              attempt.upstreamRequestId,
              route,
              estimates.promptTokens,
              estimates.maximumCompletionTokens,
              latencyMs,
            )
              .catch(async () =>
                failRequest(env, internalRequestId, "stream_accounting_failed"),
              )
              .finally(async () => coordinator.release(lease.leaseId ?? "")),
          );
          return new Response(clientBody, {
            status: 200,
            headers: responseHeaders(upstream.headers, internalRequestId, true),
          });
        }
        const payload = await safeJson(upstream);
        const usage = extractUsage(
          payload,
          estimates.promptTokens,
          estimates.maximumCompletionTokens,
        );
        const accounting = accountingFor(env, route, usage, latencyMs);
        await completeRequest(
          env,
          internalRequestId,
          attempt.upstreamRequestId,
          route,
          accounting,
        );
        await coordinator.release(lease.leaseId);
        return json(rewriteResponseModel(payload, input.model), 200, {
          "x-xguard-request-id": internalRequestId,
        });
      } catch (error) {
        const latencyMs = Date.now() - started;
        const timedOut =
          error instanceof DOMException && error.name === "TimeoutError";
        await recordAttemptFailure(env, {
          requestId: internalRequestId,
          upstreamRequestId: attempt.upstreamRequestId,
          providerId: route.providerId,
          modelId: route.modelId,
          latencyMs,
          errorCode: timedOut ? "upstream_timeout" : "upstream_transport_error",
          timedOut,
        });
      }
    }
    await failRequest(env, internalRequestId, "all_upstreams_failed");
    throw new InferenceError("upstream_unavailable", 502);
  } catch (error) {
    if (
      requestCreated &&
      !(
        error instanceof InferenceError && error.code === "upstream_unavailable"
      )
    )
      await failRequest(
        env,
        internalRequestId,
        error instanceof InferenceError ? error.code : "request_failed",
      );
    await coordinator.release(lease.leaseId);
    throw error;
  }
}

async function callUpstream(
  input: ReturnType<typeof chatCompletionSchema.parse>,
  route: RouteCandidate,
  timeoutMs: number,
): Promise<Response> {
  const payload: Record<string, unknown> = {
    ...input,
    model: route.upstreamModel,
  };
  if (input.stream)
    payload.stream_options = {
      ...(typeof input.stream_options === "object" &&
      input.stream_options !== null
        ? input.stream_options
        : {}),
      include_usage: true,
    };
  return fetch(`${route.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${route.apiKey}`,
      "content-type": "application/json",
      accept: input.stream ? "text/event-stream" : "application/json",
      "user-agent": "XGuard-Inference/2.0 (+https://xguardgate.com/security)",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("json"))
    throw new InferenceError("invalid_upstream_content_type", 502);
  const text = await response.text();
  if (text.length > 4_194_304)
    throw new InferenceError("upstream_response_too_large", 502);
  try {
    const value = JSON.parse(text) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new Error("not_object");
    return value as Record<string, unknown>;
  } catch {
    throw new InferenceError("invalid_upstream_json", 502);
  }
}

function extractUsage(
  payload: Record<string, unknown>,
  fallbackPrompt: number,
  fallbackCompletion: number,
): UpstreamUsage {
  const usage =
    typeof payload.usage === "object" && payload.usage !== null
      ? (payload.usage as Record<string, unknown>)
      : null;
  const prompt = Number(usage?.prompt_tokens);
  const completion = Number(usage?.completion_tokens);
  const reported =
    Number.isSafeInteger(prompt) &&
    prompt >= 0 &&
    Number.isSafeInteger(completion) &&
    completion >= 0;
  return {
    promptTokens: reported ? prompt : fallbackPrompt,
    completionTokens: reported ? completion : fallbackCompletion,
    reported,
  };
}

function accountingFor(
  env: InferenceEnv,
  route: RouteCandidate,
  usage: UpstreamUsage,
  latencyMs: number,
): UsageAccounting {
  const actualRevenueMicroUsd = tokenCost(
    usage.promptTokens,
    usage.completionTokens,
    route.saleInputMicroUsdPerMillion,
    route.saleOutputMicroUsdPerMillion,
  );
  const upstreamCostMicroUsd = tokenCost(
    usage.promptTokens,
    usage.completionTokens,
    route.upstreamInputMicroUsdPerMillion,
    route.upstreamOutputMicroUsdPerMillion,
  );
  const costs = routeCostBreakdown(
    env,
    actualRevenueMicroUsd,
    upstreamCostMicroUsd,
  );
  if (!costs) throw new InferenceError("route_costs_unverified", 503);
  return {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    latencyMs,
    upstreamCostMicroUsd: costs.upstreamMicroUsd,
    networkCostMicroUsd: costs.networkMicroUsd,
    variableInfraCostMicroUsd: costs.variableInfraMicroUsd,
    totalCostMicroUsd: costs.totalMicroUsd,
    actualRevenueMicroUsd,
    costBasis: usage.reported ? "USAGE_REPORTED" : "ESTIMATED",
  };
}

async function finalizeStream(
  body: ReadableStream<Uint8Array>,
  env: InferenceEnv,
  internalRequestId: string,
  upstreamRequestId: string,
  route: RouteCandidate,
  fallbackPrompt: number,
  fallbackCompletion: number,
  initialLatencyMs: number,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let observedBytes = 0;
  let usage: UpstreamUsage = {
    promptTokens: fallbackPrompt,
    completionTokens: fallbackCompletion,
    reported: false,
  };
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    observedBytes += part.value.byteLength;
    if (observedBytes > 16_777_216)
      throw new InferenceError("upstream_stream_too_large", 502);
    buffer += decoder.decode(part.value, { stream: true });
    const lines = buffer.split(/\r?\n/u);
    buffer = lines.pop() ?? "";
    for (const line of lines) usage = streamUsage(line, usage);
  }
  buffer += decoder.decode();
  for (const line of buffer.split(/\r?\n/u)) usage = streamUsage(line, usage);
  await completeRequest(
    env,
    internalRequestId,
    upstreamRequestId,
    route,
    accountingFor(env, route, usage, Math.max(initialLatencyMs, 1)),
  );
}

function streamUsage(line: string, current: UpstreamUsage): UpstreamUsage {
  if (!line.startsWith("data:") || line.trim() === "data: [DONE]")
    return current;
  try {
    const payload = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
    const candidate = extractUsage(
      payload,
      current.promptTokens,
      current.completionTokens,
    );
    return candidate.reported ? candidate : current;
  } catch {
    return current;
  }
}

function rewriteResponseModel(
  payload: Record<string, unknown>,
  requestedModel: string,
): Record<string, unknown> {
  return { ...payload, model: requestedModel };
}

function responseHeaders(
  upstream: Headers,
  internalRequestId: string,
  streaming: boolean,
): Headers {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": streaming
      ? "text/event-stream; charset=utf-8"
      : (upstream.get("content-type") ?? "application/json"),
    "x-accel-buffering": "no",
    "x-content-type-options": "nosniff",
    "x-xguard-request-id": internalRequestId,
  });
  return headers;
}

export async function runHealthChecks(env: InferenceEnv): Promise<void> {
  await syncRuntimeConfiguration(env);
  for (const slot of configuredSlots(env)) {
    if (!slot.resaleApproved || slot.legalEvidenceUrl === null) {
      await recordHealth(env, {
        providerId: slot.providerId,
        status: "UNCONFIGURED",
        latencyMs: null,
        httpStatus: null,
        errorCode: "legal_approval_missing",
      });
      continue;
    }
    const started = Date.now();
    try {
      const response = await fetch(`${slot.baseUrl}/models`, {
        headers: {
          authorization: `Bearer ${slot.apiKey}`,
          accept: "application/json",
          "user-agent": "XGuard-Health/2.0 (+https://xguardgate.com/security)",
        },
        signal: AbortSignal.timeout(8_000),
      });
      await response.body?.cancel();
      await recordHealth(env, {
        providerId: slot.providerId,
        status: response.ok
          ? "HEALTHY"
          : response.status === 429
            ? "DEGRADED"
            : "UNHEALTHY",
        latencyMs: Date.now() - started,
        httpStatus: response.status,
        errorCode: response.ok ? null : `health_http_${response.status}`,
      });
    } catch (error) {
      await recordHealth(env, {
        providerId: slot.providerId,
        status: "UNHEALTHY",
        latencyMs: Date.now() - started,
        httpStatus: null,
        errorCode:
          error instanceof DOMException && error.name === "TimeoutError"
            ? "health_timeout"
            : "health_transport_error",
      });
    }
  }
}

export async function scheduledMaintenance(env: InferenceEnv): Promise<void> {
  await runHealthChecks(env);
  const hour = new Date().getUTCHours();
  if (hour % 6 === 0) await runOptimization(env);
  await refreshOperationalAlerts(env);
}

export function networkToken(request: Request): string | null {
  return bearerToken(request);
}
