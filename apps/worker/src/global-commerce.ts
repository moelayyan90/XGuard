import type { SendEmailBinding } from "./xguard-mail.js";

const DEFAULT_MIN_PROFIT_USD = 100;
const DEFAULT_MIN_MARGIN_BPS = 2000;
const DEFAULT_MAX_OUTREACH_PER_DAY = 15;
const MAX_FEED_BYTES = 2_000_000;
const MAX_BODY = 20_000;

export interface GlobalCommerceEnv {
  DB: D1Database;
  EMAIL?: SendEmailBinding;
  XGUARD_ADMIN_TOKEN_SHA256?: string;
  XGUARD_COMMERCE_MIN_PROFIT_USD?: string;
  XGUARD_COMMERCE_MIN_MARGIN_BPS?: string;
  XGUARD_COMMERCE_MAX_OUTREACH_PER_DAY?: string;
  XGUARD_COMMERCE_AUTO_OUTREACH?: string;
}

interface DemandInput {
  id?: string;
  sourceName?: string;
  sourceUrl?: string;
  sourceRef?: string;
  buyerName?: string;
  buyerCountry?: string;
  buyerEmail?: string;
  productKey?: string;
  description?: string;
  quantity?: number;
  unit?: string;
  targetUnitPriceUsd?: number;
  deadlineAt?: string;
  paymentTerms?: string;
  evidenceLevel?: number;
  observedAt?: string;
}

interface OfferInput {
  id?: string;
  sourceName?: string;
  sourceUrl?: string;
  supplierName?: string;
  supplierCountry?: string;
  supplierEmail?: string;
  productKey?: string;
  description?: string;
  quantityAvailable?: number;
  unitPriceUsd?: number;
  shippingUsd?: number;
  customsUsd?: number;
  taxUsd?: number;
  paymentFeeUsd?: number;
  insuranceUsd?: number;
  otherCostUsd?: number;
  leadTimeDays?: number;
  stockVerified?: boolean;
  supplierScore?: number;
  expiresAt?: string;
  observedAt?: string;
}

interface FeedInput {
  id?: string;
  name?: string;
  url?: string;
  format?: string;
  enabled?: boolean;
}

interface NormalizedFeed {
  demands?: DemandInput[];
  offers?: OfferInput[];
}

interface OpportunityRow {
  opportunity_id: string;
  demand_id: string;
  offer_id: string;
  product_key: string;
  quantity: number;
  revenue_usd: number;
  landed_cost_usd: number;
  reserve_usd: number;
  net_profit_usd: number;
  margin_bps: number;
  score: number;
  payment_before_purchase: number;
  sanctions_clear: number;
  restricted_goods_clear: number;
  identity_match: number;
  status: string;
  rejection_reason: string | null;
  buyer_name?: string | null;
  buyer_country?: string | null;
  buyer_email?: string | null;
  description?: string | null;
  quantity_requested?: number | null;
  unit?: string | null;
  source_ref?: string | null;
  source_url?: string | null;
  supplier_name?: string | null;
  supplier_country?: string | null;
  supplier_source_url?: string | null;
}

export async function globalCommerceResponse(
  request: Request,
  env: GlobalCommerceEnv,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/v1/commerce/status") {
    return commerceStatus(env);
  }

  if (!url.pathname.startsWith("/v1/commerce/")) return null;
  if (!(await isAdmin(request, env))) return json({ error: "unauthorized" }, 401);

  if (request.method === "GET" && url.pathname === "/v1/commerce/opportunities") {
    const limit = boundedInt(url.searchParams.get("limit"), 50, 1, 200);
    const minProfit = finiteNumber(url.searchParams.get("minProfitUsd"), 0);
    const result = await env.DB.prepare(
      `SELECT o.*, d.buyer_name, d.buyer_country, d.buyer_email,
              d.description, d.quantity AS quantity_requested, d.unit,
              d.source_ref, d.source_url,
              s.supplier_name, s.supplier_country,
              s.source_url AS supplier_source_url
       FROM commerce_opportunities o
       JOIN commerce_demands d ON d.demand_id=o.demand_id
       JOIN commerce_offers s ON s.offer_id=o.offer_id
       WHERE o.net_profit_usd >= ?
       ORDER BY CASE o.status WHEN 'READY' THEN 0 WHEN 'REVIEW' THEN 1 ELSE 2 END,
                o.score DESC, o.net_profit_usd DESC
       LIMIT ?`,
    ).bind(minProfit, limit).all<OpportunityRow>();
    return json({ opportunities: result.results ?? [] });
  }

  if (request.method === "POST" && url.pathname === "/v1/commerce/ingest") {
    const body = await readJson<NormalizedFeed>(request);
    if (!body) return json({ error: "invalid_json" }, 400);
    const counts = await ingestNormalized(env, body);
    const ranked = await rebuildOpportunities(env);
    return json({ accepted: true, ...counts, ranked });
  }

  if (request.method === "POST" && url.pathname === "/v1/commerce/evaluate") {
    const body = await readJson<{ demand?: DemandInput; offer?: OfferInput }>(request);
    if (!body?.demand || !body.offer) return json({ error: "demand_and_offer_required" }, 400);
    const demand = normalizeDemand(body.demand);
    const offer = normalizeOffer(body.offer);
    if (!demand.ok) return json({ error: demand.error }, 400);
    if (!offer.ok) return json({ error: offer.error }, 400);
    return json({ evaluation: evaluate(demand.value, offer.value, env) });
  }

  if (request.method === "POST" && url.pathname === "/v1/commerce/feeds") {
    const body = await readJson<{ feeds?: FeedInput[] }>(request);
    if (!Array.isArray(body?.feeds)) return json({ error: "feeds_required" }, 400);
    let upserted = 0;
    for (const feed of body.feeds.slice(0, 100)) {
      const normalized = normalizeFeed(feed);
      if (!normalized) continue;
      const now = new Date().toISOString();
      await env.DB.prepare(
        `INSERT INTO commerce_feeds(feed_id,name,url,format,enabled,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?)
         ON CONFLICT(url) DO UPDATE SET
           name=excluded.name, format=excluded.format, enabled=excluded.enabled, updated_at=excluded.updated_at`,
      ).bind(
        normalized.id,
        normalized.name,
        normalized.url,
        normalized.format,
        normalized.enabled ? 1 : 0,
        now,
        now,
      ).run();
      upserted += 1;
    }
    return json({ upserted });
  }

  if (request.method === "POST" && url.pathname === "/v1/commerce/run") {
    const feeds = await refreshFeeds(env);
    const ranked = await rebuildOpportunities(env);
    const outreach = await autoOutreach(env);
    return json({ ran: true, feeds, ranked, outreach });
  }

  const outreachMatch = url.pathname.match(/^\/v1\/commerce\/opportunities\/([^/]+)\/outreach$/);
  if (request.method === "POST" && outreachMatch) {
    const result = await outreachOpportunity(env, decodeURIComponent(outreachMatch[1]));
    return json(result.body, result.status);
  }

  return null;
}

export async function globalCommerceScheduled(env: GlobalCommerceEnv): Promise<void> {
  await refreshFeeds(env);
  await rebuildOpportunities(env);
  if (truthy(env.XGUARD_COMMERCE_AUTO_OUTREACH)) await autoOutreach(env);
}

async function commerceStatus(env: GlobalCommerceEnv): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM commerce_demands WHERE status='OPEN') AS open_demands,
       (SELECT COUNT(*) FROM commerce_offers) AS offers,
       (SELECT COUNT(*) FROM commerce_opportunities WHERE status='READY') AS ready,
       (SELECT COALESCE(SUM(net_profit_usd),0) FROM commerce_opportunities WHERE status='READY') AS ready_profit_usd,
       (SELECT COUNT(*) FROM commerce_outreach WHERE state='SENT') AS sent_outreach,
       (SELECT COUNT(*) FROM commerce_feeds WHERE enabled=1) AS active_feeds`,
  ).first<Record<string, unknown>>();
  return json({
    mode: "global-commerce-hunter",
    inventoryPolicy: "no speculative inventory",
    fundingPolicy: "buyer funds or approved escrow before supplier purchase",
    autoOutreach: truthy(env.XGUARD_COMMERCE_AUTO_OUTREACH),
    thresholds: {
      minProfitUsd: minProfit(env),
      minMarginBps: minMargin(env),
    },
    counts: rows ?? {},
  });
}

async function ingestNormalized(env: GlobalCommerceEnv, feed: NormalizedFeed): Promise<{ demands: number; offers: number }> {
  let demands = 0;
  let offers = 0;
  for (const raw of (feed.demands ?? []).slice(0, 1000)) {
    const normalized = normalizeDemand(raw);
    if (!normalized.ok) continue;
    const d = normalized.value;
    await env.DB.prepare(
      `INSERT INTO commerce_demands(
        demand_id,source_name,source_url,source_ref,buyer_name,buyer_country,buyer_email,
        product_key,description,quantity,unit,target_unit_price_usd,deadline_at,payment_terms,
        evidence_level,status,observed_at,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(demand_id) DO UPDATE SET
        source_name=excluded.source_name,source_url=excluded.source_url,source_ref=excluded.source_ref,
        buyer_name=excluded.buyer_name,buyer_country=excluded.buyer_country,buyer_email=excluded.buyer_email,
        product_key=excluded.product_key,description=excluded.description,quantity=excluded.quantity,
        unit=excluded.unit,target_unit_price_usd=excluded.target_unit_price_usd,deadline_at=excluded.deadline_at,
        payment_terms=excluded.payment_terms,evidence_level=excluded.evidence_level,status=excluded.status,
        observed_at=excluded.observed_at,updated_at=excluded.updated_at`,
    ).bind(
      d.id,d.sourceName,d.sourceUrl,d.sourceRef,d.buyerName,d.buyerCountry,d.buyerEmail,
      d.productKey,d.description,d.quantity,d.unit,d.targetUnitPriceUsd,d.deadlineAt,d.paymentTerms,
      d.evidenceLevel,d.status,d.observedAt,d.createdAt,d.updatedAt,
    ).run();
    demands += 1;
  }

  for (const raw of (feed.offers ?? []).slice(0, 3000)) {
    const normalized = normalizeOffer(raw);
    if (!normalized.ok) continue;
    const o = normalized.value;
    await env.DB.prepare(
      `INSERT INTO commerce_offers(
        offer_id,source_name,source_url,supplier_name,supplier_country,supplier_email,product_key,
        description,quantity_available,unit_price_usd,shipping_usd,customs_usd,tax_usd,payment_fee_usd,
        insurance_usd,other_cost_usd,lead_time_days,stock_verified,supplier_score,expires_at,observed_at,
        created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(offer_id) DO UPDATE SET
        source_name=excluded.source_name,source_url=excluded.source_url,supplier_name=excluded.supplier_name,
        supplier_country=excluded.supplier_country,supplier_email=excluded.supplier_email,
        product_key=excluded.product_key,description=excluded.description,quantity_available=excluded.quantity_available,
        unit_price_usd=excluded.unit_price_usd,shipping_usd=excluded.shipping_usd,customs_usd=excluded.customs_usd,
        tax_usd=excluded.tax_usd,payment_fee_usd=excluded.payment_fee_usd,insurance_usd=excluded.insurance_usd,
        other_cost_usd=excluded.other_cost_usd,lead_time_days=excluded.lead_time_days,
        stock_verified=excluded.stock_verified,supplier_score=excluded.supplier_score,expires_at=excluded.expires_at,
        observed_at=excluded.observed_at,updated_at=excluded.updated_at`,
    ).bind(
      o.id,o.sourceName,o.sourceUrl,o.supplierName,o.supplierCountry,o.supplierEmail,o.productKey,
      o.description,o.quantityAvailable,o.unitPriceUsd,o.shippingUsd,o.customsUsd,o.taxUsd,o.paymentFeeUsd,
      o.insuranceUsd,o.otherCostUsd,o.leadTimeDays,o.stockVerified ? 1 : 0,o.supplierScore,o.expiresAt,
      o.observedAt,o.createdAt,o.updatedAt,
    ).run();
    offers += 1;
  }
  return { demands, offers };
}

async function rebuildOpportunities(env: GlobalCommerceEnv): Promise<number> {
  const matches = await env.DB.prepare(
    `SELECT
       d.demand_id,d.source_name AS demand_source_name,d.source_url AS demand_source_url,d.source_ref,
       d.buyer_name,d.buyer_country,d.buyer_email,d.product_key,d.description AS demand_description,
       d.quantity,d.unit,d.target_unit_price_usd,d.deadline_at,d.payment_terms,d.evidence_level,d.observed_at AS demand_observed_at,
       s.offer_id,s.source_name AS offer_source_name,s.source_url AS offer_source_url,s.supplier_name,
       s.supplier_country,s.supplier_email,s.description AS offer_description,s.quantity_available,s.unit_price_usd,
       s.shipping_usd,s.customs_usd,s.tax_usd,s.payment_fee_usd,s.insurance_usd,s.other_cost_usd,
       s.lead_time_days,s.stock_verified,s.supplier_score,s.expires_at,s.observed_at AS offer_observed_at
     FROM commerce_demands d
     JOIN commerce_offers s ON s.product_key=d.product_key
     WHERE d.status='OPEN'
       AND (d.deadline_at IS NULL OR d.deadline_at > datetime('now'))
       AND (s.expires_at IS NULL OR s.expires_at > datetime('now'))
       AND (s.quantity_available IS NULL OR s.quantity_available >= d.quantity)
     ORDER BY d.evidence_level DESC, s.unit_price_usd ASC
     LIMIT 5000`,
  ).all<Record<string, unknown>>();

  let count = 0;
  for (const row of matches.results ?? []) {
    const demand = rowToDemand(row);
    const offer = rowToOffer(row);
    const evaluation = evaluate(demand, offer, env);
    const now = new Date().toISOString();
    const opportunityId = await deterministicId("opp", `${demand.id}|${offer.id}`);
    await env.DB.prepare(
      `INSERT INTO commerce_opportunities(
        opportunity_id,demand_id,offer_id,product_key,quantity,revenue_usd,landed_cost_usd,reserve_usd,
        net_profit_usd,margin_bps,score,payment_before_purchase,sanctions_clear,restricted_goods_clear,
        identity_match,status,rejection_reason,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(demand_id,offer_id) DO UPDATE SET
        quantity=excluded.quantity,revenue_usd=excluded.revenue_usd,landed_cost_usd=excluded.landed_cost_usd,
        reserve_usd=excluded.reserve_usd,net_profit_usd=excluded.net_profit_usd,margin_bps=excluded.margin_bps,
        score=excluded.score,payment_before_purchase=excluded.payment_before_purchase,
        sanctions_clear=excluded.sanctions_clear,restricted_goods_clear=excluded.restricted_goods_clear,
        identity_match=excluded.identity_match,status=excluded.status,rejection_reason=excluded.rejection_reason,
        updated_at=excluded.updated_at`,
    ).bind(
      opportunityId,demand.id,offer.id,demand.productKey,demand.quantity,evaluation.revenueUsd,
      evaluation.landedCostUsd,evaluation.reserveUsd,evaluation.netProfitUsd,evaluation.marginBps,evaluation.score,
      evaluation.paymentBeforePurchase ? 1 : 0,evaluation.jurisdictionClear ? 1 : 0,
      evaluation.restrictedGoodsClear ? 1 : 0,evaluation.identityMatch ? 1 : 0,
      evaluation.status,evaluation.rejectionReason,now,now,
    ).run();
    count += 1;
  }
  return count;
}

function evaluate(demand: ReturnType<typeof rowToDemand>, offer: ReturnType<typeof rowToOffer>, env: GlobalCommerceEnv) {
  const quantity = Math.max(0, demand.quantity);
  const revenueUsd = Math.max(0, (demand.targetUnitPriceUsd ?? 0) * quantity);
  const productCost = offer.unitPriceUsd * quantity;
  const landedCostUsd = productCost + offer.shippingUsd + offer.customsUsd + offer.taxUsd +
    offer.paymentFeeUsd + offer.insuranceUsd + offer.otherCostUsd;
  const reserveUsd = Math.max(25, landedCostUsd * 0.05);
  const netProfitUsd = revenueUsd - landedCostUsd - reserveUsd;
  const marginBps = revenueUsd > 0 ? Math.round((netProfitUsd / revenueUsd) * 10_000) : -10_000;
  const identityMatch = canonicalKey(demand.productKey) === canonicalKey(offer.productKey);
  const paymentBeforePurchase = /prepay|pre-pay|advance|upfront|escrow|deposit|before shipment|before purchase/i.test(demand.paymentTerms ?? "");
  const restrictedGoodsClear = !restrictedGoods(`${demand.productKey} ${demand.description} ${offer.description}`);
  const jurisdictionClear = jurisdictionGate(demand.buyerCountry, offer.supplierCountry);
  const fresh = ageHours(demand.observedAt) <= 72 && ageHours(offer.observedAt) <= 168;
  const stock = offer.stockVerified === true;
  const supplierGood = offer.supplierScore >= 60;
  const evidenceGood = demand.evidenceLevel >= 60;
  const hasBuyerContact = Boolean(demand.buyerEmail);
  const profitable = netProfitUsd >= minProfit(env) && marginBps >= minMargin(env);
  const targetKnown = revenueUsd > 0;

  let score = 0;
  score += evidenceGood ? 18 : Math.round(demand.evidenceLevel * 0.18);
  score += stock ? 18 : 0;
  score += supplierGood ? 10 : Math.round(Math.max(0, offer.supplierScore) * 0.1);
  score += identityMatch ? 14 : 0;
  score += paymentBeforePurchase ? 14 : 0;
  score += hasBuyerContact ? 6 : 0;
  score += fresh ? 6 : 0;
  score += jurisdictionClear && restrictedGoodsClear ? 6 : 0;
  score += profitable ? 8 : 0;
  score = Math.max(0, Math.min(100, score));

  const reasons: string[] = [];
  if (!targetKnown) reasons.push("buyer_price_not_known");
  if (!identityMatch) reasons.push("product_identity_not_exact");
  if (!stock) reasons.push("supplier_stock_not_verified");
  if (!supplierGood) reasons.push("supplier_confidence_below_threshold");
  if (!evidenceGood) reasons.push("buyer_demand_evidence_below_threshold");
  if (!paymentBeforePurchase) reasons.push("buyer_funding_before_purchase_not_confirmed");
  if (!hasBuyerContact) reasons.push("buyer_contact_missing");
  if (!jurisdictionClear) reasons.push("jurisdiction_gate_failed");
  if (!restrictedGoodsClear) reasons.push("restricted_goods_gate_failed");
  if (!profitable) reasons.push("profit_threshold_not_met");

  const status = reasons.length === 0 && score >= 80 ? "READY" : score >= 55 ? "REVIEW" : "REJECTED";
  return {
    revenueUsd: round2(revenueUsd), landedCostUsd: round2(landedCostUsd), reserveUsd: round2(reserveUsd),
    netProfitUsd: round2(netProfitUsd), marginBps, score, paymentBeforePurchase, jurisdictionClear,
    restrictedGoodsClear, identityMatch, status, rejectionReason: reasons.join(",") || null,
  };
}

async function refreshFeeds(env: GlobalCommerceEnv): Promise<{ checked: number; succeeded: number }> {
  const feeds = await env.DB.prepare(
    "SELECT feed_id,name,url,format FROM commerce_feeds WHERE enabled=1 ORDER BY last_success_at ASC NULLS FIRST LIMIT 20",
  ).all<{ feed_id: string; name: string; url: string; format: string }>();
  let checked = 0;
  let succeeded = 0;
  for (const feed of feeds.results ?? []) {
    checked += 1;
    const now = new Date().toISOString();
    try {
      if (feed.format !== "json") throw new Error("unsupported_feed_format");
      const parsedUrl = new URL(feed.url);
      if (parsedUrl.protocol !== "https:" || unsafeHost(parsedUrl.hostname)) throw new Error("unsafe_feed_url");
      const response = await fetch(parsedUrl.toString(), {
        redirect: "follow",
        headers: { "Accept": "application/json", "User-Agent": "XGuard-Global-Commerce/1.0 (+https://xguardgate.com)" },
      });
      if (!response.ok) throw new Error(`feed_http_${response.status}`);
      const length = Number(response.headers.get("content-length") ?? 0);
      if (length > MAX_FEED_BYTES) throw new Error("feed_too_large");
      const text = await response.text();
      if (text.length > MAX_FEED_BYTES) throw new Error("feed_too_large");
      const body = JSON.parse(text) as NormalizedFeed;
      await ingestNormalized(env, body);
      await env.DB.prepare(
        "UPDATE commerce_feeds SET last_checked_at=?,last_success_at=?,last_error=NULL,updated_at=? WHERE feed_id=?",
      ).bind(now, now, now, feed.feed_id).run();
      succeeded += 1;
    } catch (error) {
      await env.DB.prepare(
        "UPDATE commerce_feeds SET last_checked_at=?,last_error=?,updated_at=? WHERE feed_id=?",
      ).bind(now, clean(error instanceof Error ? error.message : String(error), 500), now, feed.feed_id).run();
    }
  }
  return { checked, succeeded };
}

async function autoOutreach(env: GlobalCommerceEnv): Promise<{ attempted: number; sent: number }> {
  if (!env.EMAIL) return { attempted: 0, sent: 0 };
  const cap = boundedInt(env.XGUARD_COMMERCE_MAX_OUTREACH_PER_DAY, DEFAULT_MAX_OUTREACH_PER_DAY, 1, 100);
  const sentToday = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM commerce_outreach WHERE state='SENT' AND sent_at >= datetime('now','-1 day')",
  ).first<{ n: number }>();
  let allowance = Math.max(0, cap - Number(sentToday?.n ?? 0));
  if (allowance === 0) return { attempted: 0, sent: 0 };

  const rows = await env.DB.prepare(
    `SELECT o.*, d.buyer_name,d.buyer_country,d.buyer_email,d.description,d.quantity AS quantity_requested,
            d.unit,d.source_ref,d.source_url,s.supplier_name,s.supplier_country,s.source_url AS supplier_source_url
     FROM commerce_opportunities o
     JOIN commerce_demands d ON d.demand_id=o.demand_id
     JOIN commerce_offers s ON s.offer_id=o.offer_id
     LEFT JOIN commerce_outreach x ON x.opportunity_id=o.opportunity_id AND x.recipient=d.buyer_email
     WHERE o.status='READY' AND d.buyer_email IS NOT NULL AND x.outreach_id IS NULL
     ORDER BY o.score DESC,o.net_profit_usd DESC LIMIT ?`,
  ).bind(allowance).all<OpportunityRow>();

  let attempted = 0;
  let sent = 0;
  for (const row of rows.results ?? []) {
    attempted += 1;
    const result = await outreachOpportunity(env, row.opportunity_id);
    if (result.status === 200) sent += 1;
    allowance -= 1;
    if (allowance <= 0) break;
  }
  return { attempted, sent };
}

async function outreachOpportunity(env: GlobalCommerceEnv, opportunityId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!env.EMAIL) return { status: 503, body: { error: "email_sending_not_configured" } };
  const row = await env.DB.prepare(
    `SELECT o.*, d.buyer_name,d.buyer_country,d.buyer_email,d.description,d.quantity AS quantity_requested,
            d.unit,d.source_ref,d.source_url,s.supplier_name,s.supplier_country,s.source_url AS supplier_source_url
     FROM commerce_opportunities o
     JOIN commerce_demands d ON d.demand_id=o.demand_id
     JOIN commerce_offers s ON s.offer_id=o.offer_id
     WHERE o.opportunity_id=?`,
  ).bind(opportunityId).first<OpportunityRow>();
  if (!row) return { status: 404, body: { error: "opportunity_not_found" } };
  if (row.status !== "READY") return { status: 409, body: { error: "opportunity_not_ready", reason: row.rejection_reason } };
  const recipient = cleanEmail(row.buyer_email);
  if (!recipient) return { status: 409, body: { error: "buyer_email_missing" } };

  const existing = await env.DB.prepare(
    "SELECT outreach_id,state FROM commerce_outreach WHERE opportunity_id=? AND recipient=?",
  ).bind(opportunityId, recipient).first<{ outreach_id: string; state: string }>();
  if (existing?.state === "SENT") return { status: 200, body: { sent: true, duplicate: true } };

  const ref = clean(row.source_ref, 160) || opportunityId.slice(0, 12);
  const subject = `Quotation availability — ${ref}`;
  const quantityText = `${round2(Number(row.quantity_requested ?? row.quantity))}${row.unit ? ` ${row.unit}` : ""}`;
  const body = [
    `Hello${row.buyer_name ? ` ${row.buyer_name}` : ""},`,
    "",
    `We are responding to your published requirement ${ref} for ${clean(row.description, 500)}.`,
    `Quantity: ${quantityText}.`,
    `Our current commercial ceiling for this requirement is USD ${round2(row.revenue_usd).toFixed(2)} total, subject to final confirmation of specification, destination, availability and Incoterms.`,
    "",
    "We can proceed on a back-to-back supply basis once the exact specification and payment terms are confirmed. We do not represent stock as owned by XGuard; supply is conditional on the verified upstream inventory remaining available at order confirmation.",
    "",
    "If the requirement is still open, please confirm the exact delivery location, accepted Incoterm and whether advance payment / funded escrow is acceptable. We will return the final firm quotation electronically.",
    "",
    "Regards,",
    "XGuard Global Commerce",
    "info@xguardgate.com",
    "https://xguardgate.com",
  ].join("\n").slice(0, MAX_BODY);

  const outreachId = existing?.outreach_id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  if (!existing) {
    await env.DB.prepare(
      "INSERT INTO commerce_outreach(outreach_id,opportunity_id,recipient,subject,body,state,created_at) VALUES(?,?,?,?,?,'QUEUED',?)",
    ).bind(outreachId, opportunityId, recipient, subject, body, now).run();
  }

  try {
    const provider = await env.EMAIL.send({
      to: recipient,
      from: { email: "info@xguardgate.com", name: "XGuard Global Commerce" },
      subject,
      text: body,
    });
    const providerId = providerMessageId(provider);
    await env.DB.prepare(
      "UPDATE commerce_outreach SET state='SENT',provider_message_id=?,sent_at=? WHERE outreach_id=?",
    ).bind(providerId, now, outreachId).run();
    return { status: 200, body: { sent: true, outreachId, recipient } };
  } catch (error) {
    await env.DB.prepare("UPDATE commerce_outreach SET state='FAILED' WHERE outreach_id=?").bind(outreachId).run();
    return { status: 502, body: { error: "outreach_failed", detail: clean(error instanceof Error ? error.message : String(error), 300) } };
  }
}

function normalizeDemand(raw: DemandInput): { ok: true; value: ReturnType<typeof rowToDemand> } | { ok: false; error: string } {
  const now = new Date().toISOString();
  const sourceUrl = safeHttpUrl(raw.sourceUrl);
  const productKey = canonicalKey(raw.productKey);
  const description = clean(raw.description, 3000);
  const quantity = positiveNumber(raw.quantity, 1);
  if (!sourceUrl) return { ok: false, error: "demand_source_url_required" };
  if (!productKey) return { ok: false, error: "demand_product_key_required" };
  if (!description) return { ok: false, error: "demand_description_required" };
  const seed = `${sourceUrl}|${clean(raw.sourceRef, 500)}|${productKey}|${quantity}`;
  return { ok: true, value: {
    id: clean(raw.id, 200) || simpleStableId("d", seed),
    sourceName: clean(raw.sourceName, 200) || new URL(sourceUrl).hostname,
    sourceUrl, sourceRef: clean(raw.sourceRef, 500) || null,
    buyerName: clean(raw.buyerName, 300) || null, buyerCountry: clean(raw.buyerCountry, 160) || null,
    buyerEmail: cleanEmail(raw.buyerEmail) || null, productKey, description, quantity,
    unit: clean(raw.unit, 80) || null, targetUnitPriceUsd: optionalPositive(raw.targetUnitPriceUsd),
    deadlineAt: isoDate(raw.deadlineAt), paymentTerms: clean(raw.paymentTerms, 1000) || null,
    evidenceLevel: boundedInt(raw.evidenceLevel, 50, 0, 100), status: "OPEN",
    observedAt: isoDate(raw.observedAt) ?? now, createdAt: now, updatedAt: now,
  } };
}

function normalizeOffer(raw: OfferInput): { ok: true; value: ReturnType<typeof rowToOffer> } | { ok: false; error: string } {
  const now = new Date().toISOString();
  const sourceUrl = safeHttpUrl(raw.sourceUrl);
  const productKey = canonicalKey(raw.productKey);
  const description = clean(raw.description, 3000);
  const unitPriceUsd = optionalPositive(raw.unitPriceUsd);
  if (!sourceUrl) return { ok: false, error: "offer_source_url_required" };
  if (!productKey) return { ok: false, error: "offer_product_key_required" };
  if (!description) return { ok: false, error: "offer_description_required" };
  if (unitPriceUsd === null) return { ok: false, error: "offer_unit_price_required" };
  const seed = `${sourceUrl}|${productKey}|${unitPriceUsd}`;
  return { ok: true, value: {
    id: clean(raw.id, 200) || simpleStableId("s", seed),
    sourceName: clean(raw.sourceName, 200) || new URL(sourceUrl).hostname,
    sourceUrl, supplierName: clean(raw.supplierName, 300) || null,
    supplierCountry: clean(raw.supplierCountry, 160) || null, supplierEmail: cleanEmail(raw.supplierEmail) || null,
    productKey, description, quantityAvailable: optionalPositive(raw.quantityAvailable), unitPriceUsd,
    shippingUsd: nonNegative(raw.shippingUsd), customsUsd: nonNegative(raw.customsUsd), taxUsd: nonNegative(raw.taxUsd),
    paymentFeeUsd: nonNegative(raw.paymentFeeUsd), insuranceUsd: nonNegative(raw.insuranceUsd), otherCostUsd: nonNegative(raw.otherCostUsd),
    leadTimeDays: raw.leadTimeDays === undefined ? null : boundedInt(raw.leadTimeDays, 0, 0, 3650),
    stockVerified: raw.stockVerified === true, supplierScore: boundedInt(raw.supplierScore, 40, 0, 100),
    expiresAt: isoDate(raw.expiresAt), observedAt: isoDate(raw.observedAt) ?? now, createdAt: now, updatedAt: now,
  } };
}

function normalizeFeed(raw: FeedInput): { id: string; name: string; url: string; format: string; enabled: boolean } | null {
  const url = safeHttpUrl(raw.url);
  if (!url || new URL(url).protocol !== "https:") return null;
  const format = clean(raw.format, 20).toLowerCase() || "json";
  if (format !== "json") return null;
  return {
    id: clean(raw.id, 200) || simpleStableId("feed", url),
    name: clean(raw.name, 200) || new URL(url).hostname,
    url, format, enabled: raw.enabled !== false,
  };
}

function rowToDemand(row: Record<string, unknown>) {
  return {
    id: clean(row.demand_id ?? row.id, 200), sourceName: clean(row.demand_source_name ?? row.source_name, 200),
    sourceUrl: clean(row.demand_source_url ?? row.source_url, 2000), sourceRef: clean(row.source_ref, 500) || null,
    buyerName: clean(row.buyer_name, 300) || null, buyerCountry: clean(row.buyer_country, 160) || null,
    buyerEmail: cleanEmail(row.buyer_email) || null, productKey: canonicalKey(row.product_key),
    description: clean(row.demand_description ?? row.description, 3000), quantity: positiveNumber(row.quantity, 1),
    unit: clean(row.unit, 80) || null, targetUnitPriceUsd: optionalPositive(row.target_unit_price_usd),
    deadlineAt: isoDate(row.deadline_at), paymentTerms: clean(row.payment_terms, 1000) || null,
    evidenceLevel: boundedInt(row.evidence_level, 50, 0, 100), status: "OPEN",
    observedAt: isoDate(row.demand_observed_at ?? row.observed_at) ?? new Date().toISOString(),
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

function rowToOffer(row: Record<string, unknown>) {
  return {
    id: clean(row.offer_id ?? row.id, 200), sourceName: clean(row.offer_source_name ?? row.source_name, 200),
    sourceUrl: clean(row.offer_source_url ?? row.source_url, 2000), supplierName: clean(row.supplier_name, 300) || null,
    supplierCountry: clean(row.supplier_country, 160) || null, supplierEmail: cleanEmail(row.supplier_email) || null,
    productKey: canonicalKey(row.product_key), description: clean(row.offer_description ?? row.description, 3000),
    quantityAvailable: optionalPositive(row.quantity_available), unitPriceUsd: positiveNumber(row.unit_price_usd, 0),
    shippingUsd: nonNegative(row.shipping_usd), customsUsd: nonNegative(row.customs_usd), taxUsd: nonNegative(row.tax_usd),
    paymentFeeUsd: nonNegative(row.payment_fee_usd), insuranceUsd: nonNegative(row.insurance_usd), otherCostUsd: nonNegative(row.other_cost_usd),
    leadTimeDays: row.lead_time_days == null ? null : boundedInt(row.lead_time_days, 0, 0, 3650),
    stockVerified: Number(row.stock_verified ?? 0) === 1, supplierScore: boundedInt(row.supplier_score, 40, 0, 100),
    expiresAt: isoDate(row.expires_at), observedAt: isoDate(row.offer_observed_at ?? row.observed_at) ?? new Date().toISOString(),
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

function restrictedGoods(value: string): boolean {
  return /(firearm|ammunition|explosive|weapon|missile|drone weapon|narcotic|cocaine|heroin|fentanyl|counterfeit|stolen goods|human organ|sanctioned military)/i.test(value);
}

function jurisdictionGate(buyer: string | null, supplier: string | null): boolean {
  const value = `${buyer ?? ""} ${supplier ?? ""}`.toLowerCase();
  return !/(north korea|dprk)/i.test(value);
}

function minProfit(env: GlobalCommerceEnv): number {
  return Math.max(0, finiteNumber(env.XGUARD_COMMERCE_MIN_PROFIT_USD, DEFAULT_MIN_PROFIT_USD));
}
function minMargin(env: GlobalCommerceEnv): number {
  return boundedInt(env.XGUARD_COMMERCE_MIN_MARGIN_BPS, DEFAULT_MIN_MARGIN_BPS, 0, 9500);
}
function ageHours(value: string): number {
  const ms = Date.now() - new Date(value).getTime();
  return Number.isFinite(ms) ? Math.max(0, ms / 3_600_000) : Number.POSITIVE_INFINITY;
}
function truthy(value: unknown): boolean { return /^(1|true|yes|on)$/i.test(String(value ?? "").trim()); }
function positiveNumber(value: unknown, fallback: number): number { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : fallback; }
function optionalPositive(value: unknown): number | null { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : null; }
function nonNegative(value: unknown): number { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : 0; }
function finiteNumber(value: unknown, fallback: number): number { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function boundedInt(value: unknown, fallback: number, min: number, max: number): number { const n = Math.round(finiteNumber(value, fallback)); return Math.max(min, Math.min(max, n)); }
function round2(value: number): number { return Math.round((value + Number.EPSILON) * 100) / 100; }
function canonicalKey(value: unknown): string { return clean(value, 300).toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
function clean(value: unknown, max: number): string { return typeof value === "string" ? value.trim().slice(0, max) : value == null ? "" : String(value).trim().slice(0, max); }
function cleanEmail(value: unknown): string { const email = clean(value, 320).toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ""; }
function isoDate(value: unknown): string | null { const s = clean(value, 100); if (!s) return null; const d = new Date(s); return Number.isFinite(d.getTime()) ? d.toISOString() : null; }
function safeHttpUrl(value: unknown): string { try { const u = new URL(clean(value, 2000)); return (u.protocol === "https:" || u.protocol === "http:") && !unsafeHost(u.hostname) ? u.toString() : ""; } catch { return ""; } }
function unsafeHost(host: string): boolean { const h = host.toLowerCase(); return h === "localhost" || h.endsWith(".local") || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h); }
function simpleStableId(prefix: string, value: string): string { let hash = 2166136261; for (let i=0;i<value.length;i+=1) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); } return `${prefix}_${(hash >>> 0).toString(16).padStart(8,"0")}`; }
async function deterministicId(prefix: string, value: string): Promise<string> { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return `${prefix}_${Array.from(new Uint8Array(digest)).slice(0,16).map(v=>v.toString(16).padStart(2,"0")).join("")}`; }
function providerMessageId(value: unknown): string | null { if (!value || typeof value !== "object") return null; const record = value as Record<string, unknown>; return clean(record.messageId ?? record.message_id ?? record.id, 500) || null; }
async function readJson<T>(request: Request): Promise<T | null> { try { return await request.json() as T; } catch { return null; } }
async function isAdmin(request: Request, env: GlobalCommerceEnv): Promise<boolean> {
  const expected = clean(env.XGUARD_ADMIN_TOKEN_SHA256, 64).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) return false;
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return false;
  const token = authorization.slice(7).trim();
  if (!token) return false;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const actual = Array.from(new Uint8Array(digest)).map(v=>v.toString(16).padStart(2,"0")).join("");
  return actual === expected;
}
function json(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }); }
