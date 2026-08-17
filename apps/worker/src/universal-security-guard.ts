const GENERIC_HTTP_PATH = "/v1/gateway/http";
const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "host.docker.internal",
  "xguardgate.com",
  "www.xguardgate.com",
  "xguard-mainnet.maqamapp.workers.dev",
]);
const BLOCKED_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home",
  ".home.arpa",
  ".onion",
];

export function universalSecurityGuardResponse(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.pathname !== GENERIC_HTTP_PATH) return null;

  const targetRaw = request.headers.get("x-xguard-upstream-url")?.trim() ?? "";
  if (strictPublicHttpsTarget(targetRaw) !== null) return null;

  return jsonResponse(
    {
      error: "unsafe_or_invalid_upstream_url",
      rule:
        "XGuard only connects to canonical public HTTPS hostnames on port 443. IP literals, local/private naming, credentials in URLs, fragments, XGuard self-targets and non-HTTPS destinations are rejected.",
    },
    400,
  );
}

export function strictPublicHttpsTarget(raw: string): URL | null {
  if (raw.length < 12 || raw.length > 4096) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (url.port !== "" && url.port !== "443") return null;
  if (url.hash !== "") return null;

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (hostname === "" || hostname.length > 253) return null;
  if (!/^[a-z0-9.-]+$/.test(hostname)) return null;
  if (!hostname.includes(".")) return null;
  if (hostname.includes("..")) return null;
  if (hostname.startsWith(".") || hostname.endsWith(".")) return null;
  if (BLOCKED_HOSTS.has(hostname)) return null;
  if (BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return null;
  if (isIpLiteral(hostname)) return null;

  for (const label of hostname.split(".")) {
    if (label.length === 0 || label.length > 63) return null;
    if (label.startsWith("-") || label.endsWith("-")) return null;
  }

  return url;
}

function isIpLiteral(hostname: string): boolean {
  const raw = hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (raw.includes(":")) return true;
  const parts = raw.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const number = Number(part);
    return number >= 0 && number <= 255;
  });
}

function jsonResponse(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
