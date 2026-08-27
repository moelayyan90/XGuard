import test from "node:test";
import assert from "node:assert/strict";
import {
  pathMatches,
  openApiPathMatches,
  openApiRulesFromDocument,
  protectedPatterns,
  autoGateEnabled,
  XGUARD_FACILITATOR_URL,
  XGUARD_EDGE_VERSION,
} from "../src/index.js";

test("pins the canonical XGuard facilitator", () => {
  assert.equal(XGUARD_FACILITATOR_URL, "https://api.xguardgate.com");
  assert.equal(XGUARD_EDGE_VERSION, "5.0.1");
});

test("matches exact and wildcard protected routes without overmatching", () => {
  assert.equal(pathMatches("/api/premium", "/api/premium"), true);
  assert.equal(pathMatches("/api/premium/a", "/api/premium/*"), true);
  assert.equal(pathMatches("/api/premium", "/api/premium/*"), true);
  assert.equal(pathMatches("/api/premiumevil", "/api/premium/*"), false);
  assert.equal(pathMatches("/api/free", "/api/premium/*"), false);
});

test("matches OpenAPI path parameters by segment, not prefix", () => {
  assert.equal(openApiPathMatches("/users/42", "/users/{id}"), true);
  assert.equal(openApiPathMatches("/users/42/orders/9", "/users/{id}/orders/{orderId}"), true);
  assert.equal(openApiPathMatches("/users", "/users/{id}"), false);
  assert.equal(openApiPathMatches("/users/42/extra", "/users/{id}"), false);
  assert.equal(openApiPathMatches("/usersx/42", "/users/{id}"), false);
});

test("accepts structured and JSON-string route configuration", () => {
  const rules = [{ pattern: "/paid/*", price: "$0.02" }];
  assert.deepEqual(protectedPatterns({ PROTECTED_PATTERNS: rules }), rules);
  assert.deepEqual(protectedPatterns({ PROTECTED_PATTERNS: JSON.stringify(rules) }), rules);
  assert.deepEqual(protectedPatterns({ PROTECTED_PATTERNS: "not-json" }), []);
});

test("OpenAPI AutoGate is explicit opt-in", () => {
  assert.equal(autoGateEnabled({}), false);
  assert.equal(autoGateEnabled({ AUTO_GATE_OPENAPI: "false" }), false);
  assert.equal(autoGateEnabled({ AUTO_GATE_OPENAPI: "true" }), true);
  assert.equal(autoGateEnabled({ AUTO_GATE_OPENAPI: "1" }), true);
});

test("turns OpenAPI operations into paid rules with per-operation overrides", () => {
  const document = {
    openapi: "3.1.0",
    paths: {
      "/weather/{city}": {
        get: {
          summary: "Weather by city",
          "x-xguard-price": "$0.003",
        },
      },
      "/public/status": {
        get: {
          summary: "Public status",
          "x-xguard-free": true,
        },
      },
      "/inference": {
        post: {
          operationId: "runInference",
        },
      },
    },
  };

  assert.deepEqual(openApiRulesFromDocument(document, { DEFAULT_PRICE: "$0.02" }), [
    {
      method: "GET",
      pattern: "/weather/{city}",
      price: "$0.003",
      description: "Weather by city",
      mimeType: "application/json",
      source: "openapi",
    },
    {
      method: "POST",
      pattern: "/inference",
      price: "$0.02",
      description: "runInference",
      mimeType: "application/json",
      source: "openapi",
    },
  ]);
});

test("rejects malformed OpenAPI policy instead of silently generating no rules", () => {
  assert.throws(() => openApiRulesFromDocument({}, {}), /paths object/);
});
