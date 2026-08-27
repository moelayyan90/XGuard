import test from "node:test";
import assert from "node:assert/strict";
import { pathMatches, protectedPatterns, XGUARD_FACILITATOR_URL, XGUARD_EDGE_VERSION } from "../src/index.js";

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

test("accepts structured and JSON-string route configuration", () => {
  const rules = [{ pattern: "/paid/*", price: "$0.02" }];
  assert.deepEqual(protectedPatterns({ PROTECTED_PATTERNS: rules }), rules);
  assert.deepEqual(protectedPatterns({ PROTECTED_PATTERNS: JSON.stringify(rules) }), rules);
  assert.deepEqual(protectedPatterns({ PROTECTED_PATTERNS: "not-json" }), []);
});
