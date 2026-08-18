import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { authenticateBuyerPassToken } from "../../apps/worker/src/buyer-pass.js";
import { mcpOAuthResponse } from "../../apps/worker/src/mcp-oauth.js";

const ORIGIN = "https://xguard.test";
const REDIRECT_URI = "https://chatgpt.example/callback";

function oauthEnv() {
  return { DB: env.DB };
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  let binary = "";
  for (const byte of new Uint8Array(digest))
    binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function csrfFromSetCookie(value: string | null): string {
  if (value === null) throw new Error("csrf cookie missing");
  const match = /__Host-xguard_oauth_csrf=([^;]+)/.exec(value);
  if (match?.[1] === undefined) throw new Error("csrf cookie malformed");
  return match[1];
}

describe("MCP OAuth", () => {
  it("serves authorization and protected-resource discovery on compatibility paths", async () => {
    const authorization = await mcpOAuthResponse(
      new Request(`${ORIGIN}/mcp/.well-known/oauth-authorization-server`),
      oauthEnv(),
    );
    expect(authorization?.status).toBe(200);
    expect(await authorization?.json()).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/oauth/authorize`,
      token_endpoint: `${ORIGIN}/oauth/token`,
      registration_endpoint: `${ORIGIN}/oauth/register`,
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["xguard:mcp"],
    });

    const rfcAuthorization = await mcpOAuthResponse(
      new Request(`${ORIGIN}/.well-known/oauth-authorization-server/mcp`),
      oauthEnv(),
    );
    expect(rfcAuthorization?.status).toBe(200);
    expect(await rfcAuthorization?.json()).toMatchObject({ issuer: ORIGIN });

    const resource = await mcpOAuthResponse(
      new Request(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`),
      oauthEnv(),
    );
    expect(resource?.status).toBe(200);
    expect(await resource?.json()).toMatchObject({
      resource: `${ORIGIN}/mcp`,
      authorization_servers: [ORIGIN],
      scopes_supported: ["xguard:mcp"],
    });
  });

  it("registers a public client and exchanges a one-time PKCE code for a Buyer Pass", async () => {
    const registration = await mcpOAuthResponse(
      new Request(`${ORIGIN}/oauth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "ChatGPT Test",
          redirect_uris: [REDIRECT_URI],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code"],
          response_types: ["code"],
        }),
      }),
      oauthEnv(),
    );
    expect(registration?.status).toBe(201);
    const client = (await registration?.json()) as { client_id: string };
    expect(client.client_id).toMatch(/^xg_oauth_/);

    const verifier = "a".repeat(64);
    const challenge = await challengeFor(verifier);
    const authorizeUrl = new URL(`${ORIGIN}/oauth/authorize`);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", client.client_id);
    authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    authorizeUrl.searchParams.set("scope", "xguard:mcp");
    authorizeUrl.searchParams.set("code_challenge", challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("resource", `${ORIGIN}/mcp`);
    authorizeUrl.searchParams.set("state", "state-123");

    const consent = await mcpOAuthResponse(
      new Request(authorizeUrl),
      oauthEnv(),
    );
    expect(consent?.status).toBe(200);
    expect(await consent?.text()).toContain("Connect XGuard");
    const csrf = csrfFromSetCookie(consent?.headers.get("set-cookie") ?? null);

    const approval = new URLSearchParams({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: REDIRECT_URI,
      scope: "xguard:mcp",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: `${ORIGIN}/mcp`,
      state: "state-123",
      csrf,
      decision: "approve",
    });
    const approved = await mcpOAuthResponse(
      new Request(`${ORIGIN}/oauth/authorize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: `__Host-xguard_oauth_csrf=${csrf}`,
        },
        body: approval.toString(),
      }),
      oauthEnv(),
    );
    expect(approved?.status).toBe(303);
    const callback = new URL(approved?.headers.get("location") ?? "");
    expect(callback.origin + callback.pathname).toBe(REDIRECT_URI);
    expect(callback.searchParams.get("state")).toBe("state-123");
    const code = callback.searchParams.get("code");
    expect(code).toBeTruthy();

    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code: code ?? "",
      client_id: client.client_id,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    });
    const token = await mcpOAuthResponse(
      new Request(`${ORIGIN}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenBody.toString(),
      }),
      oauthEnv(),
    );
    expect(token?.status).toBe(200);
    const tokenJson = (await token?.json()) as {
      access_token: string;
      token_type: string;
      scope: string;
    };
    expect(tokenJson).toMatchObject({
      token_type: "Bearer",
      scope: "xguard:mcp",
    });
    expect(tokenJson.access_token).toMatch(/^xg_pass_/);

    const principal = await authenticateBuyerPassToken(
      env.DB,
      tokenJson.access_token,
    );
    expect(principal).toMatchObject({ channel: "agent" });

    const replay = await mcpOAuthResponse(
      new Request(`${ORIGIN}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenBody.toString(),
      }),
      oauthEnv(),
    );
    expect(replay?.status).toBe(400);
    expect(await replay?.json()).toMatchObject({ error: "invalid_grant" });
  });
});
