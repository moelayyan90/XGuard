import { Hono } from "hono";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

export const XGUARD_FACILITATOR_URL = "https://api.xguardgate.com";
export const XGUARD_EDGE_VERSION = "5.0.1";

const app = new Hono();
const PUBLIC_PATHS = new Set([
  "/__xguard/health",
  "/__xguard/config",
  "/__xguard/openapi",
]);
const OPENAPI_METHODS = new Set(["get", "post", "put", "patch", "delete", "head"]);
const MAX_OPENAPI_BYTES = 1_048_576;
const OPENAPI_CACHE_TTL_MS = 300_000;
const openApiCache = new Map();

function bool(value) {
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

export function pathMatches(path, pattern) {
  if (typeof path !== "string" || typeof pattern !== "string" || !pattern.startsWith("/")) return false;
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -2);
    return path === prefix || path.startsWith(`${prefix}/`);
  }
  return path === pattern;
}

export function openApiPathMatches(path, template) {
  if (typeof path !== "string" || typeof template !== "string" || !template.startsWith("/")) return false;
  const actual = path.split("/");
  const expected = template.split("/");
  if (actual.length !== expected.length) return false;
  for (let i = 0; i < expected.length; i += 1) {
    const segment = expected[i];
    if (segment.startsWith("{") && segment.endsWith("}") && segment.length > 2) {
      if (!actual[i]) return false;
      continue;
    }
    if (actual[i] !== segment) return false;
  }
  return true;
}

export function protectedPatterns(env) {
  const raw = env?.PROTECTED_PATTERNS ?? [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function autoGateEnabled(env) {
  return bool(env?.AUTO_GATE_OPENAPI);
}

function priceFrom(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return `$${value}`;
  const text = String(value ?? "").trim();
  return text || fallback;
}

export function openApiRulesFromDocument(document, env = {}) {
  if (!document || typeof document !== "object" || !document.paths || typeof document.paths !== "object") {
    throw new Error("OpenAPI document must contain a paths object");
  }

  const defaultPrice = priceFrom(env.DEFAULT_PRICE, "$0.01");
  const rules = [];
  for (const [template, pathItem] of Object.entries(document.paths)) {
    if (!template.startsWith("/") || !pathItem || typeof pathItem !== "object") continue;
    for (const [method, operation] of Object.entries(pathItem)) {
      const lower = method.toLowerCase();
      if (!OPENAPI_METHODS.has(lower) || !operation || typeof operation !== "object") continue;
      if (operation["x-xguard-free"] === true || pathItem["x-xguard-free"] === true) continue;
      if (operation["x-xguard-paid"] === false || pathItem["x-xguard-paid"] === false) continue;

      const price = priceFrom(
        operation["x-xguard-price"] ?? pathItem["x-xguard-price"],
        defaultPrice,
      );
      const description = String(
        operation["x-xguard-description"] ||
        operation.summary ||
        operation.operationId ||
        operation.description ||
        `Paid ${method.toUpperCase()} ${template}`,
      ).slice(0, 500);

      rules.push({
        method: method.toUpperCase(),
        pattern: template,
        price,
        description,
        mimeType: "application/json",
        source: "openapi",
      });
    }
  }
  return rules;
}

function isZeroAddress(address) {
  return /^0x0{40}$/i.test(String(address || ""));
}

function assertPaymentConfig(env) {
  const payTo = String(env.PAY_TO || "");
  if (!/^0x[a-fA-F0-9]{40}$/.test(payTo) || isZeroAddress(payTo)) {
    throw new Error("PAY_TO must be a non-zero EVM receiving address");
  }
  const network = String(env.NETWORK || "eip155:8453");
  if (!network.startsWith("eip155:")) throw new Error("Edge Gate currently requires an EVM CAIP-2 network");
  return { payTo, network };
}

function facilitatorConfig(env) {
  const licenseKey = String(env.XGUARD_LICENSE_KEY || "").trim();
  return {
    url: String(env.FACILITATOR_URL || XGUARD_FACILITATOR_URL),
    createAuthHeaders: async () => ({
      supported: {},
      verify: {},
      settle: licenseKey ? { Authorization: `Bearer ${licenseKey}` } : {},
    }),
  };
}

function configuredOrigin(env) {
  const value = String(env.ORIGIN_URL || "").trim();
  if (!value) throw new Error("ORIGIN_URL is required");
  const origin = new URL(value);
  if (origin.protocol !== "https:") throw new Error("ORIGIN_URL must use HTTPS");
  if (origin.username || origin.password) throw new Error("ORIGIN_URL must not contain credentials");
  return origin;
}

function originUrlFor(requestUrl, env) {
  const origin = configuredOrigin(env);
  const incoming = new URL(requestUrl);
  return new URL(incoming.pathname + incoming.search, origin);
}

function openApiUrlFor(env) {
  const origin = configuredOrigin(env);
  const configured = String(env.OPENAPI_URL || "").trim();
  const target = configured ? new URL(configured) : new URL("/openapi.json", origin);
  if (target.protocol !== "https:") throw new Error("OPENAPI_URL must use HTTPS");
  if (target.username || target.password) throw new Error("OPENAPI_URL must not contain credentials");
  if (target.origin !== origin.origin) {
    throw new Error("OPENAPI_URL must use the same origin as ORIGIN_URL");
  }
  return target;
}

async function fetchOpenApiRules(env) {
  if (!autoGateEnabled(env)) return [];
  const target = openApiUrlFor(env);
  const cacheKey = target.toString();
  const cached = openApiCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.rules;

  const response = await fetch(target, {
    headers: { accept: "application/json" },
    redirect: "error",
  });
  if (!response.ok) throw new Error(`OpenAPI policy fetch failed with HTTP ${response.status}`);
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_OPENAPI_BYTES) throw new Error("OpenAPI policy exceeds 1 MiB limit");
  const text = await response.text();
  if (text.length > MAX_OPENAPI_BYTES) throw new Error("OpenAPI policy exceeds 1 MiB limit");

  let document;
  try {
    document = JSON.parse(text);
  } catch {
    throw new Error("OpenAPI policy is not valid JSON");
  }
  const rules = openApiRulesFromDocument(document, env);
  openApiCache.set(cacheKey, { rules, expiresAt: now + OPENAPI_CACHE_TTL_MS });
  return rules;
}

async function proxyToOrigin(request, env) {
  const target = originUrlFor(request.url, env);
  const upstream = await fetch(new Request(target, request));
  const headers = new Headers(upstream.headers);
  headers.set("x-xguard-edge-gate", "enforced");
  headers.set("x-xguard-edge-version", XGUARD_EDGE_VERSION);
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

async function findRule(request, env) {
  const path = new URL(request.url).pathname;
  const method = request.method.toUpperCase();
  const manual = protectedPatterns(env).find(rule =>
    (!rule.method || String(rule.method).toUpperCase() === method) &&
    pathMatches(path, String(rule.pattern || ""))
  );
  if (manual) return { ...manual, source: manual.source || "manual" };
  if (!autoGateEnabled(env)) return null;

  const generated = await fetchOpenApiRules(env);
  return generated.find(rule =>
    rule.method === method && openApiPathMatches(path, rule.pattern)
  ) || null;
}

async function enforcePayment(c, rule) {
  const { payTo, network } = assertPaymentConfig(c.env);
  const path = c.req.path;
  const method = c.req.method.toUpperCase();
  const facilitatorClient = new HTTPFacilitatorClient(facilitatorConfig(c.env));
  const resourceServer = new x402ResourceServer(facilitatorClient)
    .register(network, new ExactEvmScheme());

  const middleware = paymentMiddleware(
    {
      [`${method} ${path}`]: {
        accepts: [
          {
            scheme: "exact",
            price: String(rule.price || "$0.01"),
            network,
            payTo,
          },
        ],
        description: String(rule.description || "Paid access through XGuard Edge Gate"),
        mimeType: String(rule.mimeType || "application/json"),
      },
    },
    resourceServer,
  );

  let allowed = false;
  const result = await middleware(c, async () => {
    allowed = true;
  });

  if (result) return result;
  if (c.res && c.res.status >= 400) return c.res;
  if (!allowed) return c.json({ error: "payment_not_authorized" }, 402);
  return null;
}

app.get("/__xguard/health", c => c.json({
  ok: true,
  product: "XGuard Edge Gate",
  version: XGUARD_EDGE_VERSION,
  facilitator: String(c.env.FACILITATOR_URL || XGUARD_FACILITATOR_URL),
}));

app.get("/__xguard/config", c => {
  const rules = protectedPatterns(c.env);
  return c.json({
    version: XGUARD_EDGE_VERSION,
    facilitator: String(c.env.FACILITATOR_URL || XGUARD_FACILITATOR_URL),
    network: String(c.env.NETWORK || "eip155:8453"),
    originConfigured: Boolean(c.env.ORIGIN_URL),
    payToConfigured: Boolean(c.env.PAY_TO && !isZeroAddress(c.env.PAY_TO)),
    usageCreditsAuth: Boolean(c.env.XGUARD_LICENSE_KEY),
    openApiAutoGate: autoGateEnabled(c.env),
    openApiUrl: autoGateEnabled(c.env) ? String(c.env.OPENAPI_URL || "<origin>/openapi.json") : null,
    defaultPrice: autoGateEnabled(c.env) ? priceFrom(c.env.DEFAULT_PRICE, "$0.01") : null,
    protectedRoutes: rules.map(rule => ({
      method: String(rule.method || "*").toUpperCase(),
      pattern: String(rule.pattern || ""),
      price: String(rule.price || "$0.01"),
    })),
  });
});

app.get("/__xguard/openapi", async c => {
  if (!autoGateEnabled(c.env)) return c.json({ enabled: false, routes: [] });
  try {
    const rules = await fetchOpenApiRules(c.env);
    return c.json({
      enabled: true,
      routes: rules.map(rule => ({
        method: rule.method,
        pattern: rule.pattern,
        price: rule.price,
        description: rule.description,
      })),
    });
  } catch (error) {
    return c.json({
      enabled: true,
      error: error instanceof Error ? error.message : "OpenAPI policy unavailable",
    }, 503);
  }
});

app.use("*", async c => {
  const url = new URL(c.req.url);
  if (PUBLIC_PATHS.has(url.pathname)) return c.notFound();
  if (url.pathname.includes("//")) return c.json({ error: "non_canonical_path" }, 400);

  let rule;
  try {
    rule = await findRule(c.req.raw, c.env);
  } catch (error) {
    if (autoGateEnabled(c.env)) {
      return c.json({
        error: "openapi_policy_unavailable",
        message: error instanceof Error ? error.message : "OpenAPI policy unavailable",
      }, 503);
    }
    return c.json({
      error: "edge_gate_misconfigured",
      message: error instanceof Error ? error.message : "Unknown configuration error",
    }, 500);
  }

  if (!rule) return proxyToOrigin(c.req.raw, c.env);

  try {
    const paymentResponse = await enforcePayment(c, rule);
    if (paymentResponse) return paymentResponse;
    return proxyToOrigin(c.req.raw, c.env);
  } catch (error) {
    return c.json({
      error: "edge_gate_misconfigured",
      message: error instanceof Error ? error.message : "Unknown configuration error",
    }, 500);
  }
});

export default app;
