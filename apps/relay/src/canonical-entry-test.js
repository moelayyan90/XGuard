import assert from "node:assert/strict";
import test from "node:test";
import app from "./canonical-entry.js";

test("canonical redirects preserve paths and query strings", async () => {
  const response = await app.fetch(new Request("https://www.xguardgate.com/connect?client=codex"), {}, {});
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "https://xguardgate.com/connect?client=codex");
});

test("A2A plus-json response receives canonical product taxonomy", async () => {
  const response = await app.fetch(new Request("https://api.xguardgate.com/.well-known/agent-card.json"), {}, {});
  assert.match(response.headers.get("content-type") || "", /application\/a2a\+json/);
  const body = await response.json();
  assert.equal(body.name, "XGuard Universal Paid AI Agent + Secretless Gateway");
  assert.equal(body.version, "5.1.0");
  assert.equal(body.canonical_identity.primary_product, "Universal Paid AI Agent + Secretless Gateway");
  assert.ok(body.skills.some(skill => skill.id === "xguard-secretless-egress"));
});

test("identity is the complete machine-readable source of product taxonomy", async () => {
  const response = await app.fetch(new Request("https://xguardgate.com/identity"), {}, {});
  const body = await response.json();
  assert.equal(body.name, "XGuard Universal Paid AI Agent + Secretless Gateway");
  assert.equal(body.version, "5.1.0");
  assert.equal(body.primary_product, "Universal Paid AI Agent + Secretless Gateway");
  assert.match(body.primary_role, /paid tool and credential broker/);
  assert.equal(body.proofrail.discovery, "https://api.xguardgate.com/v1/proof");
  assert.equal(body.compatibility_rails.x402, "https://api.xguardgate.com/facilitator");
});

test("pricing is truthful about billing boundary and uses a nonce-scoped checkout script", async () => {
  const response = await app.fetch(new Request("https://xguardgate.com/pricing"), {}, {});
  const html = await response.text();
  assert.match(html, /\$0\.001 USDC/);
  assert.match(html, /xguard\.web\.fetch/);
  assert.match(html, /no XGuard account, subscription, or mandatory SDK/);
  assert.match(html, /successful settlement/);
  assert.match(html, /JOD 3\.550/);
  assert.match(html, /5,000 operator Usage Credits/);
  assert.match(html, /https:\/\/hooks\.xguardgate\.com\/v1\/checkout/);
  const csp = response.headers.get("content-security-policy") || "";
  assert.match(csp, /script-src 'nonce-[a-f0-9]{32}'/);
  assert.match(csp, /connect-src https:\/\/hooks\.xguardgate\.com/);
});

test("robots and sitemap expose public documentation but not operator endpoints", async () => {
  const robots = await app.fetch(new Request("https://xguardgate.com/robots.txt"), {}, {});
  const rules = await robots.text();
  assert.match(rules, /Disallow: \/v1\/egress\/credentials/);
  assert.match(rules, /Disallow: \/v1\/ledger/);
  const sitemap = await app.fetch(new Request("https://xguardgate.com/sitemap.xml"), {}, {});
  const xml = await sitemap.text();
  assert.match(xml, /https:\/\/xguardgate\.com\/pricing/);
  assert.doesNotMatch(xml, /\/v1\/egress\/credentials|\/mcp/);
});

test("transaction-result pages are noindex and never claim redirects grant credits", async () => {
  const response = await app.fetch(new Request("https://xguardgate.com/credits/success"), {}, {});
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.match(await response.text(), /redirect alone does not grant credits/i);
});

test("OAuth discovery probes fail explicitly because public MCP uses x402 rather than fake OAuth", async () => {
  for (const path of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-authorization-server/mcp"]) {
    const response = await app.fetch(new Request(`https://api.xguardgate.com${path}`), {}, {});
    assert.equal(response.status, 404);
    assert.match(response.headers.get("content-type") || "", /^application\/json/);
    const body = await response.json();
    assert.equal(body.error, "oauth_not_required");
    assert.equal(body.authentication_required, false);
    assert.equal(body.resource, "https://api.xguardgate.com/mcp");
  }
});

test("runtime responses expose the exact Cloudflare Worker version used by deployment verification", async () => {
  const response = await app.fetch(new Request("https://api.xguardgate.com/mcp"), {
    CF_VERSION_METADATA: {
      id: "00000000-0000-0000-0000-000000000001",
      tag: "git-6469a282e5bd",
      timestamp: "2026-09-01T00:00:00.000Z",
    },
  }, {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-xguard-worker-version-id"), "00000000-0000-0000-0000-000000000001");
  assert.equal(response.headers.get("x-xguard-worker-version-tag"), "git-6469a282e5bd");
});
