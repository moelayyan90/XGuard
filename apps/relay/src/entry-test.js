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
    "/.well-known/xguard-authority.json",
    "/.well-known/agent-card.json",
    "/.well-known/agent.json",
    "/a2a",
    "/skill.md",
    "/llms.txt",
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
