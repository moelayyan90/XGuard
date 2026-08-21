import { parseJsonStrict, readHttpBodyTextCapped } from "@xguard/core/edge";

const MAX_BODY_BYTES = 128 * 1024;
const DEFAULT_MIN_NET_PROFIT_MICRO_USD = 100_000_000;
const DEFAULT_MIN_MARGIN_BPS = 2_000;
const DEFAULT_MIN_SCORE = 80;
const DEFAULT_MAX_RISK_SCORE = 35;
const DEFAULT_MAX_AGE_SECONDS = 1_800;
const MAX_EXECUTIONS_PER_TICK = 10;
const MAX_EXECUTION_ATTEMPTS = 5;

export interface HunterEnv {
  DB: D1Database;
  XGUARD_ADMIN_TOKEN_SHA256?: string;
  HUNTER_INGEST_SECRET?: string;
  HUNTER_AUTOMATION_MODE?: string;
  HUNTER_EXECUTION_WEBHOOK_URL?: string;
  HUNTER_EXECUTION_WEBHOOK_SECRET?: string;
  HUNTER_MIN_NET_PROFIT_MICRO_USD?: string;
  HUNTER_MIN_MARGIN_BPS?: string;
  HUNTER_MIN_SCORE?: string;
  HUNTER_MAX_RISK_SCORE?: string;
  HUNTER_MAX_AGE_SECONDS?: string;
  [key: string]: unknown;
}

export interface HunterCandidateInput {
  source: string;
  externalId: string;
  observedAt: string;
  title: string;
  description?: string;
  category: string;
  buyer: {
    country: string;
    priceMicroUsd: number;
    paymentSecured: boolean;
    fundsAvailableBeforePurchase: boolean;
    identityVerified: boolean;
  };
  supplier: {
    country: string;
    priceMicroUsd: number;
    shippingMicroUsd: number;
    dutiesMicroUsd: number;
    platformFeesMicroUsd: number;
    paymentFeesMicroUsd: number;
    fxCostMicroUsd: number;
    otherCostsMicroUsd: number;
    requiredQuantity: number;
    availableQuantity: number;
    reliabilityBps: number;
    inventoryVerified: boolean;
    identityVerified: boolean;
  };
  risk: {
    score: number;
    counterfeitRisk: boolean;
    sanctionsRisk: boolean;
    restrictedGoodsRisk: boolean;
  };
}

export interface HunterEvaluation {
  shariah: {
    status: "HALAL" | "HARAM" | "UNKNOWN";
    reason: string;
  };
  landedCostMicroUsd: number;
  netProfitMicroUsd: number;
  marginBps: number;
  score: number;
  state:
    | "READY"
    | "REJECTED_SHARIAH"
    | "REJECTED_RISK"
    | "REJECTED_ECONOMICS"
    | "REJECTED_FUNDING"
    | "REJECTED_STALE";
  reasons: string[];
}

interface OpportunityRow {
  id: string;
  source: string;
  external_id: string;
  title: string;
  category: string;
  observed_at: string;
  buyer_price_micro_usd: number;
  landed_cost_micro_usd: number;
  net_profit_micro_usd: number;
  margin_bps: number;
  score: number;
  risk_score: number;
  state: string;
  execution_attempts: number;
  payload_json: string;
}

const HARAM_PATTERNS: readonly RegExp[] = [
  /\b(alcohol|beer|wine|whisky|whiskey|vodka|rum|gin|liquor|champagne)\b/i,
  /(?:كحول|خمر|خمور|بيرة|نبيذ|ويسكي|فودكا)/i,
  /\b(pork|pig|ham|bacon|lard|swine)\b/i,
  /(?:خنزير|لحم الخنزير)/i,
  /\b(casino|gambling|betting|sportsbook|lottery|poker|slot machine)\b/i,
  /(?:قمار|مراهنات|يانصيب|كازينو)/i,
  /\b(adult|porn|pornography|sex toy|erotic|escort)\b/i,
  /(?:إباحي|اباحي|دعارة|ألعاب جنسية)/i,
  /\b(cannabis|marijuana|thc|cocaine|heroin|methamphetamine|narcotic)\b/i,
  /(?:مخدرات|حشيش|كوكايين|هيروين)/i,
  /\b(cigarette|tobacco|vape|vaping|nicotine|shisha|hookah)\b/i,
  /(?:سجائر|تبغ|فيب|نيكوتين|شيشة|أرجيلة)/i,
  /\b(firearm|gun|rifle|pistol|ammunition|ammo|explosive|grenade)\b/i,
  /(?:سلاح|أسلحة|ذخيرة|متفجرات|قنبلة)/i,
  /\b(interest-bearing|payday loan|loan shark|binary option|forex signal)\b/i,
  /(?:ربا|فائدة ربوية|قرض ربوي)/i,
  /\b(gold bullion|silver bullion|precious metal trading|crypto token|cryptocurrency trading)\b/i,
];

const HALAL_CATEGORY_PATTERNS: readonly RegExp[] = [
  /industrial/i,
  /machinery/i,
  /automation/i,
  /electronic/i,
  /electrical/i,
  /component/i,
  /spare parts?/i,
  /auto(?:motive)? parts?/i,
  /vehicle parts?/i,
  /tools?/i,
  /hardware/i,
  /construction/i,
  /building materials?/i,
  /office supplies?/i,
  /printing/i,
  /packaging/i,
  /furniture/i,
  /appliances?/i,
  /computers?/i,
  /networking/i,
  /servers?/i,
  /storage equipment/i,
  /mobile accessories/i,
  /معدات صناعية/i,
  /آلات/i,
  /الكترونيات|إلكترونيات/i,
  /كهربائ/i,
  /قطع غيار/i,
  /أدوات/i,
  /مواد بناء/i,
  /مستلزمات مكتبية/i,
  /طباعة/i,
  /تغليف/i,
  /أثاث/i,
  /أجهزة منزلية/i,
  /حاسوب|كمبيوتر/i,
];

const COMPLEX_OR_AMBIGUOUS_CATEGORIES: readonly RegExp[] = [
  /food|beverage|meat|supplement|medicine|pharmaceutical/i,
  /طعام|غذاء|مشروب|لحوم|مكمل|دواء|صيدل/i,
  /financial|insurance|investment|commodity|derivative/i,
  /مالي|تأمين|استثمار|مشتقات/i,
  /jewelry|gold|silver|precious/i,
  /مجوهرات|ذهب|فضة/i,
];

function text(candidate: HunterCandidateInput): string {
  return `${candidate.title}\n${candidate.description ?? ""}\n${candidate.category}`;
}

export function evaluateShariahPolicy(candidate: HunterCandidateInput): {
  status: "HALAL" | "HARAM" | "UNKNOWN";
  reason: string;
} {
  const candidateText = text(candidate);
  if (HARAM_PATTERNS.some((pattern) => pattern.test(candidateText))) {
    return { status: "HARAM", reason: "hard_blocked_category_or_keyword" };
  }
  if (
    COMPLEX_OR_AMBIGUOUS_CATEGORIES.some((pattern) =>
      pattern.test(candidateText),
    )
  ) {
    return {
      status: "UNKNOWN",
      reason: "requires_shariah_specific_verification",
    };
  }
  if (HALAL_CATEGORY_PATTERNS.some((pattern) => pattern.test(candidateText))) {
    return { status: "HALAL", reason: "approved_trade_category" };
  }
  return { status: "UNKNOWN", reason: "category_not_proven_halal" };
}

export function evaluateOpportunity(
  candidate: HunterCandidateInput,
  nowEpochMs = Date.now(),
  overrides: Partial<{
    minNetProfitMicroUsd: number;
    minMarginBps: number;
    minScore: number;
    maxRiskScore: number;
    maxAgeSeconds: number;
  }> = {},
): HunterEvaluation {
  validateCandidate(candidate);
  const minNetProfitMicroUsd =
    overrides.minNetProfitMicroUsd ?? DEFAULT_MIN_NET_PROFIT_MICRO_USD;
  const minMarginBps = overrides.minMarginBps ?? DEFAULT_MIN_MARGIN_BPS;
  const minScore = overrides.minScore ?? DEFAULT_MIN_SCORE;
  const maxRiskScore = overrides.maxRiskScore ?? DEFAULT_MAX_RISK_SCORE;
  const maxAgeSeconds = overrides.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;

  const shariah = evaluateShariahPolicy(candidate);
  const landedCostMicroUsd = sumSafe([
    candidate.supplier.priceMicroUsd,
    candidate.supplier.shippingMicroUsd,
    candidate.supplier.dutiesMicroUsd,
    candidate.supplier.platformFeesMicroUsd,
    candidate.supplier.paymentFeesMicroUsd,
    candidate.supplier.fxCostMicroUsd,
    candidate.supplier.otherCostsMicroUsd,
  ]);
  const netProfitMicroUsd = candidate.buyer.priceMicroUsd - landedCostMicroUsd;
  const marginBps =
    candidate.buyer.priceMicroUsd === 0
      ? -10_000
      : Math.floor(
          (netProfitMicroUsd * 10_000) / candidate.buyer.priceMicroUsd,
        );
  const ageSeconds = Math.max(
    0,
    Math.floor((nowEpochMs - new Date(candidate.observedAt).getTime()) / 1_000),
  );

  const reasons: string[] = [];
  if (shariah.status !== "HALAL") reasons.push(`shariah:${shariah.reason}`);
  if (!candidate.buyer.paymentSecured)
    reasons.push("buyer_payment_not_secured");
  if (!candidate.buyer.fundsAvailableBeforePurchase)
    reasons.push("buyer_funds_not_available_before_purchase");
  if (!candidate.buyer.identityVerified)
    reasons.push("buyer_identity_unverified");
  if (!candidate.supplier.identityVerified)
    reasons.push("supplier_identity_unverified");
  if (!candidate.supplier.inventoryVerified)
    reasons.push("supplier_inventory_unverified");
  if (
    candidate.supplier.availableQuantity < candidate.supplier.requiredQuantity
  )
    reasons.push("insufficient_supplier_quantity");
  if (candidate.risk.counterfeitRisk) reasons.push("counterfeit_risk");
  if (candidate.risk.sanctionsRisk) reasons.push("sanctions_risk");
  if (candidate.risk.restrictedGoodsRisk) reasons.push("restricted_goods_risk");
  if (candidate.risk.score > maxRiskScore) reasons.push("risk_score_too_high");
  if (netProfitMicroUsd < minNetProfitMicroUsd)
    reasons.push("net_profit_below_floor");
  if (marginBps < minMarginBps) reasons.push("margin_below_floor");
  if (ageSeconds > maxAgeSeconds) reasons.push("opportunity_stale");

  const profitScore = clamp(
    Math.floor((Math.max(0, netProfitMicroUsd) / minNetProfitMicroUsd) * 20),
    0,
    35,
  );
  const marginScore = clamp(Math.floor(Math.max(0, marginBps) / 200), 0, 15);
  const fundingScore =
    candidate.buyer.paymentSecured &&
    candidate.buyer.fundsAvailableBeforePurchase
      ? 20
      : 0;
  const reliabilityScore = clamp(
    Math.floor(candidate.supplier.reliabilityBps / 667),
    0,
    15,
  );
  const riskScore = clamp(
    Math.floor((100 - candidate.risk.score) * 0.15),
    0,
    15,
  );
  const score = clamp(
    profitScore + marginScore + fundingScore + reliabilityScore + riskScore,
    0,
    100,
  );
  if (score < minScore) reasons.push("score_below_floor");

  let state: HunterEvaluation["state"] = "READY";
  if (shariah.status !== "HALAL") state = "REJECTED_SHARIAH";
  else if (ageSeconds > maxAgeSeconds) state = "REJECTED_STALE";
  else if (
    !candidate.buyer.paymentSecured ||
    !candidate.buyer.fundsAvailableBeforePurchase
  )
    state = "REJECTED_FUNDING";
  else if (
    !candidate.buyer.identityVerified ||
    !candidate.supplier.identityVerified ||
    !candidate.supplier.inventoryVerified ||
    candidate.supplier.availableQuantity <
      candidate.supplier.requiredQuantity ||
    candidate.risk.counterfeitRisk ||
    candidate.risk.sanctionsRisk ||
    candidate.risk.restrictedGoodsRisk ||
    candidate.risk.score > maxRiskScore
  )
    state = "REJECTED_RISK";
  else if (
    netProfitMicroUsd < minNetProfitMicroUsd ||
    marginBps < minMarginBps ||
    score < minScore
  )
    state = "REJECTED_ECONOMICS";

  return {
    shariah,
    landedCostMicroUsd,
    netProfitMicroUsd,
    marginBps,
    score,
    state,
    reasons,
  };
}

export async function globalOpportunityHunterResponse(
  request: Request,
  env: HunterEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/v1/hunter/")) return null;

  if (url.pathname === "/v1/hunter/ingest" && request.method === "POST") {
    const raw = await readHttpBodyTextCapped(request, MAX_BODY_BYTES);
    const auth = await verifyIngestSignature(request, env, raw);
    if (!auth) return json({ error: "unauthorized" }, 401);
    const parsed = parseJsonStrict(raw, { maxBytes: MAX_BODY_BYTES });
    if (!isRecord(parsed)) return json({ error: "invalid_payload" }, 400);
    const candidatesValue = parsed.candidates;
    const candidates = Array.isArray(candidatesValue)
      ? candidatesValue.map(parseCandidate)
      : [parseCandidate(parsed)];
    if (candidates.length > 100)
      return json({ error: "batch_too_large", max: 100 }, 413);

    const results: Array<Record<string, unknown>> = [];
    for (const candidate of candidates) {
      const evaluation = evaluateOpportunity(
        candidate,
        Date.now(),
        config(env),
      );
      const id = await persistOpportunity(env.DB, candidate, evaluation);
      results.push({ id, externalId: candidate.externalId, ...evaluation });
    }
    return json({ accepted: results.length, results }, 202);
  }

  if (!(await requireAdmin(request, env)))
    return json({ error: "unauthorized" }, 401);

  if (url.pathname === "/v1/hunter/status" && request.method === "GET") {
    const stats = await env.DB.prepare(
      `SELECT state, COUNT(*) AS count, COALESCE(SUM(net_profit_micro_usd),0) AS net
       FROM hunter_opportunities GROUP BY state`,
    ).all<{ state: string; count: number; net: number }>();
    return json({
      mode: automationMode(env),
      strictShariahFilter: true,
      requiresBuyerFundsBeforePurchase: true,
      states: stats.results,
      measuredAt: new Date().toISOString(),
    });
  }

  if (url.pathname === "/v1/hunter/opportunities" && request.method === "GET") {
    const limit = clamp(Number(url.searchParams.get("limit") ?? "25"), 1, 100);
    const rows = await env.DB.prepare(
      `SELECT id, source, external_id, title, category, observed_at,
              buyer_price_micro_usd, landed_cost_micro_usd, net_profit_micro_usd,
              margin_bps, score, risk_score, state, execution_attempts
         FROM hunter_opportunities
        ORDER BY CASE state WHEN 'READY' THEN 0 ELSE 1 END, score DESC, created_at DESC
        LIMIT ?`,
    )
      .bind(limit)
      .all();
    return json({ opportunities: rows.results });
  }

  if (url.pathname === "/v1/hunter/run" && request.method === "POST") {
    const result = await runGlobalOpportunityHunter(env);
    return json(result);
  }

  return json({ error: "not_found" }, 404);
}

export async function runGlobalOpportunityHunter(env: HunterEnv): Promise<{
  mode: string;
  considered: number;
  submitted: number;
  failed: number;
}> {
  const mode = automationMode(env);
  const rows = await env.DB.prepare(
    `SELECT id, source, external_id, title, category, observed_at,
            buyer_price_micro_usd, landed_cost_micro_usd, net_profit_micro_usd,
            margin_bps, score, risk_score, state, execution_attempts, payload_json
       FROM hunter_opportunities
      WHERE state='READY' AND execution_attempts < ?
      ORDER BY score DESC, net_profit_micro_usd DESC
      LIMIT ?`,
  )
    .bind(MAX_EXECUTION_ATTEMPTS, MAX_EXECUTIONS_PER_TICK)
    .all<OpportunityRow>();

  if (mode !== "live")
    return { mode, considered: rows.results.length, submitted: 0, failed: 0 };

  const endpoint = optionalString(env.HUNTER_EXECUTION_WEBHOOK_URL);
  const secret = optionalString(env.HUNTER_EXECUTION_WEBHOOK_SECRET);
  if (endpoint === null || secret === null)
    return {
      mode: "safe-disabled",
      considered: rows.results.length,
      submitted: 0,
      failed: 0,
    };
  assertSafeHttpsEndpoint(endpoint);

  let submitted = 0;
  let failed = 0;
  for (const row of rows.results) {
    try {
      const payload = JSON.stringify({
        action: "back_to_back_trade",
        opportunityId: row.id,
        idempotencyKey: `xguard-hunter:${row.id}`,
        strictShariahFilter: true,
        mustCollectBuyerFundsBeforeSupplierPurchase: true,
        expectedNetProfitMicroUsd: row.net_profit_micro_usd,
        buyerPriceMicroUsd: row.buyer_price_micro_usd,
        landedCostMicroUsd: row.landed_cost_micro_usd,
        candidate: JSON.parse(row.payload_json) as unknown,
      });
      const signature = await hmacHex(secret, payload);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `xguard-hunter:${row.id}`,
          "X-XGuard-Hunter-Signature": `sha256=${signature}`,
        },
        body: payload,
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`execution_http_${response.status}`);
      const reference =
        response.headers.get("x-execution-reference")?.slice(0, 256) ?? null;
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE hunter_opportunities
              SET state='EXECUTION_SUBMITTED', execution_attempts=execution_attempts+1,
                  execution_ref=?, executed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP,
                  last_error=NULL
            WHERE id=? AND state='READY'`,
        ).bind(reference, row.id),
        env.DB.prepare(
          `INSERT INTO hunter_execution_events
             (id, opportunity_id, event_type, detail, created_at)
           VALUES (?, ?, 'EXECUTION_SUBMITTED', ?, CURRENT_TIMESTAMP)`,
        ).bind(crypto.randomUUID(), row.id, reference ?? "submitted"),
      ]);
      submitted += 1;
    } catch (error) {
      failed += 1;
      const message =
        error instanceof Error
          ? error.message.slice(0, 512)
          : "execution_failed";
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE hunter_opportunities
              SET execution_attempts=execution_attempts+1,
                  last_error=?, updated_at=CURRENT_TIMESTAMP,
                  state=CASE WHEN execution_attempts+1 >= ? THEN 'EXECUTION_FAILED' ELSE state END
            WHERE id=?`,
        ).bind(message, MAX_EXECUTION_ATTEMPTS, row.id),
        env.DB.prepare(
          `INSERT INTO hunter_execution_events
             (id, opportunity_id, event_type, detail, created_at)
           VALUES (?, ?, 'EXECUTION_FAILED', ?, CURRENT_TIMESTAMP)`,
        ).bind(crypto.randomUUID(), row.id, message),
      ]);
    }
  }

  return { mode, considered: rows.results.length, submitted, failed };
}

async function persistOpportunity(
  db: D1Database,
  candidate: HunterCandidateInput,
  evaluation: HunterEvaluation,
): Promise<string> {
  const existing = await db
    .prepare(
      "SELECT id FROM hunter_opportunities WHERE source=? AND external_id=?",
    )
    .bind(candidate.source, candidate.externalId)
    .first<{ id: string }>();
  const id = existing?.id ?? crypto.randomUUID();
  const payloadJson = JSON.stringify(candidate);
  const rawHash = await sha256Hex(payloadJson);
  await db
    .prepare(
      `INSERT INTO hunter_opportunities (
         id, source, external_id, title, category, observed_at,
         buyer_price_micro_usd, landed_cost_micro_usd, net_profit_micro_usd,
         margin_bps, score, risk_score, shariah_status, shariah_reason,
         buyer_payment_secured, buyer_funds_available, supplier_reliability_bps,
         state, reasons_json, payload_json, raw_hash, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(source, external_id) DO UPDATE SET
         title=excluded.title, category=excluded.category, observed_at=excluded.observed_at,
         buyer_price_micro_usd=excluded.buyer_price_micro_usd,
         landed_cost_micro_usd=excluded.landed_cost_micro_usd,
         net_profit_micro_usd=excluded.net_profit_micro_usd,
         margin_bps=excluded.margin_bps, score=excluded.score, risk_score=excluded.risk_score,
         shariah_status=excluded.shariah_status, shariah_reason=excluded.shariah_reason,
         buyer_payment_secured=excluded.buyer_payment_secured,
         buyer_funds_available=excluded.buyer_funds_available,
         supplier_reliability_bps=excluded.supplier_reliability_bps,
         state=CASE WHEN hunter_opportunities.state IN ('EXECUTION_SUBMITTED','EXECUTION_COMPLETED')
                    THEN hunter_opportunities.state ELSE excluded.state END,
         reasons_json=excluded.reasons_json, payload_json=excluded.payload_json,
         raw_hash=excluded.raw_hash, updated_at=CURRENT_TIMESTAMP`,
    )
    .bind(
      id,
      candidate.source,
      candidate.externalId,
      candidate.title,
      candidate.category,
      candidate.observedAt,
      candidate.buyer.priceMicroUsd,
      evaluation.landedCostMicroUsd,
      evaluation.netProfitMicroUsd,
      evaluation.marginBps,
      evaluation.score,
      candidate.risk.score,
      evaluation.shariah.status,
      evaluation.shariah.reason,
      candidate.buyer.paymentSecured ? 1 : 0,
      candidate.buyer.fundsAvailableBeforePurchase ? 1 : 0,
      candidate.supplier.reliabilityBps,
      evaluation.state,
      JSON.stringify(evaluation.reasons),
      payloadJson,
      rawHash,
    )
    .run();
  return id;
}

function parseCandidate(value: unknown): HunterCandidateInput {
  if (!isRecord(value)) throw new Error("candidate_must_be_object");
  const buyer = record(value.buyer, "buyer");
  const supplier = record(value.supplier, "supplier");
  const risk = record(value.risk, "risk");
  return {
    source: stringField(value.source, "source"),
    externalId: stringField(value.externalId, "externalId"),
    observedAt: isoDateField(value.observedAt, "observedAt"),
    title: stringField(value.title, "title"),
    description: optionalText(value.description),
    category: stringField(value.category, "category"),
    buyer: {
      country: stringField(buyer.country, "buyer.country"),
      priceMicroUsd: integerField(buyer.priceMicroUsd, "buyer.priceMicroUsd"),
      paymentSecured: booleanField(
        buyer.paymentSecured,
        "buyer.paymentSecured",
      ),
      fundsAvailableBeforePurchase: booleanField(
        buyer.fundsAvailableBeforePurchase,
        "buyer.fundsAvailableBeforePurchase",
      ),
      identityVerified: booleanField(
        buyer.identityVerified,
        "buyer.identityVerified",
      ),
    },
    supplier: {
      country: stringField(supplier.country, "supplier.country"),
      priceMicroUsd: integerField(
        supplier.priceMicroUsd,
        "supplier.priceMicroUsd",
      ),
      shippingMicroUsd: integerField(
        supplier.shippingMicroUsd,
        "supplier.shippingMicroUsd",
      ),
      dutiesMicroUsd: integerField(
        supplier.dutiesMicroUsd,
        "supplier.dutiesMicroUsd",
      ),
      platformFeesMicroUsd: integerField(
        supplier.platformFeesMicroUsd,
        "supplier.platformFeesMicroUsd",
      ),
      paymentFeesMicroUsd: integerField(
        supplier.paymentFeesMicroUsd,
        "supplier.paymentFeesMicroUsd",
      ),
      fxCostMicroUsd: integerField(
        supplier.fxCostMicroUsd,
        "supplier.fxCostMicroUsd",
      ),
      otherCostsMicroUsd: integerField(
        supplier.otherCostsMicroUsd,
        "supplier.otherCostsMicroUsd",
      ),
      requiredQuantity: integerField(
        supplier.requiredQuantity,
        "supplier.requiredQuantity",
      ),
      availableQuantity: integerField(
        supplier.availableQuantity,
        "supplier.availableQuantity",
      ),
      reliabilityBps: integerField(
        supplier.reliabilityBps,
        "supplier.reliabilityBps",
      ),
      inventoryVerified: booleanField(
        supplier.inventoryVerified,
        "supplier.inventoryVerified",
      ),
      identityVerified: booleanField(
        supplier.identityVerified,
        "supplier.identityVerified",
      ),
    },
    risk: {
      score: integerField(risk.score, "risk.score"),
      counterfeitRisk: booleanField(
        risk.counterfeitRisk,
        "risk.counterfeitRisk",
      ),
      sanctionsRisk: booleanField(risk.sanctionsRisk, "risk.sanctionsRisk"),
      restrictedGoodsRisk: booleanField(
        risk.restrictedGoodsRisk,
        "risk.restrictedGoodsRisk",
      ),
    },
  };
}

function validateCandidate(candidate: HunterCandidateInput): void {
  if (candidate.source.length > 120 || candidate.externalId.length > 240)
    throw new Error("candidate_identifier_too_long");
  if (candidate.title.length > 500 || candidate.category.length > 200)
    throw new Error("candidate_text_too_long");
  if (
    candidate.description !== undefined &&
    candidate.description.length > 4_000
  )
    throw new Error("candidate_description_too_long");
  if (candidate.supplier.reliabilityBps > 10_000)
    throw new Error("supplier_reliability_bps_out_of_range");
  if (candidate.risk.score > 100) throw new Error("risk_score_out_of_range");
  if (candidate.supplier.requiredQuantity < 1)
    throw new Error("required_quantity_must_be_positive");
  const observed = new Date(candidate.observedAt).getTime();
  if (!Number.isFinite(observed)) throw new Error("observed_at_invalid");
}

function config(env: HunterEnv): Partial<{
  minNetProfitMicroUsd: number;
  minMarginBps: number;
  minScore: number;
  maxRiskScore: number;
  maxAgeSeconds: number;
}> {
  return {
    minNetProfitMicroUsd: envNumber(
      env.HUNTER_MIN_NET_PROFIT_MICRO_USD,
      DEFAULT_MIN_NET_PROFIT_MICRO_USD,
    ),
    minMarginBps: envNumber(env.HUNTER_MIN_MARGIN_BPS, DEFAULT_MIN_MARGIN_BPS),
    minScore: envNumber(env.HUNTER_MIN_SCORE, DEFAULT_MIN_SCORE),
    maxRiskScore: envNumber(env.HUNTER_MAX_RISK_SCORE, DEFAULT_MAX_RISK_SCORE),
    maxAgeSeconds: envNumber(
      env.HUNTER_MAX_AGE_SECONDS,
      DEFAULT_MAX_AGE_SECONDS,
    ),
  };
}

function automationMode(env: HunterEnv): "shadow" | "live" {
  return optionalString(env.HUNTER_AUTOMATION_MODE)?.toLowerCase() === "live"
    ? "live"
    : "shadow";
}

async function verifyIngestSignature(
  request: Request,
  env: HunterEnv,
  rawBody: string,
): Promise<boolean> {
  const secret = optionalString(env.HUNTER_INGEST_SECRET);
  const signature = request.headers.get("x-xguard-hunter-signature");
  const timestamp = request.headers.get("x-xguard-hunter-timestamp");
  if (secret === null || signature === null || timestamp === null) return false;
  const timestampNumber = Number(timestamp);
  if (!Number.isSafeInteger(timestampNumber)) return false;
  if (Math.abs(Math.floor(Date.now() / 1_000) - timestampNumber) > 300)
    return false;
  const expected = `sha256=${await hmacHex(secret, `${timestamp}.${rawBody}`)}`;
  return timingSafeTextEqual(expected, signature);
}

async function requireAdmin(
  request: Request,
  env: HunterEnv,
): Promise<boolean> {
  const expected = optionalString(env.XGUARD_ADMIN_TOKEN_SHA256)?.toLowerCase();
  if (expected === null || !/^[a-f0-9]{64}$/.test(expected)) return false;
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return false;
  const token = authorization.slice(7).trim();
  if (token.length < 16 || token.length > 512) return false;
  const actual = await sha256Hex(token);
  return timingSafeTextEqual(expected, actual);
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return bytesToHex(new Uint8Array(signature));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return bytesToHex(new Uint8Array(digest));
}

function bytesToHex(bytes: Uint8Array): string {
  let output = "";
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
  return output;
}

function timingSafeTextEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let index = 0; index < aBytes.length; index += 1)
    diff |= aBytes[index]! ^ bBytes[index]!;
  return diff === 0;
}

function assertSafeHttpsEndpoint(value: string): void {
  const url = new URL(value);
  if (url.protocol !== "https:")
    throw new Error("execution_endpoint_requires_https");
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1"
  )
    throw new Error("execution_endpoint_not_public");
}

function envNumber(value: unknown, fallback: number): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function integerField(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new Error(`${field}_must_be_non_negative_safe_integer`);
  return value as number;
}

function booleanField(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field}_must_be_boolean`);
  return value;
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`${field}_must_be_non_empty_string`);
  return value.trim();
}

function isoDateField(value: unknown, field: string): string {
  const textValue = stringField(value, field);
  const date = new Date(textValue);
  if (!Number.isFinite(date.getTime()))
    throw new Error(`${field}_must_be_iso_date`);
  return date.toISOString();
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error("description_must_be_string");
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${field}_must_be_object`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sumSafe(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isSafeInteger(total)) throw new Error("money_sum_overflow");
  }
  return total;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
