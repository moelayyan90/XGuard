import test from "node:test";
import assert from "node:assert/strict";
import {
  isRealRevenueSettlement,
  networkEnvironment,
  paymentStateCanTransition,
  validatePaymentRailConfig,
} from "./payment-rail.js";

const TX = `0x${"1".repeat(64)}`;
const ADDRESS = "0x1111111111111111111111111111111111111111";

test("payment rail configuration never treats testnet as production", () => {
  assert.equal(networkEnvironment("eip155:8453"), "production");
  assert.equal(networkEnvironment("eip155:84532"), "test");
  assert.equal(validatePaymentRailConfig({ environment: "production", network: "eip155:84532", asset: ADDRESS, payTo: ADDRESS, amount: "1000", facilitator: "https://facilitator.example" }).configured, false);
  assert.equal(validatePaymentRailConfig({ environment: "typo", network: "eip155:8453", asset: ADDRESS, payTo: ADDRESS, amount: "1000", facilitator: "https://facilitator.example" }).configured, false);
});

test("financial state transitions are explicit", () => {
  assert.equal(paymentStateCanTransition("pending", "settled"), false);
  assert.equal(paymentStateCanTransition("pending", "verified"), true);
  assert.equal(paymentStateCanTransition("verified", "settled"), true);
  assert.equal(paymentStateCanTransition("settled", "succeeded"), true);
});

test("only an external production settlement can be real revenue", () => {
  const settlement = { success: true, network: "eip155:8453", transaction: TX };
  assert.equal(isRealRevenueSettlement({ environment: "production", traffic_class: "external" }, settlement), true);
  assert.equal(isRealRevenueSettlement({ environment: "test", traffic_class: "external" }, { ...settlement, network: "eip155:84532" }), false);
  assert.equal(isRealRevenueSettlement({ environment: "production", traffic_class: "synthetic" }, settlement), false);
  assert.equal(isRealRevenueSettlement({ environment: "production", traffic_class: "external" }, { ...settlement, transaction: null }), false);
});
