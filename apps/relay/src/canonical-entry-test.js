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
  assert.equal(body.name, "XGuard Secretless Agent Gateway");
  assert.equal(body.version, "5.0.2");
  assert.equal(body.canonical_identity.primary_product, "Secretless Egress");
  assert.ok(body.skills.some(skill => skill.id === "xguard-secretless-egress"));
});

test("pricing is truthful about billing boundary and uses a nonce-scoped checkout script", async () => {
  const response = await app.fetch(new Request("https://xguardgate.com/pricing"), {}, {});
  const html = await response.text();
  assert.match(html, /JOD 3\.550/);
  assert.match(html, /5,000 Usage Credits/);
  assert.match(html, /before the reusable credential is released/);
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
