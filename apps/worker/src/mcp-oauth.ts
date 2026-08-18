const AUTHORIZATION_SERVER_PATHS = new Set([
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-authorization-server/mcp",
  "/mcp/.well-known/oauth-authorization-server",
]);
const PROTECTED_RESOURCE_PATHS = new Set([
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
  "/mcp/.well-known/oauth-protected-resource",
]);
const REGISTER_PATH = "/oauth/register";
const AUTHORIZE_PATH = "/oauth/authorize";
const TOKEN_PATH = "/oauth/token";
const MCP_SCOPE = "xguard:mcp";
const AUTHORIZATION_CODE_TTL_SECONDS = 300;
const MAX_BODY_BYTES = 32 * 1024;
const MAX_REDIRECT_URIS = 10;
const CSRF_COOKIE = "__Host-xguard_oauth_csrf";
const PKCE_VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export interface McpOAuthEnv {
  DB: D1Database;
  REQUEST_RATE_LIMITER?: RateLimit;
}

interface OAuthClientRow {
  client_id: string;
  client_name: string;
  redirect_uris_json: string;
}

interface AuthorizationCodeRow {
  code_hash: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string;
  expires_at_epoch: number;
  used_at: string | null;
}

class OAuthError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export async function mcpOAuthResponse(
  request: Request,
  env: McpOAuthEnv,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (
    request.method === "GET" &&
    AUTHORIZATION_SERVER_PATHS.has(url.pathname)
  )
    return publicJson(authorizationServerMetadata(url.origin));

  if (
    request.method === "GET" &&
    PROTECTED_RESOURCE_PATHS.has(url.pathname)
  )
    return publicJson(protectedResourceMetadata(url.origin));

  if (
    request.method === "OPTIONS" &&
    (url.pathname === REGISTER_PATH || url.pathname === TOKEN_PATH)
  )
    return cors(new Response(null, { status: 204 }));

  if (url.pathname === REGISTER_PATH)
    return handleRegistration(request, env, url.origin);

  if (url.pathname === AUTHORIZE_PATH)
    return handleAuthorization(request, env, url);

  if (url.pathname === TOKEN_PATH)
    return handleToken(request, env, url.origin);

  return null;
}

function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}${AUTHORIZE_PATH}`,
    token_endpoint: `${origin}${TOKEN_PATH}`,
    registration_endpoint: `${origin}${REGISTER_PATH}`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [MCP_SCOPE],
    service_documentation: `${origin}/docs`,
  };
}

function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ["header"],
    resource_documentation: `${origin}/docs`,
  };
}

async function handleRegistration(
  request: Request,
  env: McpOAuthEnv,
  origin: string,
): Promise<Response> {
  if (request.method !== "POST")
    return oauthJsonError("invalid_request", 405, "POST required", {
      Allow: "POST, OPTIONS",
    });

  const limited = await rateLimit(request, env, "oauth:register");
  if (limited !== null) return limited;

  try {
    const body = await readJsonObject(request);
    const redirectUris = validateRedirectUris(body.redirect_uris);
    const clientName = normalizeClientName(body.client_name);

    if (
      body.token_endpoint_auth_method !== undefined &&
      body.token_endpoint_auth_method !== "none"
    )
      throw new OAuthError(
        "invalid_client_metadata",
        400,
        "XGuard OAuth clients must be public PKCE clients",
      );

    if (body.grant_types !== undefined)
      validateStringArrayEquals(body.grant_types, ["authorization_code"]);
    if (body.response_types !== undefined)
      validateStringArrayEquals(body.response_types, ["code"]);

    const clientId = `xg_oauth_${randomToken(24)}`;
    const createdAt = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO oauth_clients(client_id,client_name,redirect_uris_json,created_at) VALUES(?,?,?,?)",
    )
      .bind(clientId, clientName, JSON.stringify(redirectUris), createdAt)
      .run();

    void cleanupOAuthState(env.DB);

    return cors(
      jsonResponse(
        {
          client_id: clientId,
          client_id_issued_at: Math.floor(Date.now() / 1000),
          client_name: clientName,
          redirect_uris: redirectUris,
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code"],
          response_types: ["code"],
          scope: MCP_SCOPE,
        },
        201,
      ),
    );
  } catch (error) {
    return oauthErrorResponse(error);
  }
}

async function handleAuthorization(
  request: Request,
  env: McpOAuthEnv,
  url: URL,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST")
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET, POST", "Cache-Control": "no-store" },
    });

  const limited = await rateLimit(request, env, "oauth:authorize");
  if (limited !== null) return limited;

  try {
    const params =
      request.method === "GET"
        ? url.searchParams
        : await readForm(request, MAX_BODY_BYTES);
    const authorization = await validateAuthorizationRequest(
      params,
      env.DB,
      url.origin,
    );

    if (request.method === "GET") {
      const csrf = randomToken(24);
      return consentPage(authorization, csrf);
    }

    assertCsrf(request, requiredParam(params, "csrf"));
    const decision = params.get("decision");
    if (decision === "deny")
      return redirectWithOAuthResult(
        authorization.redirectUri,
        authorization.state,
        { error: "access_denied" },
      );
    if (decision !== "approve")
      throw new OAuthError("invalid_request", 400, "decision is required");

    const code = randomToken(32);
    const codeHash = await sha256Hex(code);
    const nowEpoch = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO oauth_authorization_codes(
         code_hash,client_id,redirect_uri,code_challenge,scope,expires_at_epoch,created_at,used_at
       ) VALUES(?,?,?,?,?,?,?,NULL)`,
    )
      .bind(
        codeHash,
        authorization.clientId,
        authorization.redirectUri,
        authorization.codeChallenge,
        authorization.scope,
        nowEpoch + AUTHORIZATION_CODE_TTL_SECONDS,
        new Date().toISOString(),
      )
      .run();

    return redirectWithOAuthResult(
      authorization.redirectUri,
      authorization.state,
      { code },
    );
  } catch (error) {
    return authorizationErrorResponse(error);
  }
}

async function handleToken(
  request: Request,
  env: McpOAuthEnv,
  origin: string,
): Promise<Response> {
  if (request.method !== "POST")
    return oauthJsonError("invalid_request", 405, "POST required", {
      Allow: "POST, OPTIONS",
    });

  const limited = await rateLimit(request, env, "oauth:token");
  if (limited !== null) return limited;

  try {
    const params = await readForm(request, MAX_BODY_BYTES);
    if (requiredParam(params, "grant_type") !== "authorization_code")
      throw new OAuthError("unsupported_grant_type", 400);

    const code = requiredParam(params, "code");
    if (code.length > 256)
      throw new OAuthError("invalid_grant", 400, "authorization code invalid");
    const clientId = requiredParam(params, "client_id");
    const redirectUri = requiredParam(params, "redirect_uri");
    const verifier = requiredParam(params, "code_verifier");
    if (!PKCE_VERIFIER.test(verifier))
      throw new OAuthError("invalid_grant", 400, "PKCE verifier invalid");

    const codeHash = await sha256Hex(code);
    const row = await env.DB.prepare(
      `SELECT code_hash,client_id,redirect_uri,code_challenge,scope,expires_at_epoch,used_at
         FROM oauth_authorization_codes WHERE code_hash=?`,
    )
      .bind(codeHash)
      .first<AuthorizationCodeRow>();

    const nowEpoch = Math.floor(Date.now() / 1000);
    if (
      row === null ||
      row.used_at !== null ||
      row.expires_at_epoch <= nowEpoch ||
      row.client_id !== clientId ||
      row.redirect_uri !== redirectUri
    )
      throw new OAuthError("invalid_grant", 400, "authorization code invalid");

    const expectedChallenge = await pkceChallenge(verifier);
    if (!constantTimeEqual(expectedChallenge, row.code_challenge))
      throw new OAuthError("invalid_grant", 400, "PKCE verification failed");

    const consumed = await env.DB.prepare(
      `UPDATE oauth_authorization_codes
          SET used_at=?
        WHERE code_hash=? AND used_at IS NULL AND expires_at_epoch>?`,
    )
      .bind(new Date().toISOString(), codeHash, nowEpoch)
      .run();
    if ((consumed.meta.changes ?? 0) !== 1)
      throw new OAuthError("invalid_grant", 400, "authorization code already used");

    const client = await env.DB.prepare(
      "SELECT client_id,client_name,redirect_uris_json FROM oauth_clients WHERE client_id=?",
    )
      .bind(clientId)
      .first<OAuthClientRow>();
    if (client === null)
      throw new OAuthError("invalid_client", 401, "client not found");

    const buyerPass = await createOAuthBuyerPass(env.DB, client.client_name);
    void cleanupOAuthState(env.DB);

    return cors(
      jsonResponse(
        {
          access_token: buyerPass.token,
          token_type: "Bearer",
          scope: row.scope,
          resource: `${origin}/mcp`,
        },
        200,
        { "Cache-Control": "no-store", Pragma: "no-cache" },
      ),
    );
  } catch (error) {
    return oauthErrorResponse(error);
  }
}

async function validateAuthorizationRequest(
  params: URLSearchParams,
  db: D1Database,
  origin: string,
): Promise<{
  clientId: string;
  clientName: string;
  redirectUri: string;
  state: string | null;
  scope: string;
  codeChallenge: string;
  resource: string;
}> {
  if (requiredParam(params, "response_type") !== "code")
    throw new OAuthError("unsupported_response_type", 400);

  const clientId = requiredParam(params, "client_id");
  const client = await db
    .prepare(
      "SELECT client_id,client_name,redirect_uris_json FROM oauth_clients WHERE client_id=?",
    )
    .bind(clientId)
    .first<OAuthClientRow>();
  if (client === null)
    throw new OAuthError("invalid_request", 400, "unknown client_id");

  const redirectUri = requiredParam(params, "redirect_uri");
  const registeredRedirects = parseRegisteredRedirects(client.redirect_uris_json);
  if (!registeredRedirects.includes(redirectUri))
    throw new OAuthError("invalid_request", 400, "redirect_uri is not registered");

  const method = requiredParam(params, "code_challenge_method");
  if (method !== "S256")
    throw new OAuthError(
      "invalid_request",
      400,
      "code_challenge_method must be S256",
    );
  const codeChallenge = requiredParam(params, "code_challenge");
  if (!PKCE_CHALLENGE.test(codeChallenge))
    throw new OAuthError("invalid_request", 400, "code_challenge invalid");

  const scope = normalizeScope(params.get("scope"));
  const resource = params.get("resource") ?? `${origin}/mcp`;
  if (resource !== `${origin}/mcp`)
    throw new OAuthError("invalid_target", 400, "resource must be the XGuard MCP endpoint");

  const state = params.get("state");
  if (state !== null && state.length > 2048)
    throw new OAuthError("invalid_request", 400, "state too long");

  return {
    clientId,
    clientName: client.client_name,
    redirectUri,
    state,
    scope,
    codeChallenge,
    resource,
  };
}

function consentPage(
  authorization: {
    clientId: string;
    clientName: string;
    redirectUri: string;
    state: string | null;
    scope: string;
    codeChallenge: string;
    resource: string;
  },
  csrf: string,
): Response {
  const fields = [
    ["response_type", "code"],
    ["client_id", authorization.clientId],
    ["redirect_uri", authorization.redirectUri],
    ["scope", authorization.scope],
    ["code_challenge", authorization.codeChallenge],
    ["code_challenge_method", "S256"],
    ["resource", authorization.resource],
    ["state", authorization.state ?? ""],
    ["csrf", csrf],
  ]
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name ?? "")}" value="${escapeHtml(value ?? "")}">`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect XGuard</title>
<style>
:root{color-scheme:light dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d10;color:#f5f7fa}.card{width:min(440px,calc(100vw - 40px));padding:30px;border:1px solid #2a3038;border-radius:18px;background:#11151a;box-shadow:0 24px 80px #0008}.mark{font-weight:800;letter-spacing:.08em;font-size:13px;color:#7ee787}h1{font-size:26px;margin:14px 0 10px}p{line-height:1.6;color:#b8c0cc}.client{padding:14px 16px;border-radius:12px;background:#171c22;border:1px solid #272e37;margin:18px 0}.client b{display:block;color:#fff}.client small{display:block;color:#8d98a7;margin-top:5px;overflow-wrap:anywhere}.actions{display:flex;gap:10px;margin-top:24px}button{flex:1;border:0;border-radius:11px;padding:12px 16px;font:inherit;font-weight:700;cursor:pointer}.approve{background:#7ee787;color:#0b0d10}.deny{background:#252b33;color:#f5f7fa}.note{font-size:12px;color:#7f8997;margin-top:18px}</style>
</head>
<body><main class="card"><div class="mark">XGUARD</div><h1>Connect XGuard</h1><p><strong>${escapeHtml(authorization.clientName)}</strong> wants permission to use XGuard through MCP.</p><div class="client"><b>Permission</b><small>Use XGuard MCP tools. Read-only discovery stays public; protected XGuard services use the issued Buyer Pass.</small></div><p>No payment is executed by connecting. A new Buyer Pass starts with a zero service balance.</p><form method="post" action="${AUTHORIZE_PATH}">${fields}<div class="actions"><button class="deny" type="submit" name="decision" value="deny">Cancel</button><button class="approve" type="submit" name="decision" value="approve">Connect</button></div></form><div class="note">Authorization Code + PKCE (S256). XGuard never sends the Buyer Pass through the browser redirect.</div></main></body></html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Set-Cookie": `${CSRF_COOKIE}=${csrf}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600`,
    },
  });
}

function assertCsrf(request: Request, submitted: string): void {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CSRF_COOKIE}=`))
    ?.slice(CSRF_COOKIE.length + 1);
  if (
    cookie === undefined ||
    submitted.length < 20 ||
    !constantTimeEqual(cookie, submitted)
  )
    throw new OAuthError("invalid_request", 400, "authorization session expired");
}

function redirectWithOAuthResult(
  redirectUri: string,
  state: string | null,
  result: { code?: string; error?: string },
): Response {
  const location = new URL(redirectUri);
  if (result.code !== undefined) location.searchParams.set("code", result.code);
  if (result.error !== undefined) location.searchParams.set("error", result.error);
  if (state !== null && state !== "") location.searchParams.set("state", state);
  return new Response(null, {
    status: 303,
    headers: {
      Location: location.toString(),
      "Cache-Control": "no-store",
      "Set-Cookie": `${CSRF_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`,
    },
  });
}

async function createOAuthBuyerPass(
  db: D1Database,
  clientName: string,
): Promise<{ token: string; passId: string; principalId: string }> {
  const passId = `bp_${randomHex(16)}`;
  const principalId = crypto.randomUUID();
  const token = `xg_pass_${randomToken(32)}`;
  const tokenHash = await sha256Hex(token);
  const internalApiKeyHash = await sha256Hex(`internal:${randomToken(48)}`);
  const createdAt = new Date().toISOString();
  const label = `OAuth ${clientName}`.slice(0, 60);

  await db.batch([
    db
      .prepare(
        "INSERT INTO merchants(merchant_id,name,api_key_hash,created_at) VALUES(?,?,?,?)",
      )
      .bind(principalId, `Buyer ${label}`, internalApiKeyHash, createdAt),
    db
      .prepare(
        "INSERT INTO buyer_passes(pass_id,merchant_id,token_hash,label,channel,active,created_at,last_used_at) VALUES(?,?,?,?,?,1,?,?)",
      )
      .bind(passId, principalId, tokenHash, label, "agent", createdAt, createdAt),
  ]);

  return { token, passId, principalId };
}

async function rateLimit(
  request: Request,
  env: McpOAuthEnv,
  route: string,
): Promise<Response | null> {
  if (env.REQUEST_RATE_LIMITER === undefined) return null;
  const client = (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    "unknown"
  )
    .trim()
    .slice(0, 128);
  try {
    const decision = await env.REQUEST_RATE_LIMITER.limit({
      key: `${route}:${client}`,
    });
    if (decision.success) return null;
    return oauthJsonError("slow_down", 429, "rate limit exceeded", {
      "Retry-After": "60",
    });
  } catch {
    return oauthJsonError(
      "temporarily_unavailable",
      503,
      "OAuth protection unavailable",
    );
  }
}

async function cleanupOAuthState(db: D1Database): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      "DELETE FROM oauth_authorization_codes WHERE expires_at_epoch < ? OR (used_at IS NOT NULL AND expires_at_epoch < ?)",
    )
    .bind(now - 3600, now)
    .run()
    .catch(() => undefined);
}

function validateRedirectUris(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_REDIRECT_URIS)
    throw new OAuthError("invalid_redirect_uri", 400, "redirect_uris required");
  const unique = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048)
      throw new OAuthError("invalid_redirect_uri", 400);
    let uri: URL;
    try {
      uri = new URL(raw);
    } catch {
      throw new OAuthError("invalid_redirect_uri", 400);
    }
    if (
      uri.protocol !== "https:" ||
      uri.username !== "" ||
      uri.password !== "" ||
      uri.hash !== ""
    )
      throw new OAuthError(
        "invalid_redirect_uri",
        400,
        "redirect URIs must be HTTPS and must not contain credentials or fragments",
      );
    unique.add(uri.toString());
  }
  return [...unique];
}

function normalizeClientName(value: unknown): string {
  if (value === undefined || value === null || value === "") return "MCP Client";
  if (typeof value !== "string")
    throw new OAuthError("invalid_client_metadata", 400, "client_name invalid");
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < 2 || normalized.length > 80)
    throw new OAuthError("invalid_client_metadata", 400, "client_name invalid");
  return normalized;
}

function validateStringArrayEquals(value: unknown, expected: string[]): void {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
    throw new OAuthError("invalid_client_metadata", 400);
  const actual = [...new Set(value as string[])].sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((entry, index) => entry !== wanted[index])
  )
    throw new OAuthError("invalid_client_metadata", 400);
}

function parseRegisteredRedirects(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string"))
      return [];
    return parsed as string[];
  } catch {
    return [];
  }
}

function normalizeScope(value: string | null): string {
  if (value === null || value.trim() === "") return MCP_SCOPE;
  const scopes = [...new Set(value.trim().split(/\s+/))];
  if (scopes.length !== 1 || scopes[0] !== MCP_SCOPE)
    throw new OAuthError("invalid_scope", 400, `supported scope: ${MCP_SCOPE}`);
  return MCP_SCOPE;
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const text = await readBodyCapped(request, MAX_BODY_BYTES);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new OAuthError("invalid_request", 400, "invalid JSON");
  }
  if (!isRecord(parsed))
    throw new OAuthError("invalid_request", 400, "JSON object required");
  return parsed;
}

async function readForm(
  request: Request,
  maxBytes: number,
): Promise<URLSearchParams> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded")
    throw new OAuthError(
      "invalid_request",
      415,
      "application/x-www-form-urlencoded required",
    );
  return new URLSearchParams(await readBodyCapped(request, maxBytes));
}

async function readBodyCapped(request: Request, maxBytes: number): Promise<string> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes)
    throw new OAuthError("invalid_request", 413, "request too large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes)
    throw new OAuthError("invalid_request", 413, "request too large");
  return text;
}

function requiredParam(params: URLSearchParams, name: string): string {
  const value = params.get(name);
  if (value === null || value === "")
    throw new OAuthError("invalid_request", 400, `${name} is required`);
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

function randomHex(bytes: number): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
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
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1)
    mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function authorizationErrorResponse(error: unknown): Response {
  const normalized = normalizeOAuthError(error);
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>XGuard authorization error</title><body style="font-family:system-ui;padding:40px;max-width:720px;margin:auto"><h1>Authorization could not continue</h1><p>${escapeHtml(normalized.message)}</p></body>`,
    {
      status: normalized.status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}

function oauthErrorResponse(error: unknown): Response {
  const normalized = normalizeOAuthError(error);
  return oauthJsonError(
    normalized.code,
    normalized.status,
    normalized.message,
  );
}

function normalizeOAuthError(error: unknown): OAuthError {
  if (error instanceof OAuthError) return error;
  console.error(
    JSON.stringify({
      event: "mcp_oauth_error",
      code: error instanceof Error ? error.message.slice(0, 96) : "unknown_error",
    }),
  );
  return new OAuthError(
    "server_error",
    500,
    "XGuard OAuth could not complete this request",
  );
}

function oauthJsonError(
  error: string,
  status: number,
  description: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return cors(
    jsonResponse(
      { error, error_description: description },
      status,
      { "Cache-Control": "no-store", ...extraHeaders },
    ),
  );
}

function publicJson(value: unknown): Response {
  return cors(
    jsonResponse(value, 200, {
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    }),
  );
}

function jsonResponse(
  value: unknown,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function cors(response: Response): Response {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
