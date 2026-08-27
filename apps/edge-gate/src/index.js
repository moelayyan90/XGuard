import { Hono } from "hono";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

export const XGUARD_FACILITATOR_URL = "https://api.xguardgate.com";
export const XGUARD_EDGE_VERSION = "5.0.1";

const app = new Hono();
const PUBLIC_PATHS = new Set(["/__xguard/health", "/__xguard/config"]);

export function pathMatches(path, pattern) {
  if (typeof path !== "string" || typeof pattern !== "string" || !pattern.startsWith("/")) return false;
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -2);
    return path === prefix || path.startsWith(`${prefix}/`);
  }
  return path === pattern;
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

function originUrlFor(requestUrl, env) {
  const configured = String(env.ORIGIN_URL || "").trim();
  if (!configured) throw new Error("ORIGIN_URL is required");
  const origin = new URL(configured);
  if (origin.protocol !== "https:") throw new Error("ORIGIN_URL must use HTTPS");
  if (origin.username || origin.password) throw new Error("ORIGIN_URL must not contain credentials");
  const incoming = new URL(requestUrl);
  const target = new URL(incoming.pathname + incoming.search, origin);
  return target;
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

function findRule(request, env) {
  const path = new URL(request.url).pathname;
  return protectedPatterns(env).find(rule =>
    (!rule.method || String(rule.method).toUpperCase() === request.method.toUpperCase()) &&
    pathMatches(path, String(rule.pattern || ""))
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
    protectedRoutes: rules.map(rule => ({
      method: String(rule.method || "*").toUpperCase(),
      pattern: String(rule.pattern || ""),
      price: String(rule.price || "$0.01"),
    })),
  });
});

app.use("*", async c => {
  const url = new URL(c.req.url);
  if (PUBLIC_PATHS.has(url.pathname)) return c.notFound();
  if (url.pathname.includes("//")) return c.json({ error: "non_canonical_path" }, 400);

  const rule = findRule(c.req.raw, c.env);
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
