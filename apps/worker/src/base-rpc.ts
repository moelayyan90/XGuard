export interface BaseRpcCallOptions {
  errorPrefix?: string;
  responseLimit?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface RpcEnvelope<T> {
  result?: T | null;
  error?: unknown;
}

const DEFAULT_RESPONSE_LIMIT = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_ENDPOINTS = 4;

export function parseBaseRpcUrls(raw: string): URL[] {
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (values.length === 0 || values.length > MAX_ENDPOINTS)
    throw new Error("invalid_base_rpc_url");

  const unique = new Map<string, URL>();
  for (const value of values) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error("invalid_base_rpc_url");
    }
    if (
      url.protocol !== "https:" ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.hash.length > 0
    )
      throw new Error("invalid_base_rpc_url");
    unique.set(url.toString(), url);
  }
  if (unique.size === 0) throw new Error("invalid_base_rpc_url");
  return [...unique.values()];
}

export async function readBaseRpc<T>(
  rawUrls: string,
  method: string,
  params: unknown[],
  options: BaseRpcCallOptions = {},
): Promise<T | null> {
  const urls = parseBaseRpcUrls(rawUrls);
  const prefix = options.errorPrefix ?? "rpc";
  const responseLimit = options.responseLimit ?? DEFAULT_RESPONSE_LIMIT;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  let lastError: unknown = new Error(`${prefix}_unavailable`);

  for (let index = 0; index < urls.length; index += 1) {
    const endpoint = urls[index]!;
    try {
      return await readRpcEndpoint<T>(
        endpoint,
        method,
        params,
        prefix,
        responseLimit,
        timeoutMs,
        fetchImpl,
      );
    } catch (error) {
      lastError = error;
      if (index + 1 < urls.length) {
        console.warn(
          JSON.stringify({
            event: "base_rpc_failover",
            method,
            failedProvider: endpoint.hostname,
            failure: failureCode(error, prefix),
            nextProvider: urls[index + 1]!.hostname,
          }),
        );
      }
    }
  }

  throw lastError;
}

async function readRpcEndpoint<T>(
  endpoint: URL,
  method: string,
  params: unknown[],
  prefix: string,
  responseLimit: number,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
      redirect: "error",
    });
    if (!response.ok) throw new Error(`${prefix}_http_${response.status}`);
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > responseLimit)
      throw new Error(`${prefix}_response_too_large`);

    let envelope: RpcEnvelope<T>;
    try {
      envelope = JSON.parse(text) as RpcEnvelope<T>;
    } catch {
      throw new Error(`${prefix}_malformed_response`);
    }
    if (envelope.error !== undefined) throw new Error(`${prefix}_error`);
    if (!("result" in envelope)) throw new Error(`${prefix}_malformed_response`);
    return envelope.result ?? null;
  } finally {
    clearTimeout(timer);
  }
}

function failureCode(error: unknown, prefix: string): string {
  if (error instanceof DOMException && error.name === "AbortError")
    return `${prefix}_timeout`;
  if (error instanceof Error && error.message.startsWith(`${prefix}_`))
    return error.message;
  return `${prefix}_network_error`;
}
