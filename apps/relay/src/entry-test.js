import test from "node:test";
import assert from "node:assert/strict";
import entry from "./entry.js";

const BASE = "https://api.xguardgate.com";

async function call(path, method = "HEAD") {
  return entry.fetch(new Request(`${BASE}${path}`, { method }), {}, undefined);
}

test("x402 aliases answer GET and HEAD consistently", async () => {
  const aliases = [
    "/.well-known/x402",
    "/.well-known/x402-facilitator.json",
    "/.well-known/payment-manifest",
    "/.well-known/payment-manifest.json"
  ];

  for (const path of aliases) {
    const get = await call(path, "GET");
    assert.equal(get.status, 200, `${path} GET`);
    assert.equal(get.headers.get("x-xguard-discovery-alias"), "/.well-known/x402.json");

    const head = await call(path, "HEAD");
    assert.equal(head.status, 200, `${path} HEAD`);
    assert.equal(head.headers.get("x-xguard-discovery-alias"), "/.well-known/x402.json");
    assert.equal(await head.text(), "");
  }
});

test("static discovery endpoints accept HEAD without 404/405 fallthrough", async () => {
  const paths = [
    "/architecture",
    "/.well-known/owners.json",
    "/mcp/.well-known/owners.json",
    "/.well-known/glama.json",
    "/.well-known/x402.json",
    "/.well-known/xguard-authority.json",
    "/.well-known/agent-card.json",
    "/.well-known/agent.json",
    "/a2a",
    "/skill.md",
    "/llms.txt",
    "/robots.txt",
    "/sitemap.xml",
    "/docs",
    "/openapi.json",
    "/v1/protocols"
  ];

  for (const path of paths) {
    const response = await call(path, "HEAD");
    assert.equal(response.status, 200, path);
    assert.equal(await response.text(), "", `${path} must not return a HEAD body`);
  }
});

test("Glama ownership discovery is valid and cacheable", async () => {
  const response = await call("/.well-known/glama.json", "GET");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /^application\/json/);
  assert.equal(response.headers.get("x-xguard-discovery"), "glama");
  const body = await response.json();
  assert.equal(body.$schema, "https://glama.ai/mcp/schemas/connector.json");
  assert.ok(Array.isArray(body.maintainers));
  assert.ok(body.maintainers.some(item => item?.email === "mo.elayyan2023@gmail.com"));
});

test("API crawler discovery stays on the API host", async () => {
  const robots = await call("/robots.txt", "GET");
  assert.equal(robots.status, 200);
  assert.match(await robots.text(), /Sitemap: https:\/\/api\.xguardgate\.com\/sitemap\.xml/);

  const sitemap = await call("/sitemap.xml", "GET");
  assert.equal(sitemap.status, 200);
  const xml = await sitemap.text();
  assert.match(xml, /https:\/\/api\.xguardgate\.com\/.well-known\/glama\.json/);
  assert.match(xml, /https:\/\/api\.xguardgate\.com\/.well-known\/agent-card\.json/);
  assert.match(xml, /https:\/\/api\.xguardgate\.com\/openapi\.json/);
});
