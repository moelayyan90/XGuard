// Budgets are operator decisions, not observed invoices or profit guarantees.
function integer(value, max = Number.MAX_SAFE_INTEGER) {
  if (value === undefined || value === null || value === "" || !/^\d+$/.test(String(value))) return null;
  const result = Number(value);
  return Number.isSafeInteger(result) && result <= max ? result : null;
}

export function pricingEconomics(env, price) {
  const infrastructure = integer(env.XGUARD_INFRASTRUCTURE_COST_BUDGET_USD_MICROS);
  const payment = integer(env.XGUARD_PAYMENT_COST_BUDGET_USD_MICROS);
  const minBps = integer(env.XGUARD_MIN_CONTRIBUTION_BPS, 9999);
  const configured = infrastructure !== null && payment !== null && minBps !== null;
  const cost = configured ? infrastructure + payment : null;
  const floor = configured && Number.isSafeInteger(cost) ? Number((BigInt(cost) * 10000n + BigInt(9999 - minBps)) / BigInt(10000 - minBps)) : null;
  const available = configured && Number.isSafeInteger(floor) && Number.isSafeInteger(price) && price > 0 && price >= floor;
  return {
    basis: "configured_cost_budgets_not_measured_profit",
    configured,
    available,
    rejection_reason: !configured ? "cost_budgets_missing" : !available ? "price_below_cost_floor" : null,
    customer_price_usd_micros: price,
    provider_cost_usd_micros: 0,
    provider_cost_basis: "built_in_public_https_fetch_without_a_paid_provider",
    infrastructure_cost_budget_usd_micros: infrastructure,
    payment_cost_budget_usd_micros: payment,
    minimum_contribution_bps: minBps,
    minimum_price_usd_micros: floor,
    estimated_contribution_usd_micros: configured ? price - cost : null,
    estimated_contribution_margin_bps: configured && price > 0 ? Math.floor((price - cost) * 10000 / price) : null,
    actual_infrastructure_cost_usd_micros: null,
    actual_payment_cost_usd_micros: null,
    gross_profit_usd_micros: null,
    net_profit_usd_micros: null,
  };
}

export function executionEconomics(record) {
  const cash = Number(record.gross_revenue_usd_micros || 0);
  const delivered = cash > 0 && (record.status === "succeeded" || record.credit_redeemed === true);
  const budget = record.cost_budget;
  const attempts = Math.max(1, Number(record.execution_attempts || 0));
  const estimate = delivered && budget?.configured ? cash - attempts * (budget.provider_cost_usd_micros + budget.infrastructure_cost_budget_usd_micros) - budget.payment_cost_budget_usd_micros : null;
  return {
    settled_cash_usd_micros: cash,
    recognized_revenue_usd_micros: delivered ? cash : 0,
    unfulfilled_liability_usd_micros: delivered ? 0 : cash,
    provider_cost_usd_micros: record.actual_upstream_cost_usd_micros ?? null,
    actual_infrastructure_cost_usd_micros: null,
    actual_payment_cost_usd_micros: null,
    estimated_contribution_usd_micros: estimate,
    estimated_contribution_margin_bps: estimate !== null ? Math.floor(estimate * 10000 / cash) : null,
    gross_profit_usd_micros: null,
    net_profit_usd_micros: null,
    basis: "cash_and_delivery_observed_costs_budgeted_actual_profit_unknown",
    cost_budget: budget || null,
    execution_attempts: attempts,
  };
}
