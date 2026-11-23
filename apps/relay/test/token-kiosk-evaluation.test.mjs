import test from "node:test";
import assert from "node:assert/strict";
import { prepareSiweMessage, xguardCredentialPolicy, run } from "../scripts/token-kiosk-evaluate.mjs";

test("SIWE binds fresh issue time, wallet, Base mainnet and exact management URI", () => {
  const address = "0x000000000000000000000000000000000000dead";
  const msg = prepareSiweMessage(address, new Date("2026-11-23T08:00:00.000Z"), "noncetestsafety1");
  assert.match(msg, /api-token-kiosk\.gaib\.ai wants you to sign in/);
  assert.match(msg, /Chain ID: 8453/);
  assert.match(msg, /URI: https:\/\/api-token-kiosk\.gaib\.ai\/v1\/auth\/keys/);
  assert.match(msg, /Issued At: 2026-11-23T08:00:00\.000Z/);
  assert.ok(msg.includes(address));
});

test("custom credential only allows Token Kiosk completion POST", () => {
  const data = xguardCredentialPolicy("sk-test1234567890");
  assert.equal(data.header_prefix, "Bearer ");
  assert.deepEqual(data.allowed_hosts, ["api-token-kiosk.gaib.ai"]);
  assert.deepEqual(data.allowed_paths, ["/v1/chat/completions"]);
  assert.deepEqual(data.allowed_methods, ["POST"]);
  assert.throws(() => xguardCredentialPolicy("not-an-api-key"));
});

test("missing wallet signature material fails without attempting redemption", async t => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("Network should not be called"); });
  await assert.rejects(run({ TOKEN_KIOSK_PRIVATE_FILE: "./.test-token-kiosk-missing.json" }),
    /No authorized wallet signer/);
});
