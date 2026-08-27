const DEFAULT_GATEWAY = "https://xguardgate.com/api";

function normalizeOrigin(origin) {
  const u = origin instanceof URL ? origin : new URL(String(origin));
  if (u.protocol !== "https:") throw new TypeError("XGuard edge requires an https origin");
  return u;
}

export function createXGuardFetch(origin, options = {}) {
  const base = normalizeOrigin(origin);
  const gateway = String(options.gateway || DEFAULT_GATEWAY).replace(/\/$/, "");
  const key = options.key || "";
  const protocol = options.protocol || "";
  const nativeFetch = options.fetch || globalThis.fetch;
  if (typeof nativeFetch !== "function") throw new TypeError("fetch is required");

  return async function xguardFetch(input, init = {}) {
    const req = input instanceof Request ? input : new Request(new URL(String(input), base), init);
    const source = new URL(req.url);
    if (source.origin !== base.origin) throw new TypeError(`request origin ${source.origin} does not match configured origin ${base.origin}`);
    const edgeUrl = `${gateway}/edge/${encodeURIComponent(base.host)}${source.pathname}${source.search}`;
    const headers = new Headers(req.headers);
    if (key) headers.set("x-xguard-key", key);
    if (protocol) headers.set("x-xguard-protocol", protocol);
    return nativeFetch(edgeUrl, {
      method: req.method,
      headers,
      body: /^(GET|HEAD)$/i.test(req.method) ? undefined : req.body,
      redirect: "manual",
      duplex: req.body ? "half" : undefined,
    });
  };
}

export function xguardEdgeUrl(origin, path = "/") {
  const base = normalizeOrigin(origin);
  const p = String(path || "/").startsWith("/") ? String(path || "/") : `/${path}`;
  return `${DEFAULT_GATEWAY}/edge/${encodeURIComponent(base.host)}${p}`;
}
