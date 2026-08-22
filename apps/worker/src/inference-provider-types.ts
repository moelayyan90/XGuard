import { z } from "zod";

export const ORIGIN = "https://xguardgate.com";
export const SERVICE = "xguard-autonomous-ai-inference-provider";
export const VERSION = "2.0.0";
export const MAX_BODY_BYTES = 1_048_576;
export const NETWORK_ID = "dgrid";

export interface InferenceEnv {
  DB: D1Database;
  INFERENCE_COORDINATOR: DurableObjectNamespace;
  NETWORK_RATE_LIMITER: RateLimit;
  GLOBAL_RATE_LIMITER: RateLimit;
  XGUARD_ENVIRONMENT: "production" | "test";
  XGUARD_RELEASE: string;
  XGUARD_GIT_COMMIT: string;
  XGUARD_DEPLOYED_AT: string;
  MIN_MARGIN_USD: string;
  MIN_MARGIN_PERCENT: string;
  MAX_DAILY_LOSS_USD: string;
  PAYOUT_THRESHOLD_USD: string;
  MIN_RESERVE_USD: string;
  OPERATING_RESERVE_PERCENT: string;
  XGUARD_NETWORK_FEE_PERCENT?: string;
  XGUARD_VARIABLE_INFRA_MICRO_USD_PER_REQUEST?: string;
  XGUARD_MAX_CONCURRENCY: string;
  XGUARD_UPSTREAM_TIMEOUT_MS: string;
  XGUARD_UPSTREAM_HOST_ALLOWLIST?: string;
  DGRID_PROVIDER_API_KEY?: string;
  XGUARD_ADMIN_TOKEN?: string;
  XGUARD_PAYOUT_DESTINATION?: string;
  XGUARD_UPSTREAM_1_BASE_URL?: string;
  XGUARD_UPSTREAM_1_API_KEY?: string;
  XGUARD_UPSTREAM_1_NAME?: string;
  XGUARD_UPSTREAM_1_MODEL?: string;
  XGUARD_UPSTREAM_1_NETWORK_MODEL?: string;
  XGUARD_UPSTREAM_1_RESALE_APPROVED?: string;
  XGUARD_UPSTREAM_1_LEGAL_EVIDENCE_URL?: string;
  XGUARD_UPSTREAM_1_INPUT_MICRO_USD_PER_MILLION?: string;
  XGUARD_UPSTREAM_1_OUTPUT_MICRO_USD_PER_MILLION?: string;
  XGUARD_UPSTREAM_1_SALE_INPUT_MICRO_USD_PER_MILLION?: string;
  XGUARD_UPSTREAM_1_SALE_OUTPUT_MICRO_USD_PER_MILLION?: string;
  XGUARD_UPSTREAM_2_BASE_URL?: string;
  XGUARD_UPSTREAM_2_API_KEY?: string;
  XGUARD_UPSTREAM_2_NAME?: string;
  XGUARD_UPSTREAM_2_MODEL?: string;
  XGUARD_UPSTREAM_2_NETWORK_MODEL?: string;
  XGUARD_UPSTREAM_2_RESALE_APPROVED?: string;
  XGUARD_UPSTREAM_2_LEGAL_EVIDENCE_URL?: string;
  XGUARD_UPSTREAM_2_INPUT_MICRO_USD_PER_MILLION?: string;
  XGUARD_UPSTREAM_2_OUTPUT_MICRO_USD_PER_MILLION?: string;
  XGUARD_UPSTREAM_2_SALE_INPUT_MICRO_USD_PER_MILLION?: string;
  XGUARD_UPSTREAM_2_SALE_OUTPUT_MICRO_USD_PER_MILLION?: string;
  XGUARD_UPSTREAM_3_BASE_URL?: string;
  XGUARD_UPSTREAM_3_API_KEY?: string;
  XGUARD_UPSTREAM_3_NAME?: string;
  XGUARD_UPSTREAM_3_MODEL?: string;
  XGUARD_UPSTREAM_3_NETWORK_MODEL?: string;
  XGUARD_UPSTREAM_3_RESALE_APPROVED?: string;
  XGUARD_UPSTREAM_3_LEGAL_EVIDENCE_URL?: string;
  XGUARD_UPSTREAM_3_INPUT_MICRO_USD_PER_MILLION?: string;
  XGUARD_UPSTREAM_3_OUTPUT_MICRO_USD_PER_MILLION?: string;
  XGUARD_UPSTREAM_3_SALE_INPUT_MICRO_USD_PER_MILLION?: string;
  XGUARD_UPSTREAM_3_SALE_OUTPUT_MICRO_USD_PER_MILLION?: string;
}

export interface CoordinatorLease {
  acquired: boolean;
  leaseId?: string;
  retryAfterSeconds?: number;
}

export interface CoordinatorApi {
  acquire(
    maxConcurrency: number,
    ttlSeconds: number,
  ): Promise<CoordinatorLease>;
  release(leaseId: string): Promise<void>;
}

export interface SlotConfig {
  slot: 1 | 2 | 3;
  providerId: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  upstreamModel: string;
  networkModel: string;
  resaleApproved: boolean;
  legalEvidenceUrl: string | null;
  upstreamInputMicroUsdPerMillion: number;
  upstreamOutputMicroUsdPerMillion: number;
  saleInputMicroUsdPerMillion: number;
  saleOutputMicroUsdPerMillion: number;
}

export interface RouteCandidate extends SlotConfig {
  modelId: string;
  healthStatus: "HEALTHY" | "DEGRADED" | "UNHEALTHY" | "UNCONFIGURED";
  latencyMs: number | null;
  successRate: number;
}

export interface RouteCostBreakdown {
  upstreamMicroUsd: number;
  networkMicroUsd: number;
  variableInfraMicroUsd: number;
  totalMicroUsd: number;
}

const contentPart = z.record(z.string(), z.unknown());
const message = z
  .object({
    role: z.enum(["system", "developer", "user", "assistant", "tool"]),
    content: z
      .union([z.string().max(262_144), z.array(contentPart).max(128), z.null()])
      .optional(),
    name: z.string().max(128).optional(),
    tool_call_id: z.string().max(256).optional(),
  })
  .passthrough();

export const chatCompletionSchema = z
  .object({
    model: z.string().min(1).max(256),
    messages: z.array(message).min(1).max(512),
    stream: z.boolean().optional().default(false),
    max_tokens: z.number().int().min(1).max(65_536).optional(),
    max_completion_tokens: z.number().int().min(1).max(65_536).optional(),
    user: z.string().max(256).optional(),
  })
  .passthrough();

export type ChatCompletionInput = z.infer<typeof chatCompletionSchema>;

export class InferenceError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly detail?: Record<string, unknown>,
  ) {
    super(code);
  }
}

export async function readJson(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES)
    throw new InferenceError("request_too_large", 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES)
    throw new InferenceError("request_too_large", 413);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new InferenceError("invalid_json", 400);
  }
}

export function json(
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof z.ZodError)
    return json(
      {
        error: {
          message: "Invalid request",
          type: "invalid_request_error",
          code: "invalid_request",
        },
      },
      400,
    );
  if (error instanceof InferenceError)
    return json(
      {
        error: {
          message: error.code,
          type: error.status >= 500 ? "server_error" : "invalid_request_error",
          code: error.code,
          ...(error.detail ? { detail: error.detail } : {}),
        },
      },
      error.status,
      error.status === 429
        ? { "retry-after": String(error.detail?.retry_after_seconds ?? 30) }
        : {},
    );
  return json(
    {
      error: {
        message: "Internal server error",
        type: "server_error",
        code: "internal_error",
      },
    },
    500,
  );
}

export function decimalUsdToMicro(value: string, fallback: number): number {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/u.test(value)) return fallback;
  const [whole = "0", fraction = ""] = value.split(".");
  const result = Number(whole) * 1_000_000 + Number(fraction.padEnd(6, "0"));
  return Number.isSafeInteger(result) ? result : fallback;
}

export function positiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function percentage(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100
    ? parsed
    : fallback;
}

export function routeCostBreakdown(
  env: InferenceEnv,
  revenueMicroUsd: number,
  upstreamMicroUsd: number,
): RouteCostBreakdown | null {
  const feeText = env.XGUARD_NETWORK_FEE_PERCENT?.trim() ?? "";
  const infraText =
    env.XGUARD_VARIABLE_INFRA_MICRO_USD_PER_REQUEST?.trim() ?? "";
  const feePercent = Number(feeText);
  const variableInfraMicroUsd = Number(infraText);
  if (
    !feeText ||
    !infraText ||
    !Number.isFinite(feePercent) ||
    feePercent < 0 ||
    feePercent > 100 ||
    !Number.isSafeInteger(variableInfraMicroUsd) ||
    variableInfraMicroUsd < 0 ||
    upstreamMicroUsd < 0
  )
    return null;
  const networkMicroUsd = Math.ceil((revenueMicroUsd * feePercent) / 100);
  return {
    upstreamMicroUsd,
    networkMicroUsd,
    variableInfraMicroUsd,
    totalMicroUsd: upstreamMicroUsd + networkMicroUsd + variableInfraMicroUsd,
  };
}

export function microUsd(value: number): string {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(Math.trunc(value));
  const whole = Math.floor(absolute / 1_000_000);
  const fraction = String(absolute % 1_000_000)
    .padStart(6, "0")
    .replace(/0+$/u, "");
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function timingSafeSecret(
  supplied: string | null,
  expected: string | undefined,
): Promise<boolean> {
  if (!supplied || !expected || expected.length < 16) return false;
  const [a, b] = await Promise.all([sha256(supplied), sha256(expected)]);
  let mismatch = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1)
    mismatch |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  return mismatch === 0;
}

export function bearerToken(request: Request): string | null {
  return (
    request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/iu)?.[1] ??
    null
  );
}

export function configuredSlots(env: InferenceEnv): SlotConfig[] {
  return ([1, 2, 3] as const)
    .map((slot) => slotConfig(env, slot))
    .filter((value): value is SlotConfig => value !== null);
}

function slotConfig(env: InferenceEnv, slot: 1 | 2 | 3): SlotConfig | null {
  const prefix = `XGUARD_UPSTREAM_${slot}_` as const;
  const read = (suffix: string): string | undefined =>
    (env as unknown as Record<string, string | undefined>)[
      `${prefix}${suffix}`
    ];
  const baseUrl = read("BASE_URL")?.trim() ?? "";
  const apiKey = read("API_KEY")?.trim() ?? "";
  const upstreamModel = read("MODEL")?.trim() ?? "";
  const networkModel = read("NETWORK_MODEL")?.trim() ?? "";
  if (!baseUrl || !apiKey || !upstreamModel || !networkModel) return null;
  const validated = validatedBaseUrl(
    baseUrl,
    env.XGUARD_UPSTREAM_HOST_ALLOWLIST,
  );
  return {
    slot,
    providerId: `runtime-slot-${slot}`,
    name: read("NAME")?.trim() || `Upstream slot ${slot}`,
    baseUrl: validated,
    apiKey,
    upstreamModel,
    networkModel,
    resaleApproved: read("RESALE_APPROVED") === "true",
    legalEvidenceUrl: nullableHttpsUrl(read("LEGAL_EVIDENCE_URL")),
    upstreamInputMicroUsdPerMillion: positiveInteger(
      read("INPUT_MICRO_USD_PER_MILLION"),
      -1,
    ),
    upstreamOutputMicroUsdPerMillion: positiveInteger(
      read("OUTPUT_MICRO_USD_PER_MILLION"),
      -1,
    ),
    saleInputMicroUsdPerMillion: positiveInteger(
      read("SALE_INPUT_MICRO_USD_PER_MILLION"),
      -1,
    ),
    saleOutputMicroUsdPerMillion: positiveInteger(
      read("SALE_OUTPUT_MICRO_USD_PER_MILLION"),
      -1,
    ),
  };
}

function validatedBaseUrl(
  value: string,
  allowlist: string | undefined,
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InferenceError("invalid_upstream_base_url", 503);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    throw new InferenceError("invalid_upstream_base_url", 503);
  const allowed = new Set(
    (allowlist ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
  if (allowed.size > 0 && !allowed.has(url.hostname.toLowerCase()))
    throw new InferenceError("upstream_host_not_allowlisted", 503);
  url.pathname = url.pathname.replace(/\/+$/u, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
}

function nullableHttpsUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function estimateTokens(input: ChatCompletionInput): {
  promptTokens: number;
  maximumCompletionTokens: number;
} {
  const serialized = JSON.stringify(input.messages);
  const promptTokens = Math.max(1, Math.ceil(serialized.length / 4));
  const maximumCompletionTokens =
    input.max_completion_tokens ?? input.max_tokens ?? 1024;
  return { promptTokens, maximumCompletionTokens };
}

export function tokenCost(
  promptTokens: number,
  completionTokens: number,
  inputMicroUsdPerMillion: number,
  outputMicroUsdPerMillion: number,
): number {
  return (
    Math.ceil((promptTokens * inputMicroUsdPerMillion) / 1_000_000) +
    Math.ceil((completionTokens * outputMicroUsdPerMillion) / 1_000_000)
  );
}

export function requestId(): string {
  return `xgir_${crypto.randomUUID().replaceAll("-", "")}`;
}
