import test from "node:test";
import assert from "node:assert/strict";
import { pricingEconomics, executionEconomics } from "./unit-economics.js";

const costs = { XGUARD_INFRASTRUCTURE_COST_BUDGET_USD_MICROS: "100", XGUARD_PAYMENT_COST_BUDGET_USD_MICROS: "0", XGUARD_MIN_CONTRIBUTION_BPS: "2000" };

test("a fixed price must meet a rounded-up contribution floor", () => {
  const atFloor = pricingEconomics(costs, 125);
  assert.equal(atFloor.available, true);
  assert.equal(atFloor.minimum_price_usd_micros, 125);
  assert.equal(atFloor.estimated_contribution_margin_bps, 2000);
  assert.equal(pricingEconomics(costs, 124).available, false);
  assert.equal(pricingEconomics({ ...costs, XGUARD_INFRASTRUCTURE_COST_BUDGET_USD_MICROS: "101" }, 126).available, false);
  assert.equal(pricingEconomics({ ...costs, XGUARD_INFRASTRUCTURE_COST_BUDGET_USD_MICROS: "101" }, 127).available, true);
});

test("unknown, malformed, negative and overflowing cost inputs never enable paid execution", () => {
  assert.equal(pricingEconomics({}, 1000).available, false);
  for (const value of ["NaN", "-1", "1.5", "Infinity", "9007199254740992", ""]) assert.equal(pricingEconomics({ ...costs, XGUARD_PAYMENT_COST_BUDGET_USD_MICROS: value }, 1000).available, false);
  assert.equal(pricingEconomics({ ...costs, XGUARD_MIN_CONTRIBUTION_BPS: "10000" }, 1000).available, false);
});

test("settled cash, delivered revenue, liability and estimated contribution are distinct", () => {
  const record = { status: "settled", gross_revenue_usd_micros: 1000, actual_upstream_cost_usd_micros: 0, cost_budget: pricingEconomics(costs, 1000) };
  const settled = executionEconomics(record);
  assert.equal(settled.settled_cash_usd_micros, 1000);
  assert.equal(settled.recognized_revenue_usd_micros, 0);
  assert.equal(settled.unfulfilled_liability_usd_micros, 1000);
  const delivered = executionEconomics({ ...record, status: "succeeded" });
  assert.equal(delivered.recognized_revenue_usd_micros, 1000);
  assert.equal(delivered.unfulfilled_liability_usd_micros, 0);
  assert.equal(delivered.estimated_contribution_usd_micros, 900);
  assert.equal(delivered.gross_profit_usd_micros, null);
  assert.equal(delivered.net_profit_usd_micros, null);
  assert.equal(executionEconomics({ ...record, status: "credited" }).recognized_revenue_usd_micros, 0);
});

test("historical records without costs do not manufacture contribution or profit", () => {
  const legacy = executionEconomics({ status: "succeeded", gross_revenue_usd_micros: 1000, net_profit_usd_micros: 1000 });
  assert.equal(legacy.recognized_revenue_usd_micros, 1000);
  assert.equal(legacy.estimated_contribution_usd_micros, null);
  assert.equal(legacy.net_profit_usd_micros, null);
});
