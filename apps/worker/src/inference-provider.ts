import { InferenceCoordinator } from "./inference-provider-coordinator.js";
import {
  handleChatCompletion,
  networkToken,
  scheduledMaintenance,
} from "./inference-provider-router.js";
import {
  activeModels,
  ownerMetrics,
  publicStatus,
} from "./inference-provider-store.js";
import {
  errorResponse,
  type InferenceEnv,
  InferenceError,
  json,
  ORIGIN,
  readJson,
  SERVICE,
  timingSafeSecret,
  VERSION,
} from "./inference-provider-types.js";
import {
  openApiDocument,
  renderOwnerDashboard,
  renderPublicSite,
} from "./inference-provider-site.js";

export { InferenceCoordinator };

export default {
  async fetch(
    request: Request,
    env: InferenceEnv,
    context: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "OPTIONS") return preflight();
      if (request.method === "GET" && url.pathname === "/")
        return renderPublicSite(await publicStatus(env));
      if (request.method === "GET" && url.pathname === "/healthz")
        return json({ status: "ok", service: SERVICE, version: VERSION });
      if (request.method === "GET" && url.pathname === "/readyz") {
        const models = await activeModels(env);
        return json(
          {
            ready: models.length > 0,
            active_models: models.map((model) => model.id),
          },
          models.length > 0 ? 200 : 503,
        );
      }
      if (request.method === "GET" && url.pathname === "/v1/status")
        return withCors(json(await publicStatus(env)));
      if (request.method === "GET" && url.pathname === "/v1/models") {
        const models = await activeModels(env);
        return withCors(
          json({
            object: "list",
            data: models.map((model) => ({
              id: model.id,
              object: "model",
              created: 0,
              owned_by: "xguard",
              availability: model.status,
              latency_ms: model.latency_ms,
            })),
          }),
        );
      }
      if (request.method === "GET" && url.pathname === "/openapi.json")
        return withCors(json(openApiDocument()));
      if (
        request.method === "GET" &&
        (url.pathname === "/.well-known/security.txt" ||
          url.pathname === "/security.txt")
      )
        return text(
          `Contact: mailto:security@xguardgate.com\nCanonical: ${ORIGIN}/.well-known/security.txt\nPolicy: ${ORIGIN}/security\nExpires: 2027-08-22T00:00:00Z\n`,
          "text/plain; charset=utf-8",
        );
      if (request.method === "GET" && url.pathname === "/robots.txt")
        return text(
          "User-agent: *\nAllow: /\nDisallow: /owner\nDisallow: /v1/admin/\n",
          "text/plain; charset=utf-8",
        );

      if (
        url.pathname === "/owner" ||
        url.pathname === "/v1/admin/metrics" ||
        url.pathname === "/v1/admin/maintenance"
      ) {
        await requireAdmin(request, env);
        if (url.pathname === "/v1/admin/maintenance") {
          if (request.method !== "POST") return methodNotAllowed("POST");
          await scheduledMaintenance(env);
          return json({ ok: true, status: await publicStatus(env) });
        }
        if (request.method !== "GET") return methodNotAllowed("GET");
        const metrics = await ownerMetrics(env);
        return url.pathname === "/owner"
          ? renderOwnerDashboard(metrics)
          : json(metrics);
      }

      if (url.pathname === "/v1/chat/completions") {
        if (request.method !== "POST") return methodNotAllowed("POST,OPTIONS");
        await requireNetwork(request, env);
        await enforceRateLimits(request, env);
        return withCors(
          await handleChatCompletion(
            request,
            env,
            context,
            await readJson(request),
          ),
        );
      }
      return withCors(
        json({ error: { code: "not_found", message: "Not found" } }, 404),
      );
    } catch (error) {
      return withCors(errorResponse(error));
    }
  },

  async scheduled(
    _controller: ScheduledController,
    env: InferenceEnv,
    context: ExecutionContext,
  ): Promise<void> {
    context.waitUntil(scheduledMaintenance(env));
  },
} satisfies ExportedHandler<InferenceEnv>;

async function requireNetwork(
  request: Request,
  env: InferenceEnv,
): Promise<void> {
  if (!env.DGRID_PROVIDER_API_KEY)
    throw new InferenceError("network_auth_unconfigured", 503);
  if (
    !(await timingSafeSecret(networkToken(request), env.DGRID_PROVIDER_API_KEY))
  )
    throw new InferenceError("invalid_api_key", 401);
}

async function requireAdmin(
  request: Request,
  env: InferenceEnv,
): Promise<void> {
  if (!env.XGUARD_ADMIN_TOKEN)
    throw new InferenceError("owner_dashboard_unconfigured", 404);
  if (!(await timingSafeSecret(networkToken(request), env.XGUARD_ADMIN_TOKEN)))
    throw new InferenceError("invalid_admin_token", 401);
}

async function enforceRateLimits(
  request: Request,
  env: InferenceEnv,
): Promise<void> {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const [network, global] = await Promise.all([
    env.NETWORK_RATE_LIMITER.limit({ key: ip }),
    env.GLOBAL_RATE_LIMITER.limit({ key: "global" }),
  ]);
  if (!network.success || !global.success)
    throw new InferenceError("rate_limit_exceeded", 429, {
      retry_after_seconds: 30,
    });
}

function methodNotAllowed(allow: string): Response {
  return json(
    { error: { code: "method_not_allowed", message: "Method not allowed" } },
    405,
    {
      allow,
    },
  );
}

function preflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers":
        "authorization,content-type,idempotency-key,x-request-id",
      "access-control-max-age": "86400",
    },
  });
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function text(body: string, contentType: string): Response {
  return new Response(body, {
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}
