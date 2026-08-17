from pathlib import Path

path = Path("apps/worker/src/buyer-pass.ts")
text = path.read_text()

old_env = '''export interface BuyerPassEnv {
  DB: D1Database;
  BASE_RPC_URL: string;
  XGUARD_TREASURY_USDC_ADDRESS: string;
}
'''
new_env = '''export interface BuyerPassEnv {
  DB: D1Database;
  BASE_RPC_URL: string;
  XGUARD_TREASURY_USDC_ADDRESS: string;
  REQUEST_RATE_LIMITER: RateLimit;
  GLOBAL_RATE_LIMITER: RateLimit;
}
'''
if 'REQUEST_RATE_LIMITER: RateLimit;' not in text:
    if old_env not in text:
        raise SystemExit("BuyerPassEnv anchor missing")
    text = text.replace(old_env, new_env, 1)

old_route = '''  if (request.method === "OPTIONS")
    return cors(new Response(null, { status: 204 }));

  try {
'''
new_route = '''  if (request.method === "OPTIONS")
    return cors(new Response(null, { status: 204 }));

  const protection = await buyerPassAbuseProtection(request, env, url.pathname);
  if (protection !== null) return protection;

  try {
'''
if 'const protection = await buyerPassAbuseProtection' not in text:
    if old_route not in text:
        raise SystemExit("Buyer Pass route anchor missing")
    text = text.replace(old_route, new_route, 1)

anchor = '''function privateJson(
  body: unknown,
'''
hardening = '''async function buyerPassAbuseProtection(
  request: Request,
  env: BuyerPassEnv,
  path: string,
): Promise<Response | null> {
  // Keep the anonymous onboarding endpoint available without allowing it to
  // become a free D1 row-creation primitive. The client key is used only by
  // Cloudflare's rate-limit binding and is never persisted in XGuard tables.
  const clientKey = (request.headers.get("cf-connecting-ip") ?? "unknown")
    .trim()
    .slice(0, 128);
  try {
    const [client, global] = await Promise.all([
      env.REQUEST_RATE_LIMITER.limit({ key: `buyer-pass:${path}:${clientKey}` }),
      env.GLOBAL_RATE_LIMITER.limit({ key: `buyer-pass:${path}` }),
    ]);
    if (!client.success || !global.success)
      return privateJson(
        { error: "rate_limit_exceeded" },
        429,
        { "Retry-After": "60" },
      );
    return null;
  } catch {
    // Buyer Pass is an identity + money boundary. If abuse protection is not
    // available, fail closed instead of creating unmetered identities.
    return privateJson({ error: "protection_unavailable" }, 503);
  }
}

'''
if 'async function buyerPassAbuseProtection(' not in text:
    if anchor not in text:
        raise SystemExit("privateJson anchor missing")
    text = text.replace(anchor, hardening + anchor, 1)

path.write_text(text)

# Extend the existing source-level tests so the abuse boundary cannot silently
# disappear in a future refactor.
test_path = Path("tests/buyer-pass.test.ts")
test = test_path.read_text()
needle = '''  it("removes the merchant API-key setup from the browser flow", async () => {
'''
addition = '''  it("rate limits Buyer Pass routes before creating identities", async () => {
    const source = await readFile("apps/worker/src/buyer-pass.ts", "utf8");
    expect(source).toContain("REQUEST_RATE_LIMITER.limit");
    expect(source).toContain("GLOBAL_RATE_LIMITER.limit");
    expect(source).toContain("cf-connecting-ip");
    expect(source).toContain("protection_unavailable");
    expect(source).not.toContain("buyer-pass:${path}:${token}");
  });

'''
if 'rate limits Buyer Pass routes before creating identities' not in test:
    if needle not in test:
        raise SystemExit("buyer pass test anchor missing")
    test = test.replace(needle, addition + needle, 1)
    test_path.write_text(test)
