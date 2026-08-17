const CONNECTOR_PATH = "/v1/gateway/http";
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

export function universalSecurityGuardResponse(
  request: Request,
): Response | null {
  if (new URL(request.url).pathname !== CONNECTOR_PATH) return null;
  const target = request.headers.get("x-xguard-upstream-url")?.trim() ?? "";
  if (strictPublicHttpsTarget(target) !== null) return null;
  return new Response(
    JSON.stringify({
      error: "unsafe_or_invalid_upstream_url",
      rule: "Use a canonical public HTTPS hostname on port 443. XGuard blocks IP literals, local/private names, credentials in URLs, fragments and XGuard self-targets.",
    }),
    {
      status: 400,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    },
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
  if (url.username || url.password || url.hash) return null;
  if (url.port && url.port !== "443") return null;

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host.length > 253 || !host.includes(".")) return null;
  if (!/^[a-z0-9.-]+$/.test(host) || host.includes("..")) return null;
  if (BLOCKED_HOSTS.has(host)) return null;
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return null;
  if (isIpLiteral(host)) return null;
  for (const label of host.split(".")) {
    if (
      !label ||
      label.length > 63 ||
      label.startsWith("-") ||
      label.endsWith("-")
    )
      return null;
  }
  return url;
}

function isIpLiteral(host: string): boolean {
  const raw = host.replace(/^\[/, "").replace(/\]$/, "");
  if (raw.includes(":")) return true;
  const parts = raw.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const value = Number(part);
    return value >= 0 && value <= 255;
  });
}
