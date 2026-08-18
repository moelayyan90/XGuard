import { buyerPassResponse, type BuyerPassEnv } from "./buyer-pass.js";

const RESOURCE_PATH = "/mcp";
const PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";
const PROTECTED_RESOURCE_MCP_PATH =
  "/.well-known/oauth-protected-resource/mcp";
const AUTH_SERVER_METADATA_PATH = "/.well-known/oauth-authorization-server";
const REGISTER_PATH = "/oauth/register";
const AUTHORIZE_PATH = "/oauth/authorize";
const TOKEN_PATH = "/oauth/token";
const MCP_SCOPE = "xguard:payment";
const CODE_TTL_SECONDS = 5 * 60;
const MAX_BODY_BYTES = 32 * 1024;
const MAX_REDIRECT_URIS = 5;
const CLIENT_ID = /^xg_mcp_[A-Za-z0-9_-]{32}$/;
const CODE = /^xg_code_[A-Za-z0-9_-]{43}$/;
const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

export type McpOAuthEnv = BuyerPassEnv;

interface OAuthClientRow {
  client_id: string;
  client_name: string;
  redirect_uris_json: string;
}

interface OAuthCodeRow {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string;
  expires_at_epoch: number;
  used_at: string | null;
}

interface AuthorizationRequest {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  state: string | null;
}

class OAuthRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
  }
}

export async function mcpOAuthResponse(
  request: Request,
  env: McpOAuthEnv,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (
    request.method === "GET" &&
    (url.pathname === PROTECTED_RESOURCE_PATH ||
      url.pathname === PROTECTED_RESOURCE_MCP_PATH)
  ) {
    return publicJson(protectedResourceMetadata(url.origin));
  }

  if (
    request.method === "GET" &&
    url.pathname === AUTH_SERVER_METADATA_PATH
  ) {
    return publicJson(authorizationServerMetadata(url.origin));
  }

  if (
    request.method === "OPTIONS" &&
    (url.pathname === REGISTER_PATH || url.pathname === TOKEN_PATH)
  ) {
    return oauthCors(new Response(null, { status: 204 }));
  }

  if (url.pathname === REGISTER_PATH && request.method === "POST") {
    try {
      const blocked = await oauthAbuseProtection(request, env, "register");
      if (blocked !== null) return blocked;
      return await registerClient(request, env.DB);
    } catch (error) {
      return oauthError(error);
    }
  }

  if (url.pathname === AUTHORIZE_PATH && request.method === "GET") {
    try {
      const parsed = authorizationRequest(url.searchParams);
      await requireRegisteredRedirect(env.DB, parsed.clientId, parsed.redirectUri);
      return consentPage(parsed);
    } catch (error) {
      return oauthError(error);
    }
  }

  if (url.pathname === AUTHORIZE_PATH && request.method === "POST") {
    try {
      const blocked = await oauthAbuseProtection(request, env, "authorize");
      if (blocked !== null) return blocked;
      const form = await readForm(request);
      const parsed = authorizationRequest(form);
      await requireRegisteredRedirect(env.DB, parsed.clientId, parsed.redirectUri);
      if (form.get("decision") !== "approve")
        return authorizationRedirect(parsed, { error: "access_denied" });
      return await issueAuthorizationCode(env.DB, parsed);
    } catch (error) {
      return oauthError(error);
    }
  }

  if (url.pathname === TOKEN_PATH && request.method === "POST") {
    try {
      const blocked = await oauthAbuseProtection(request, env, "token");
      if (blocked !== null) return blocked;
      return await exchangeAuthorizationCode(request, env);
    } catch (error) {
      return oauthError(error);
    }
  }

  return null;
}

export function mcpProtectedResourceChallenge(origin: string): string {
  return `Bearer resource_metadata="${origin}${PROTECTED_RESOURCE_PATH}", scope="${MCP_SCOPE}"`;
}

function protectedResourceMetadata(origin: string): Record<string, unknown> {
  return {
    resource: `${origin}${RESOURCE_PATH}`,
    authorization_servers: [origin],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "XGuard MCP",
    resource_documentation: `${origin}/docs`,
  };
}

function authorizationServerMetadata(origin: string): Record<string, unknown> {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}${AUTHORIZE_PATH}`,
    token_endpoint: `${origin}${TOKEN_PATH}`,
    registration_endpoint: `${origin}${REGISTER_PATH}`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [MCP_SCOPE],
  };
}

async function registerClient(
  request: Request,
  db: D1Database,
): Promise<Response> {
  const body = await readJsonObject(request);
  const redirectUris = parseRedirectUris(body.redirect_uris);
  const clientName = cleanClientName(body.client_name);
  const clientId = `xg_mcp_${randomToken(24)}`;
  const createdAt = new Date().toISOString();

  await db
    .prepare(
      "INSERT INTO mcp_oauth_clients(client_id,client_name,redirect_uris_json,created_at) VALUES(?,?,?,?)",
    )
    .bind(clientId, clientName, JSON.stringify(redirectUris), createdAt)
    .run();

  return privateJson(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1_000),
      client_name: clientName,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    },
    201,
  );
}

function authorizationRequest(params: URLSearchParams): AuthorizationRequest {
  if (params.get("response_type") !== "code")
    throw new OAuthRequestError("unsupported_response_type");

  const clientId = requiredParam(params, "client_id", 96);
  if (!CLIENT_ID.test(clientId)) throw new OAuthRequestError("invalid_client");

  const redirectUri = requiredParam(params, "redirect_uri", 1024);
  validateRedirectUri(redirectUri);

  const codeChallenge = requiredParam(params, "code_challenge", 128);
  if (!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge))
    throw new OAuthRequestError("invalid_request");
  if (params.get("code_challenge_method") !== "S256")
    throw new OAuthRequestError("invalid_request");

  const resource = params.get("resource");
  if (resource !== null) {
    let parsedResource: URL;
    try {
      parsedResource = new URL(resource);
    } catch {
      throw new OAuthRequestError("invalid_target");
    }
    if (parsedResource.pathname !== RESOURCE_PATH)
      throw new OAuthRequestError("invalid_target");
  }

  const requestedScope = (params.get("scope") ?? MCP_SCOPE).trim();
  const scopes = new Set(requestedScope.split(/\s+/).filter(Boolean));
  if (scopes.size !== 1 || !scopes.has(MCP_SCOPE))
    throw new OAuthRequestError("invalid_scope");

  const state = params.get("state");
  if (state !== null && state.length > 512)
    throw new OAuthRequestError("invalid_request");

  return {
    clientId,
    redirectUri,
    codeChallenge,
    scope: MCP_SCOPE,
    state,
  };
}

async function requireRegisteredRedirect(
  db: D1Database,
  clientId: string,
  redirectUri: string,
): Promise<OAuthClientRow> {
  const row = await db
    .prepare(
      "SELECT client_id,client_name,redirect_uris_json FROM mcp_oauth_clients WHERE client_id=?",
    )
    .bind(clientId)
    .first<OAuthClientRow>();
  if (row === null) throw new OAuthRequestError("invalid_client", 401);

  let redirectUris: unknown;
  try {
    redirectUris = JSON.parse(row.redirect_uris_json);
  } catch {
    throw new OAuthRequestError("server_error", 500);
  }
  if (
    !Array.isArray(redirectUris) ||
    !redirectUris.some((value) => value === redirectUri)
  )
    throw new OAuthRequestError("invalid_request");
  return row;
}

function consentPage(input: AuthorizationRequest): Response {
  const hidden = [
    ["response_type", "code"],
    ["client_id", input.clientId],
    ["redirect_uri", input.redirectUri],
    ["code_challenge", input.codeChallenge],
    ["code_challenge_method", "S256"],
    ["scope", input.scope],
    ["resource", `${new URL(input.redirectUri).origin === "null" ? "" : ""}`],
    ...(input.state === null ? [] : [["state", input.state]]),
  ]
    .filter(([name]) => name !== "resource")
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize XGuard MCP</title><style>
body{font-family:system-ui,-apple-system,sans-serif;background:#f7f7f5;color:#161616;margin:0;display:grid;place-items:center;min-height:100vh}.card{width:min(480px,calc(100% - 40px));background:#fff;border:1px solid #deded9;border-radius:16px;padding:28px;box-shadow:0 12px 36px rgba(0,0,0,.06)}h1{font-size:22px;margin:0 0 12px}p{line-height:1.55;color:#555}.scope{font-family:ui-monospace,monospace;background:#f2f2ef;border-radius:8px;padding:10px;margin:18px 0}.actions{display:flex;gap:10px}button{font:inherit;border-radius:9px;padding:10px 16px;border:1px solid #ccc;background:#fff;cursor:pointer}button.primary{background:#111;color:#fff;border-color:#111}</style></head>
<body><main class="card"><h1>Connect this MCP client to XGuard</h1><p>The client will receive an XGuard bearer credential for payment-decision calls. Creating the credential does not move money or charge a fee.</p><div class="scope">${escapeHtml(input.scope)}</div><form method="post" action="${AUTHORIZE_PATH}">${hidden}<div class="actions"><button class="primary" type="submit" name="decision" value="approve">Authorize</button><button type="submit" name="decision" value="deny">Deny</button></div></form></main></body></html>`;

  return secureResponse(
    new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      },
    }),
  );
}

async function issueAuthorizationCode(
  db: D1Database,
  input: AuthorizationRequest,
): Promise<Response> {
  const code = `xg_code_${randomToken(32)}`;
  const codeHash = await sha256Hex(code);
  const now = new Date().toISOString();
  const expiresAtEpoch = Math.floor(Date.now() / 1_000) + CODE_TTL_SECONDS;

  await db
    .prepare(
      "INSERT INTO mcp_oauth_codes(code_hash,client_id,redirect_uri,code_challenge,scope,expires_at_epoch,used_at,created_at) VALUES(?,?,?,?,?,?,NULL,?)",
    )
    .bind(
      codeHash,
      input.clientId,
      input.redirectUri,
      input.codeChallenge,
      input.scope,
      expiresAtEpoch,
      now,
    )
    .run();

  db.prepare("DELETE FROM mcp_oauth_codes WHERE expires_at_epoch<?")
    .bind(Math.floor(Date.now() / 1_000) - CODE_TTL_SECONDS)
    .run()
    .catch(() => undefined);

  return authorizationRedirect(input, { code });
}

function authorizationRedirect(
  input: AuthorizationRequest,
  result: { code?: string; error?: string },
): Response {
  const location = new URL(input.redirectUri);
  if (result.code !== undefined) location.searchParams.set("code", result.code);
  if (result.error !== undefined)
    location.searchParams.set("error", result.error);
  if (input.state !== null) location.searchParams.set("state", input.state);
  return secureResponse(
    new Response(null, {
      status: 303,
      headers: { Location: location.toString(), "Cache-Control": "no-store" },
    }),
  );
}

async function exchangeAuthorizationCode(
  request: Request,
  env: McpOAuthEnv,
): Promise<Response> {
  const form = await readForm(request);
  if (form.get("grant_type") !== "authorization_code")
    throw new OAuthRequestError("unsupported_grant_type");

  const code = requiredParam(form, "code", 96);
  if (!CODE.test(code)) throw new OAuthRequestError("invalid_grant");
  const clientId = requiredParam(form, "client_id", 96);
  if (!CLIENT_ID.test(clientId)) throw new OAuthRequestError("invalid_client");
  const redirectUri = requiredParam(form, "redirect_uri", 1024);
  validateRedirectUri(redirectUri);
  const verifier = requiredParam(form, "code_verifier", 128);
  if (!PKCE_VERIFIER.test(verifier))
    throw new OAuthRequestError("invalid_grant");

  const codeHash = await sha256Hex(code);
  const row = await env.DB.prepare(
    "SELECT client_id,redirect_uri,code_challenge,scope,expires_at_epoch,used_at FROM mcp_oauth_codes WHERE code_hash=?",
  )
    .bind(codeHash)
    .first<OAuthCodeRow>();
  const nowEpoch = Math.floor(Date.now() / 1_000);
  if (
    row === null ||
    row.used_at !== null ||
    row.expires_at_epoch < nowEpoch ||
    row.client_id !== clientId ||
    row.redirect_uri !== redirectUri
  )
    throw new OAuthRequestError("invalid_grant");

  const challenge = await pkceChallenge(verifier);
  if (!constantTimeEqual(challenge, row.code_challenge))
    throw new OAuthRequestError("invalid_grant");

  const usedAt = new Date().toISOString();
  const consumed = await env.DB.prepare(
    "UPDATE mcp_oauth_codes SET used_at=? WHERE code_hash=? AND used_at IS NULL AND expires_at_epoch>=?",
  )
    .bind(usedAt, codeHash, nowEpoch)
    .run();
  if ((consumed.meta.changes ?? 0) !== 1)
    throw new OAuthRequestError("invalid_grant");

  const headers = new Headers({ "Content-Type": "application/json" });
  const clientIp = request.headers.get("cf-connecting-ip");
  if (clientIp !== null) headers.set("cf-connecting-ip", clientIp);
  const passRequest = new Request(`${new URL(request.url).origin}/v1/buyer-pass`, {
    method: "POST",
    headers,
    body: JSON.stringify({ channel: "agent", label: "MCP OAuth" }),
  });
  const passResponse = await buyerPassResponse(passRequest, env);
  if (passResponse === null || passResponse.status !== 201)
    throw new OAuthRequestError("temporarily_unavailable", 503);
  const pass = (await passResponse.json()) as Record<string, unknown>;
  if (typeof pass.buyerPass !== "string")
    throw new OAuthRequestError("server_error", 500);

  return privateJson({
    access_token: pass.buyerPass,
    token_type: "Bearer",
    scope: row.scope,
  });
}

async function oauthAbuseProtection(
  request: Request,
  env: McpOAuthEnv,
  operation: string,
): Promise<Response | null> {
  const client = (request.headers.get("cf-connecting-ip") ?? "unknown")
    .trim()
    .slice(0, 128);
  try {
    const [local, global] = await Promise.all([
      env.REQUEST_RATE_LIMITER.limit({ key: `oauth:${operation}:${client}` }),
      env.GLOBAL_RATE_LIMITER.limit({ key: `oauth:${operation}:global` }),
    ]);
    if (local.success && global.success) return null;
    return privateJson(
      { error: "temporarily_unavailable", error_description: "rate_limited" },
      429,
      { "Retry-After": "60" },
    );
  } catch {
    return privateJson({ error: "temporarily_unavailable" }, 503);
  }
}

function parseRedirectUris(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_REDIRECT_URIS)
    throw new OAuthRequestError("invalid_redirect_uris");
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string")
      throw new OAuthRequestError("invalid_redirect_uris");
    validateRedirectUri(item);
    if (!result.includes(item)) result.push(item);
  }
  if (result.length === 0) throw new OAuthRequestError("invalid_redirect_uris");
  return result;
}

function validateRedirectUri(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OAuthRequestError("invalid_redirect_uri");
  }
  if (url.username || url.password || url.hash)
    throw new OAuthRequestError("invalid_redirect_uri");
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:"))
    throw new OAuthRequestError("invalid_redirect_uri");
}

function cleanClientName(value: unknown): string {
  if (value === undefined || value === null) return "MCP client";
  if (typeof value !== "string") throw new OAuthRequestError("invalid_client_metadata");
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 80)
    throw new OAuthRequestError("invalid_client_metadata");
  return name;
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json"))
    throw new OAuthRequestError("invalid_client_metadata");
  const text = await readBody(request);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new OAuthRequestError("invalid_client_metadata");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new OAuthRequestError("invalid_client_metadata");
  return parsed as Record<string, unknown>;
}

async function readForm(request: Request): Promise<URLSearchParams> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/x-www-form-urlencoded"))
    throw new OAuthRequestError("invalid_request");
  return new URLSearchParams(await readBody(request));
}

async function readBody(request: Request): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES)
    throw new OAuthRequestError("invalid_request", 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES)
    throw new OAuthRequestError("invalid_request", 413);
  return text;
}

function requiredParam(
  params: URLSearchParams,
  name: string,
  maxLength: number,
): string {
  const value = params.get(name)?.trim() ?? "";
  if (value.length === 0 || value.length > maxLength)
    throw new OAuthRequestError("invalid_request");
  return value;
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64Url(new Uint8Array(digest));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function randomToken(bytes: number): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64Url(value);
}

function base64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function constantTimeEqual(left: string, right: string): boolean {
  const size = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < size; index += 1)
    difference |=
      (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  return difference === 0;
}

function oauthError(error: unknown): Response {
  const normalized =
    error instanceof OAuthRequestError
      ? error
      : new OAuthRequestError("server_error", 500);
  return privateJson(
    {
      error: normalized.code,
      ...(normalized.status >= 500
        ? { error_description: "XGuard OAuth service is temporarily unavailable" }
        : {}),
    },
    normalized.status,
  );
}

function publicJson(value: unknown): Response {
  return secureResponse(
    new Response(JSON.stringify(value), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=300",
        "Access-Control-Allow-Origin": "*",
      },
    }),
  );
}

function privateJson(
  value: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return oauthCors(
    secureResponse(
      new Response(JSON.stringify(value), {
        status,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          Pragma: "no-cache",
          ...extraHeaders,
        },
      }),
    ),
  );
}

function oauthCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function secureResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
