const encoder = new TextEncoder();
export const MAX_RESULT_BYTES = 49152;
export const MAX_STORED_RESULT_BYTES = 90000;

export async function digestBytes(bytes) {
  const hash = await crypto.subtle.digest("SHA-256", typeof bytes === "string" ? encoder.encode(bytes) : bytes);
  return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, "0")).join("");
}

export function executionKey(request, body, method) {
  const header = request.headers.get("idempotency-key");
  const field = body.idempotency_key;
  if (header && field !== undefined && field !== header) throw new Error("idempotency_key_conflict");
  const key = field ?? header;
  if (key == null) {
    if (!["GET", "HEAD"].includes(method)) throw new Error("idempotency_key_required");
    return crypto.randomUUID();
  }
  if (typeof key !== "string" || !/^[A-Za-z0-9_:.\-]{8,128}$/.test(key)) throw new Error("invalid_idempotency_key");
  return key;
}

export async function requestDigest(target, method, headers, body) {
  const bytes = body == null ? new Uint8Array() : typeof body === "string" ? encoder.encode(body) : body;
  return digestBytes(JSON.stringify({ target, method, headers: [...headers].sort(([a], [b]) => a.localeCompare(b)), body_sha256: await digestBytes(bytes) }));
}

export async function readBoundedBody(stream, maxBytes) {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const parts = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error("response_too_large");
      }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}

export function credentialVariants(secret) {
  let binary = "";
  for (const byte of encoder.encode(secret)) binary += String.fromCharCode(byte);
  const base64 = btoa(binary);
  return [secret, encodeURIComponent(secret), base64, base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""), JSON.stringify(secret).slice(1, -1)].filter(Boolean);
}

export function responseHeaders(upstream, secret, injectionHeader) {
  const headers = new Headers();
  const secrets = credentialVariants(secret);
  const blocked = new Set(["set-cookie", "authorization", "proxy-authenticate", "proxy-authorization", "www-authenticate", "x-api-key", "x-goog-api-key", "server", "content-length", "content-encoding", "transfer-encoding", "connection", "upgrade", "trailer", "te", "keep-alive", injectionHeader]);
  let size = 0;
  for (const [name, value] of upstream) {
    if (blocked.has(name) || name.startsWith("x-xguard-") || secrets.some(secret => value.includes(secret))) continue;
    size += encoder.encode(name + value).byteLength;
    if (size > 8192) throw new Error("response_headers_too_large");
    headers.set(name, value);
  }
  headers.set("cache-control", "no-store");
  return headers;
}
