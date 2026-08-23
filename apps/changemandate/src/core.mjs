const ISO_4217 = /^[A-Z]{3}$/;
const INTERVALS = new Set(["day", "week", "month", "year", "one_time"]);

export class ChangeMandateError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "ChangeMandateError";
    this.code = code;
    this.status = status;
  }
}

function requiredString(value, field, max = 256) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new ChangeMandateError("INVALID_INPUT", `${field} must be a non-empty string up to ${max} characters`);
  }
  return value.trim();
}

function optionalString(value, field, max = 256) {
  if (value == null || value === "") return null;
  return requiredString(value, field, max);
}

function safeMinor(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ChangeMandateError("INVALID_MONEY", `${field} must be a non-negative safe integer in minor currency units`);
  }
  return value;
}

function signedSafeMinor(value, field) {
  if (!Number.isSafeInteger(value)) {
    throw new ChangeMandateError("INVALID_MONEY", `${field} must be a safe integer in minor currency units`);
  }
  return value;
}

function normalizeCurrency(value, field) {
  const c = requiredString(value, field, 3).toUpperCase();
  if (!ISO_4217.test(c)) throw new ChangeMandateError("INVALID_CURRENCY", `${field} must be a 3-letter currency code`);
  return c;
}

function normalizeRecurring(items, field) {
  if (items == null) return [];
  if (!Array.isArray(items) || items.length > 50) throw new ChangeMandateError("INVALID_RECURRING", `${field} must be an array with at most 50 items`);
  const seen = new Set();
  return items.map((x, i) => {
    if (!x || typeof x !== "object" || Array.isArray(x)) throw new ChangeMandateError("INVALID_RECURRING", `${field}[${i}] must be an object`);
    const key = requiredString(x.key ?? x.id ?? `item-${i}`, `${field}[${i}].key`, 128);
    if (seen.has(key)) throw new ChangeMandateError("INVALID_RECURRING", `${field} contains duplicate key ${key}`);
    seen.add(key);
    const interval = requiredString(x.interval, `${field}[${i}].interval`, 16).toLowerCase();
    if (!INTERVALS.has(interval) || interval === "one_time") throw new ChangeMandateError("INVALID_RECURRING", `${field}[${i}].interval is unsupported`);
    return {
      key,
      amount_minor: safeMinor(x.amount_minor, `${field}[${i}].amount_minor`),
      currency: normalizeCurrency(x.currency, `${field}[${i}].currency`),
      interval,
    };
  }).sort((a, b) => a.key.localeCompare(b.key));
}

function normalizeLineItems(items, field) {
  if (items == null) return [];
  if (!Array.isArray(items) || items.length > 200) throw new ChangeMandateError("INVALID_LINE_ITEMS", `${field} must be an array with at most 200 items`);
  return items.map((x, i) => {
    if (!x || typeof x !== "object" || Array.isArray(x)) throw new ChangeMandateError("INVALID_LINE_ITEMS", `${field}[${i}] must be an object`);
    const id = requiredString(x.id ?? x.sku ?? `item-${i}`, `${field}[${i}].id`, 160);
    const quantity = x.quantity == null ? 1 : x.quantity;
    if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 1_000_000) throw new ChangeMandateError("INVALID_LINE_ITEMS", `${field}[${i}].quantity must be a non-negative safe integer`);
    const unitPrice = x.unit_price_minor == null ? null : safeMinor(x.unit_price_minor, `${field}[${i}].unit_price_minor`);
    return { id, quantity, unit_price_minor: unitPrice };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

function normalizeAuthorization(a = {}, currency) {
  if (!a || typeof a !== "object" || Array.isArray(a)) throw new ChangeMandateError("INVALID_AUTHORIZATION", "original.authorization must be an object");
  const allowedMerchants = Array.isArray(a.allowed_merchants) ? a.allowed_merchants.map((x, i) => requiredString(x, `allowed_merchants[${i}]`, 256)) : [];
  if (allowedMerchants.length > 100) throw new ChangeMandateError("INVALID_AUTHORIZATION", "allowed_merchants exceeds 100 entries");
  const expiresAt = optionalString(a.expires_at, "authorization.expires_at", 64);
  if (expiresAt && Number.isNaN(Date.parse(expiresAt))) throw new ChangeMandateError("INVALID_AUTHORIZATION", "authorization.expires_at must be an RFC3339-compatible timestamp");
  return {
    max_additional_one_time_minor: safeMinor(a.max_additional_one_time_minor ?? 0, "authorization.max_additional_one_time_minor"),
    allow_recurring: a.allow_recurring === true,
    max_recurring_delta_minor: safeMinor(a.max_recurring_delta_minor ?? 0, "authorization.max_recurring_delta_minor"),
    allowed_merchants: [...new Set(allowedMerchants)].sort(),
    allow_currency_change: a.allow_currency_change === true,
    allow_multi_merchant: a.allow_multi_merchant === true,
    allow_quantity_increase: a.allow_quantity_increase === true,
    currency: a.currency ? normalizeCurrency(a.currency, "authorization.currency") : currency,
    expires_at: expiresAt,
  };
}

function normalizeContract(input, side) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ChangeMandateError("INVALID_INPUT", `${side} must be an object`);
  const merchantId = requiredString(input.merchant_id, `${side}.merchant_id`, 256);
  const merchantIds = Array.isArray(input.merchant_ids) ? input.merchant_ids.map((x, i) => requiredString(x, `${side}.merchant_ids[${i}]`, 256)) : [merchantId];
  const uniqueMerchants = [...new Set([merchantId, ...merchantIds])].sort();
  const currency = normalizeCurrency(input.currency, `${side}.currency`);
  return {
    order_id: optionalString(input.order_id, `${side}.order_id`, 256),
    checkout_hash: optionalString(input.checkout_hash, `${side}.checkout_hash`, 256),
    merchant_id: merchantId,
    merchant_ids: uniqueMerchants,
    currency,
    one_time_total_minor: safeMinor(input.one_time_total_minor, `${side}.one_time_total_minor`),
    recurring: normalizeRecurring(input.recurring, `${side}.recurring`),
    line_items: normalizeLineItems(input.line_items, `${side}.line_items`),
    authorization: side === "original" ? normalizeAuthorization(input.authorization, currency) : undefined,
  };
}

export function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(",")}}`;
}

export async function sha256Hex(value) {
  const data = new TextEncoder().encode(typeof value === "string" ? value : canonicalize(value));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function recurringDiff(original, proposed) {
  const oldMap = new Map(original.map((x) => [x.key, x]));
  const newMap = new Map(proposed.map((x) => [x.key, x]));
  let introduced = false;
  let increased = false;
  let changedTerms = false;
  let aggregatePositiveMinor = 0;
  const changes = [];
  for (const key of new Set([...oldMap.keys(), ...newMap.keys()])) {
    const a = oldMap.get(key);
    const b = newMap.get(key);
    if (!a && b) {
      introduced = true;
      increased = true;
      aggregatePositiveMinor += b.amount_minor;
      changes.push({ key, type: "introduced", from: null, to: b });
      continue;
    }
    if (a && !b) {
      changes.push({ key, type: "removed", from: a, to: null });
      continue;
    }
    if (a.currency !== b.currency || a.interval !== b.interval) {
      changedTerms = true;
      changes.push({ key, type: "terms_changed", from: a, to: b });
      continue;
    }
    const delta = signedSafeMinor(b.amount_minor - a.amount_minor, `recurring.${key}.delta`);
    if (delta > 0) {
      increased = true;
      aggregatePositiveMinor += delta;
    }
    if (delta !== 0) changes.push({ key, type: delta > 0 ? "increased" : "decreased", delta_minor: delta, from: a, to: b });
  }
  return { introduced, increased, changed_terms: changedTerms, aggregate_positive_delta_minor: aggregatePositiveMinor, changes };
}

function quantityIncrease(original, proposed) {
  const oldMap = new Map(original.map((x) => [x.id, x.quantity]));
  return proposed.some((x) => x.quantity > (oldMap.get(x.id) ?? 0));
}

function chooseTier({ multiMerchant, recurringMaterial, positiveDelta }) {
  if (multiMerchant) return { code: "multi_merchant_change", price_usd: "0.030" };
  if (recurringMaterial) return { code: "recurring_liability_change", price_usd: "0.020" };
  if (positiveDelta > 0) return { code: "monetary_delta_validation", price_usd: "0.005" };
  return { code: "basic_diff", price_usd: "0.002" };
}

export async function evaluateChange(request, now = new Date()) {
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new ChangeMandateError("INVALID_INPUT", "request body must be an object");
  const original = normalizeContract(request.original, "original");
  const proposed = normalizeContract(request.proposed, "proposed");
  const operationType = optionalString(request.operation?.type, "operation.type", 64) ?? "modify";
  const auth = original.authorization;

  const oneTimeDelta = signedSafeMinor(proposed.one_time_total_minor - original.one_time_total_minor, "one_time_delta_minor");
  const recurring = recurringDiff(original.recurring, proposed.recurring);
  const merchantChanged = original.merchant_id !== proposed.merchant_id;
  const multiMerchant = proposed.merchant_ids.length > 1;
  const currencyChanged = original.currency !== proposed.currency;
  const qtyIncreased = quantityIncrease(original.line_items, proposed.line_items);
  const authExpired = Boolean(auth.expires_at && Date.parse(auth.expires_at) <= now.getTime());

  const reasonCodes = [];
  let decision = "ALLOW";
  let required = null;

  const requireNew = (code, detail) => {
    reasonCodes.push(code);
    if (decision !== "DENY") decision = "NEW_AUTHORIZATION_REQUIRED";
    required ??= { one_time_delta_minor: Math.max(0, oneTimeDelta), recurring_delta_minor: recurring.aggregate_positive_delta_minor, reasons: [] };
    required.reasons.push(detail);
  };

  if (authExpired) requireNew("AUTHORIZATION_EXPIRED", "The original change budget has expired.");
  if (currencyChanged && !auth.allow_currency_change) requireNew("CURRENCY_CHANGE_NOT_AUTHORIZED", `Currency changed from ${original.currency} to ${proposed.currency}.`);
  if (merchantChanged && auth.allowed_merchants.length > 0 && !auth.allowed_merchants.includes(proposed.merchant_id)) requireNew("MERCHANT_CHANGE_NOT_AUTHORIZED", "The proposed merchant is outside the authorized merchant set.");
  if (multiMerchant && !auth.allow_multi_merchant) requireNew("MULTI_MERCHANT_NOT_AUTHORIZED", "The proposed change spans multiple merchants.");
  if (qtyIncreased && !auth.allow_quantity_increase) requireNew("QUANTITY_INCREASE_NOT_AUTHORIZED", "The proposed change increases one or more line-item quantities.");

  const recurringMaterial = recurring.introduced || recurring.increased || recurring.changed_terms;
  if (recurring.changed_terms) requireNew("RECURRING_TERMS_CHANGED", "Recurring currency or billing interval changed.");
  if ((recurring.introduced || recurring.increased) && !auth.allow_recurring) requireNew("RECURRING_LIABILITY_NOT_AUTHORIZED", "A recurring charge was introduced or increased.");
  if (auth.allow_recurring && recurring.aggregate_positive_delta_minor > auth.max_recurring_delta_minor) requireNew("RECURRING_DELTA_EXCEEDS_BUDGET", "Recurring liability exceeds the pre-authorized recurring delta.");

  if (oneTimeDelta > auth.max_additional_one_time_minor) requireNew("ONE_TIME_DELTA_EXCEEDS_BUDGET", "The positive one-time price delta exceeds the pre-authorized change budget.");

  if (decision === "ALLOW" && (oneTimeDelta > 0 || recurring.aggregate_positive_delta_minor > 0 || merchantChanged || multiMerchant || qtyIncreased)) {
    decision = "ALLOW_WITHIN_PREAUTHORIZED_DELTA";
    reasonCodes.push("WITHIN_PREAUTHORIZED_CHANGE_BUDGET");
  }
  if (decision === "ALLOW" && oneTimeDelta <= 0 && recurring.aggregate_positive_delta_minor === 0) reasonCodes.push("NO_ADDITIONAL_FINANCIAL_AUTHORIZATION_REQUIRED");

  const fingerprintPayload = {
    original_order_id: original.order_id,
    original_checkout_hash: original.checkout_hash,
    original_merchant_id: original.merchant_id,
    proposed: {
      merchant_id: proposed.merchant_id,
      merchant_ids: proposed.merchant_ids,
      currency: proposed.currency,
      one_time_total_minor: proposed.one_time_total_minor,
      recurring: proposed.recurring,
      line_items: proposed.line_items,
    },
    operation_type: operationType,
  };
  const fingerprint = await sha256Hex(fingerprintPayload);
  const tier = chooseTier({ multiMerchant, recurringMaterial, positiveDelta: Math.max(0, oneTimeDelta) });

  const explanation = decision === "ALLOW"
    ? "The proposed modification creates no new uncovered financial or contractual liability."
    : decision === "ALLOW_WITHIN_PREAUTHORIZED_DELTA"
      ? "The proposed modification creates additional or material change, but it remains inside the original pre-authorized change budget and permissions."
      : "The proposed modification creates a financial or contractual delta that is not covered by the original authorization.";

  return {
    version: "1.0",
    decision,
    reason_codes: [...new Set(reasonCodes)],
    explanation,
    operation_type: operationType,
    original: {
      order_id: original.order_id,
      merchant_id: original.merchant_id,
      currency: original.currency,
      one_time_total_minor: original.one_time_total_minor,
    },
    proposed: {
      merchant_id: proposed.merchant_id,
      merchant_ids: proposed.merchant_ids,
      currency: proposed.currency,
      one_time_total_minor: proposed.one_time_total_minor,
    },
    delta: {
      one_time_delta_minor: oneTimeDelta,
      absolute_one_time_delta_minor: Math.abs(oneTimeDelta),
      recurring_positive_delta_minor: recurring.aggregate_positive_delta_minor,
      recurring_changes: recurring.changes,
      currency_changed: currencyChanged,
      merchant_changed: merchantChanged,
      multi_merchant: multiMerchant,
      quantity_increased: qtyIncreased,
    },
    authorization_coverage: {
      max_additional_one_time_minor: auth.max_additional_one_time_minor,
      max_recurring_delta_minor: auth.max_recurring_delta_minor,
      allow_recurring: auth.allow_recurring,
      allow_currency_change: auth.allow_currency_change,
      allow_multi_merchant: auth.allow_multi_merchant,
      allow_quantity_increase: auth.allow_quantity_increase,
      expires_at: auth.expires_at,
    },
    authorization_required: required,
    change_fingerprint: `cm_${fingerprint}`,
    pricing: tier,
  };
}
