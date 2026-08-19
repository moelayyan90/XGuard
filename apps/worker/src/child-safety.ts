import { authenticateMerchant } from "./mainnet-billing.js";

const MAX_TEXT = 20_000;
const EVENT_ID = /^[A-Za-z0-9._:-]{8,160}$/;
const SESSION_ID = /^[A-Za-z0-9._:-]{8,160}$/;

const SCAN_FEES_MICRO_USD = {
  message: 5_000,
  chat_window: 10_000,
  ad_text: 10_000,
  image_description: 15_000,
  video_transcript: 20_000,
} as const;

type ContentKind = keyof typeof SCAN_FEES_MICRO_USD;
type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type PrimaryAction =
  "ALLOW" | "WARN" | "BLUR" | "BLOCK" | "FREEZE_CHAT" | "ESCALATE";

type Category =
  | "grooming"
  | "sexual_solicitation"
  | "explicit_sexual_content"
  | "request_for_sexual_image"
  | "coercion_or_sextortion"
  | "secrecy_manipulation"
  | "age_inappropriate_contact"
  | "off_platform_migration"
  | "meetup_request"
  | "sexualized_ad"
  | "harassment"
  | "unknown";

interface ChildSafetyEnv {
  DB: D1Database;
  AI: {
    run(model: string, input: unknown): Promise<unknown>;
  };
}

interface ScanInput {
  eventId?: string;
  riskSessionId?: string;
  contentKind?: string;
  language?: string;
  childLikely?: boolean;
  childAgeBand?: string;
  text?: string;
  signals?: string[];
}

interface AiDecision {
  riskLevel: RiskLevel;
  confidence: number;
  categories: Category[];
  rationale: string;
}

interface ChargeRow {
  charge_id: string;
  merchant_id: string;
  external_event_id: string;
  amount_micro_usd: number;
  state: "HELD" | "EARNED" | "RELEASED";
  operation_id: string;
}

const COUNTRY_HELP: Record<
  string,
  { childHelpline?: string; label: string; source: string }
> = {
  jordan: {
    childHelpline: "110",
    label: "Jordan River Foundation 110 Helpline",
    source: "Child Helpline International",
  },
  "saudi arabia": {
    childHelpline: "116111",
    label: "Saudi Child Helpline",
    source: "Child Helpline International",
  },
  "united arab emirates": {
    childHelpline: "800 700",
    label: "UAE Child Helpline",
    source: "Child Helpline International",
  },
  uae: {
    childHelpline: "800 700",
    label: "UAE Child Helpline",
    source: "Child Helpline International",
  },
  kuwait: {
    childHelpline: "147",
    label: "Help Hotline 147",
    source: "Child Helpline International",
  },
  qatar: {
    childHelpline: "919",
    label: "Qatar Hotline 919",
    source: "Child Helpline International",
  },
  palestine: {
    childHelpline: "164",
    label: "Sawa 164",
    source: "Child Helpline International",
  },
  sudan: {
    childHelpline: "9696",
    label: "Child Helpline Sudan",
    source: "Child Helpline International",
  },
  france: {
    childHelpline: "119",
    label: "Allô Enfance en Danger",
    source: "Child Helpline International",
  },
  bulgaria: {
    childHelpline: "116 111",
    label: "National Telephone Line for Children",
    source: "Child Helpline International",
  },
  latvia: {
    childHelpline: "116 111",
    label: "Child and Adolescent Helpline",
    source: "Child Helpline International",
  },
  moldova: {
    childHelpline: "116111",
    label: "Telefonul Copilului Moldova",
    source: "Child Helpline International",
  },
  malawi: {
    childHelpline: "116",
    label: "Tithandizane Helpline",
    source: "Child Helpline International",
  },
  uganda: {
    childHelpline: "116",
    label: "Sauti 116",
    source: "Child Helpline International",
  },
  bangladesh: {
    childHelpline: "1098",
    label: "Bangladesh Child Helpline",
    source: "Child Helpline International",
  },
  maldives: {
    childHelpline: "1412",
    label: "Child Help Line Maldives",
    source: "Child Helpline International",
  },
  mongolia: {
    childHelpline: "108",
    label: "Child Helpline Mongolia",
    source: "Child Helpline International",
  },
  nepal: {
    childHelpline: "1098",
    label: "Child Helpline Nepal",
    source: "Child Helpline International",
  },
  "sri lanka": {
    childHelpline: "1929",
    label: "Childline Sri Lanka",
    source: "Child Helpline International",
  },
  taiwan: {
    childHelpline: "113",
    label: "Protection Hotline 113",
    source: "Child Helpline International",
  },
  vietnam: {
    childHelpline: "111",
    label: "National Hotline for Child Protection",
    source: "Child Helpline International",
  },
  colombia: {
    childHelpline: "141",
    label: "ICBF Colombia Línea 141",
    source: "Child Helpline International",
  },
};

export async function childSafetyResponse(
  request: Request,
  env: ChildSafetyEnv,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (
    request.method === "GET" &&
    ["/", "/child-safety", "/protect", "/safety"].includes(url.pathname)
  ) {
    return htmlResponse(portalHtml());
  }

  if (request.method === "GET" && url.pathname === "/v1/child-safety/catalog") {
    return json({
      product: "XGuard Child Safety Control Layer",
      buyer:
        "Online platforms, schools, games, communities, telecom products, ad-tech and government/NGO child-safety programmes",
      billingModel: "per analyzed safety event",
      pricing: Object.entries(SCAN_FEES_MICRO_USD).map(([kind, microUsd]) => ({
        contentKind: kind,
        usd: (microUsd / 1_000_000).toFixed(3),
        microUsd,
      })),
      actions: ["ALLOW", "WARN", "BLUR", "BLOCK", "FREEZE_CHAT", "ESCALATE"],
      categories: [
        "grooming",
        "sexual_solicitation",
        "explicit_sexual_content",
        "request_for_sexual_image",
        "coercion_or_sextortion",
        "secrecy_manipulation",
        "age_inappropriate_contact",
        "off_platform_migration",
        "meetup_request",
        "sexualized_ad",
        "harassment",
      ],
      privacy:
        "XGuard stores risk metadata and hashes, not raw message bodies, in the child-safety scan ledger.",
    });
  }

  if (
    request.method === "GET" &&
    url.pathname === "/v1/child-safety/reporting"
  ) {
    return reportingResponse(url.searchParams.get("country") ?? "");
  }

  if (request.method === "POST" && url.pathname === "/v1/child-safety/scan") {
    return scan(request, env);
  }

  if (
    request.method === "OPTIONS" &&
    url.pathname.startsWith("/v1/child-safety/")
  ) {
    return new Response(null, { status: 204, headers: apiHeaders() });
  }

  return null;
}

async function scan(request: Request, env: ChildSafetyEnv): Promise<Response> {
  const merchant = await authenticateRequest(request, env.DB);
  if (merchant === null) return json({ error: "unauthorized" }, 401);

  const input = await readScanInput(request);
  if (input instanceof Response) return input;

  const eventId = clean(input.eventId, 160);
  const riskSessionId = clean(input.riskSessionId, 160);
  const contentKind = clean(input.contentKind, 40) as ContentKind;
  const text = clean(input.text, MAX_TEXT);
  if (!EVENT_ID.test(eventId)) return json({ error: "invalid_event_id" }, 400);
  if (riskSessionId && !SESSION_ID.test(riskSessionId))
    return json({ error: "invalid_risk_session_id" }, 400);
  if (!(contentKind in SCAN_FEES_MICRO_USD))
    return json({ error: "unsupported_content_kind" }, 400);
  if (!text) return json({ error: "text_required" }, 400);

  const feeMicroUsd = SCAN_FEES_MICRO_USD[contentKind];
  const existing = await priorScan(env.DB, merchant.merchantId, eventId);
  if (existing !== null) {
    return json({ ...existing, idempotentReplay: true });
  }

  let charge: ChargeRow;
  try {
    charge = await holdCharge(
      env.DB,
      merchant.merchantId,
      eventId,
      feeMicroUsd,
    );
  } catch (error) {
    if (errorCode(error) === "insufficient_service_balance") {
      return json(
        {
          error: "payment_required",
          feeMicroUsd,
          feeUsd: (feeMicroUsd / 1_000_000).toFixed(3),
          topUp: "/v1/topups/intents",
        },
        402,
      );
    }
    return json(
      { error: "billing_unavailable", detail: errorCode(error) },
      503,
    );
  }

  if (charge.state === "EARNED") {
    const replay = await priorScan(env.DB, merchant.merchantId, eventId);
    return replay === null
      ? json({ error: "scan_result_unavailable" }, 409)
      : json({ ...replay, idempotentReplay: true });
  }
  if (charge.state === "RELEASED") {
    return json({ error: "released_event_id_must_not_be_reused" }, 409);
  }

  const sessionHash = riskSessionId ? await sha256(riskSessionId) : "";
  const priorHighRisk = sessionHash
    ? await recentHighRiskCount(env.DB, merchant.merchantId, sessionHash)
    : 0;

  try {
    const ai = await classifyWithAi(env, input, priorHighRisk);
    const decision = deterministicPolicy(ai, input, priorHighRisk);

    await persistResultAndEarn(
      env.DB,
      merchant.merchantId,
      eventId,
      sessionHash,
      contentKind,
      decision,
      feeMicroUsd,
      charge,
    );

    return json({
      eventId,
      contentKind,
      riskLevel: decision.riskLevel,
      confidence: decision.confidence,
      categories: decision.categories,
      primaryAction: decision.primaryAction,
      enforcement: decision.enforcement,
      rationale: decision.rationale,
      priorHighRiskEventsInSession: priorHighRisk,
      feeUsd: (feeMicroUsd / 1_000_000).toFixed(3),
      rawContentStored: false,
      reporting:
        decision.riskLevel === "CRITICAL" ? globalReportingLinks() : undefined,
      integrationNote:
        "FREEZE_CHAT/BLOCK/BLUR actions are control decisions. The integrated host platform must enforce them in its own product.",
    });
  } catch (error) {
    await releaseCharge(env.DB, merchant.merchantId, eventId).catch(
      () => undefined,
    );
    console.error(
      JSON.stringify({
        event: "child_safety_scan_failed",
        merchantId: merchant.merchantId,
        eventId,
        detail: errorCode(error),
      }),
    );
    return json({ error: "scan_unavailable", chargeState: "released" }, 503);
  }
}

async function classifyWithAi(
  env: ChildSafetyEnv,
  input: ScanInput,
  priorHighRisk: number,
): Promise<AiDecision> {
  const prompt = `Classify this child-safety event. Return JSON only.

The content may be in any language. Focus on protecting children and minors from sexual grooming, sexual solicitation, requests for intimate images, coercion/sextortion, secrecy manipulation, age-inappropriate contact, attempts to move a minor to private/off-platform channels, in-person meetup pressure, explicit sexual content, sexualized advertising, and harassment.

Do not quote or reproduce explicit sexual content. Do not provide instructions that help an offender evade detection.

Input context:
contentKind=${clean(input.contentKind, 40)}
childLikely=${input.childLikely === true}
childAgeBand=${clean(input.childAgeBand, 40) || "unknown"}
language=${clean(input.language, 80) || "unknown"}
priorHighRiskEventsInSession=${priorHighRisk}
signals=${
    Array.isArray(input.signals)
      ? input.signals
          .slice(0, 20)
          .map((v) => clean(v, 120))
          .filter(Boolean)
          .join(", ")
      : "none"
  }

Content:
${clean(input.text, MAX_TEXT)}

Return exactly this JSON shape:
{"riskLevel":"LOW|MEDIUM|HIGH|CRITICAL","confidence":0.0,"categories":["category"],"rationale":"short non-explicit explanation"}
Allowed categories: grooming, sexual_solicitation, explicit_sexual_content, request_for_sexual_image, coercion_or_sextortion, secrecy_manipulation, age_inappropriate_contact, off_platform_migration, meetup_request, sexualized_ad, harassment, unknown.`;

  const result = await env.AI.run("@cf/zai-org/glm-4.7-flash", {
    messages: [
      {
        role: "system",
        content:
          "You are a child-safety classification engine. Output JSON only. Err toward safety when a minor may be at risk, but do not invent facts.",
      },
      { role: "user", content: prompt },
    ],
    max_tokens: 420,
    temperature: 0.1,
  });

  const raw = aiText(result);
  const parsed = parseDecision(raw);
  return parsed;
}

function deterministicPolicy(
  ai: AiDecision,
  input: ScanInput,
  priorHighRisk: number,
): AiDecision & {
  primaryAction: PrimaryAction;
  enforcement: Record<string, boolean>;
} {
  const categories = new Set(ai.categories);
  const childLikely = input.childLikely === true;
  let riskLevel = ai.riskLevel;

  const severe =
    categories.has("coercion_or_sextortion") ||
    categories.has("request_for_sexual_image") ||
    categories.has("sexual_solicitation");
  const groomingChain =
    categories.has("grooming") &&
    (categories.has("secrecy_manipulation") ||
      categories.has("off_platform_migration") ||
      categories.has("meetup_request"));

  if (childLikely && severe) riskLevel = "CRITICAL";
  else if (childLikely && groomingChain) riskLevel = "CRITICAL";
  else if (childLikely && categories.has("explicit_sexual_content"))
    riskLevel = maxRisk(riskLevel, "HIGH");
  else if (categories.has("sexualized_ad"))
    riskLevel = maxRisk(riskLevel, "HIGH");

  if (priorHighRisk >= 2 && riskLevel !== "LOW") riskLevel = "CRITICAL";
  else if (priorHighRisk >= 1 && riskLevel === "MEDIUM") riskLevel = "HIGH";

  const primaryAction: PrimaryAction =
    riskLevel === "CRITICAL"
      ? "FREEZE_CHAT"
      : riskLevel === "HIGH"
        ? "BLOCK"
        : riskLevel === "MEDIUM"
          ? categories.has("explicit_sexual_content")
            ? "BLUR"
            : "WARN"
          : "ALLOW";

  return {
    ...ai,
    riskLevel,
    primaryAction,
    enforcement: {
      blockContent: riskLevel === "HIGH" || riskLevel === "CRITICAL",
      blurMedia: riskLevel === "MEDIUM" || riskLevel === "HIGH",
      freezeConversation: riskLevel === "CRITICAL",
      preventFurtherContact: riskLevel === "CRITICAL",
      suppressAd: categories.has("sexualized_ad") && riskLevel !== "LOW",
      disableAutoplay:
        categories.has("explicit_sexual_content") && riskLevel !== "LOW",
      requireHumanSafetyReview:
        riskLevel === "HIGH" || riskLevel === "CRITICAL",
      surfaceReportFlow: riskLevel === "HIGH" || riskLevel === "CRITICAL",
      preserveClientSideEvidence: riskLevel === "CRITICAL",
    },
  };
}

function reportingResponse(countryRaw: string): Response {
  const key = countryRaw.trim().toLowerCase();
  const local = COUNTRY_HELP[key];
  return json({
    country: countryRaw || null,
    local: local ?? null,
    global: globalReportingLinks(),
    coverageNote:
      "Child Helpline International maintains 150+ members across 130+ countries and territories. INHOPE provides country-based CSAM reporting through its global hotline network. Where XGuard does not yet have a locally verified direct number, use those official country selectors rather than an unverified number.",
    emergency:
      "If a child is in immediate physical danger, contact the local emergency service or police for the child's current location.",
  });
}

function globalReportingLinks(): Array<Record<string, string>> {
  return [
    {
      name: "Child Helpline International",
      purpose: "Find a child helpline by country",
      url: "https://childhelplineinternational.org/helplines/",
    },
    {
      name: "INHOPE",
      purpose:
        "Find a country hotline to report suspected child sexual abuse material",
      url: "https://www.inhope.org/",
    },
    {
      name: "NCMEC CyberTipline",
      purpose:
        "Report suspected child sexual exploitation; reports can be referred internationally",
      url: "https://report.cybertip.org/",
    },
  ];
}

async function authenticateRequest(
  request: Request,
  db: D1Database,
): Promise<{ merchantId: string; name: string } | null> {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return authenticateMerchant(db, match[1].trim());
}

async function readScanInput(request: Request): Promise<ScanInput | Response> {
  const length = Number.parseInt(
    request.headers.get("content-length") ?? "0",
    10,
  );
  if (Number.isFinite(length) && length > 80_000)
    return json({ error: "request_too_large" }, 413);
  try {
    const value: unknown = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value))
      return json({ error: "invalid_json_object" }, 400);
    return value as ScanInput;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
}

async function holdCharge(
  db: D1Database,
  merchantId: string,
  eventId: string,
  amountMicroUsd: number,
): Promise<ChargeRow> {
  const existing = await charge(db, merchantId, eventId);
  if (existing !== null) return existing;

  const chargeId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        "INSERT OR IGNORE INTO child_safety_scan_charges(charge_id,merchant_id,external_event_id,amount_micro_usd,state,operation_id,created_at,updated_at) SELECT ?,?,?,?,'HELD',?,?,? FROM merchants WHERE merchant_id=? AND active=1 AND available_balance_micro_usd>=?",
      )
      .bind(
        chargeId,
        merchantId,
        eventId,
        amountMicroUsd,
        operationId,
        now,
        now,
        merchantId,
        amountMicroUsd,
      ),
    db
      .prepare(
        "UPDATE merchants SET available_balance_micro_usd=available_balance_micro_usd-?,held_balance_micro_usd=held_balance_micro_usd+? WHERE merchant_id=? AND active=1 AND available_balance_micro_usd>=? AND EXISTS(SELECT 1 FROM child_safety_scan_charges WHERE merchant_id=? AND external_event_id=? AND state='HELD' AND operation_id=?)",
      )
      .bind(
        amountMicroUsd,
        amountMicroUsd,
        merchantId,
        amountMicroUsd,
        merchantId,
        eventId,
        operationId,
      ),
  ]);

  const created = await charge(db, merchantId, eventId);
  if (created === null) throw new Error("insufficient_service_balance");
  return created;
}

async function persistResultAndEarn(
  db: D1Database,
  merchantId: string,
  eventId: string,
  sessionHash: string,
  contentKind: ContentKind,
  decision: AiDecision & { primaryAction: PrimaryAction },
  feeMicroUsd: number,
  held: ChargeRow,
): Promise<void> {
  if (held.state !== "HELD") throw new Error("charge_not_held");
  const now = new Date().toISOString();
  const operationId = crypto.randomUUID();
  const ledgerEvent = `child-safety:${held.charge_id}`;
  await db.batch([
    db
      .prepare(
        "INSERT OR IGNORE INTO child_safety_scans(scan_id,merchant_id,external_event_id,risk_session_hash,content_kind,risk_level,action,categories_json,fee_micro_usd,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        crypto.randomUUID(),
        merchantId,
        eventId,
        sessionHash || null,
        contentKind,
        decision.riskLevel,
        decision.primaryAction,
        JSON.stringify(decision.categories),
        feeMicroUsd,
        now,
      ),
    db
      .prepare(
        "UPDATE child_safety_scan_charges SET state='EARNED',operation_id=?,updated_at=? WHERE charge_id=? AND merchant_id=? AND external_event_id=? AND state='HELD'",
      )
      .bind(operationId, now, held.charge_id, merchantId, eventId),
    db
      .prepare(
        "UPDATE merchants SET held_balance_micro_usd=held_balance_micro_usd-? WHERE merchant_id=? AND held_balance_micro_usd>=? AND EXISTS(SELECT 1 FROM child_safety_scan_charges WHERE charge_id=? AND merchant_id=? AND state='EARNED' AND operation_id=?)",
      )
      .bind(
        feeMicroUsd,
        merchantId,
        feeMicroUsd,
        held.charge_id,
        merchantId,
        operationId,
      ),
    db
      .prepare(
        "INSERT OR IGNORE INTO ledger_entries(entry_id,event_id,account,side,amount_micro_usd,created_at) SELECT ?,?,'UNEARNED_LIABILITY','DEBIT',?,? WHERE EXISTS(SELECT 1 FROM child_safety_scan_charges WHERE charge_id=? AND merchant_id=? AND state='EARNED' AND operation_id=?)",
      )
      .bind(
        `${ledgerEvent}:debit`,
        ledgerEvent,
        feeMicroUsd,
        now,
        held.charge_id,
        merchantId,
        operationId,
      ),
    db
      .prepare(
        "INSERT OR IGNORE INTO ledger_entries(entry_id,event_id,account,side,amount_micro_usd,created_at) SELECT ?,?,'EARNED_REVENUE','CREDIT',?,? WHERE EXISTS(SELECT 1 FROM child_safety_scan_charges WHERE charge_id=? AND merchant_id=? AND state='EARNED' AND operation_id=?)",
      )
      .bind(
        `${ledgerEvent}:credit`,
        ledgerEvent,
        feeMicroUsd,
        now,
        held.charge_id,
        merchantId,
        operationId,
      ),
  ]);

  const final = await charge(db, merchantId, eventId);
  if (final?.state !== "EARNED") throw new Error("charge_transition_failed");
}

async function releaseCharge(
  db: D1Database,
  merchantId: string,
  eventId: string,
): Promise<void> {
  const held = await charge(db, merchantId, eventId);
  if (held === null || held.state !== "HELD") return;
  const operationId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        "UPDATE child_safety_scan_charges SET state='RELEASED',operation_id=?,updated_at=? WHERE charge_id=? AND merchant_id=? AND state='HELD'",
      )
      .bind(operationId, now, held.charge_id, merchantId),
    db
      .prepare(
        "UPDATE merchants SET available_balance_micro_usd=available_balance_micro_usd+?,held_balance_micro_usd=held_balance_micro_usd-? WHERE merchant_id=? AND held_balance_micro_usd>=? AND EXISTS(SELECT 1 FROM child_safety_scan_charges WHERE charge_id=? AND merchant_id=? AND state='RELEASED' AND operation_id=?)",
      )
      .bind(
        held.amount_micro_usd,
        held.amount_micro_usd,
        merchantId,
        held.amount_micro_usd,
        held.charge_id,
        merchantId,
        operationId,
      ),
  ]);
}

async function charge(
  db: D1Database,
  merchantId: string,
  eventId: string,
): Promise<ChargeRow | null> {
  return db
    .prepare(
      "SELECT charge_id,merchant_id,external_event_id,amount_micro_usd,state,operation_id FROM child_safety_scan_charges WHERE merchant_id=? AND external_event_id=?",
    )
    .bind(merchantId, eventId)
    .first<ChargeRow>();
}

async function priorScan(
  db: D1Database,
  merchantId: string,
  eventId: string,
): Promise<Record<string, unknown> | null> {
  const row = await db
    .prepare(
      "SELECT external_event_id,content_kind,risk_level,action,categories_json,fee_micro_usd,created_at FROM child_safety_scans WHERE merchant_id=? AND external_event_id=?",
    )
    .bind(merchantId, eventId)
    .first<{
      external_event_id: string;
      content_kind: string;
      risk_level: string;
      action: string;
      categories_json: string;
      fee_micro_usd: number;
      created_at: string;
    }>();
  if (row === null) return null;
  return {
    eventId: row.external_event_id,
    contentKind: row.content_kind,
    riskLevel: row.risk_level,
    primaryAction: row.action,
    categories: safeJsonArray(row.categories_json),
    feeUsd: (row.fee_micro_usd / 1_000_000).toFixed(3),
    createdAt: row.created_at,
    rawContentStored: false,
  };
}

async function recentHighRiskCount(
  db: D1Database,
  merchantId: string,
  sessionHash: string,
): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS count FROM child_safety_scans WHERE merchant_id=? AND risk_session_hash=? AND risk_level IN ('HIGH','CRITICAL') AND created_at>=?",
    )
    .bind(merchantId, sessionHash, since)
    .first<{ count: number }>();
  return Math.max(0, Number(row?.count ?? 0));
}

function parseDecision(raw: string): AiDecision {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("invalid_ai_decision");
  const parsed = JSON.parse(raw.slice(start, end + 1)) as Partial<AiDecision>;
  const riskLevel = isRiskLevel(parsed.riskLevel) ? parsed.riskLevel : "MEDIUM";
  const confidence = clamp(Number(parsed.confidence ?? 0.5), 0, 1);
  const categories = Array.isArray(parsed.categories)
    ? parsed.categories.filter(isCategory).slice(0, 8)
    : ["unknown" as Category];
  return {
    riskLevel,
    confidence,
    categories: categories.length ? categories : ["unknown"],
    rationale:
      clean(parsed.rationale, 500) ||
      "Risk classification generated from the supplied event.",
  };
}

function aiText(result: unknown): string {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return "";
  const object = result as Record<string, unknown>;
  return typeof object.response === "string" ? object.response : "";
}

function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  const rank: Record<RiskLevel, number> = {
    LOW: 0,
    MEDIUM: 1,
    HIGH: 2,
    CRITICAL: 3,
  };
  return rank[a] >= rank[b] ? a : b;
}

function isRiskLevel(value: unknown): value is RiskLevel {
  return (
    value === "LOW" ||
    value === "MEDIUM" ||
    value === "HIGH" ||
    value === "CRITICAL"
  );
}

function isCategory(value: unknown): value is Category {
  return [
    "grooming",
    "sexual_solicitation",
    "explicit_sexual_content",
    "request_for_sexual_image",
    "coercion_or_sextortion",
    "secrecy_manipulation",
    "age_inappropriate_contact",
    "off_platform_migration",
    "meetup_request",
    "sexualized_ad",
    "harassment",
    "unknown",
  ].includes(String(value));
}

function safeJsonArray(value: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function errorCode(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message.slice(0, 160)
    : "unknown_error";
}

function apiHeaders(): Headers {
  return new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "X-Content-Type-Options": "nosniff",
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: apiHeaders() });
}

function htmlResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=120",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    },
  });
}

function portalHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>XGuard — Child Safety Control Layer</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#070b12;color:#f8fafc}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 70% 0,#172554 0,transparent 36%),#070b12}header{display:flex;justify-content:space-between;align-items:center;padding:18px 5vw;border-bottom:1px solid #1f2937;background:rgba(7,11,18,.86);position:sticky;top:0;backdrop-filter:blur(16px)}.brand{font-size:25px;font-weight:950;letter-spacing:-.04em}.pill{font-size:12px;padding:7px 10px;border:1px solid #334155;border-radius:999px;color:#bfdbfe}.hero{max-width:1200px;margin:auto;padding:82px 5vw 44px}.eyebrow{font-weight:800;color:#60a5fa;text-transform:uppercase;font-size:12px;letter-spacing:.15em}.hero h1{font-size:clamp(43px,7vw,88px);line-height:.94;letter-spacing:-.06em;margin:15px 0 24px;max-width:1000px}.hero p{font-size:20px;line-height:1.6;color:#aeb8c8;max-width:820px}.control{display:inline-flex;gap:10px;flex-wrap:wrap;margin-top:18px}.control span{padding:9px 12px;border-radius:10px;background:#111827;border:1px solid #263244;font-size:13px}.grid{max-width:1200px;margin:auto;padding:22px 5vw 70px;display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px}.card{padding:22px;border:1px solid #223047;border-radius:20px;background:rgba(15,23,42,.8)}.card h2{font-size:19px;margin:0 0 9px}.card p{margin:0;color:#94a3b8;line-height:1.55}.money{max-width:1200px;margin:0 auto 80px;padding:0 5vw}.panel{padding:28px;border-radius:24px;background:#f8fafc;color:#0f172a}.panel h2{font-size:32px;margin:0 0 10px;letter-spacing:-.03em}.panel p{color:#475569;line-height:1.6}.prices{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-top:18px}.price{border:1px solid #cbd5e1;border-radius:14px;padding:15px}.price b{font-size:22px;display:block}.foot{max-width:1200px;margin:0 auto;padding:0 5vw 60px;color:#64748b;font-size:13px;line-height:1.6}@media(max-width:640px){.hero{padding-top:55px}}
</style>
</head>
<body>
<header><div class="brand">XGuard</div><div class="pill">Child Safety Control Layer</div></header>
<section class="hero"><div class="eyebrow">Protection that can enforce</div><h1>Detect. Block. Freeze. Escalate.</h1><p>XGuard gives platforms a real-time decision layer for grooming, sexual solicitation, sextortion, sexual content, unsafe ads and repeated predatory contact involving children or minors.</p><div class="control"><span>ALLOW</span><span>WARN</span><span>BLUR</span><span>BLOCK</span><span>FREEZE CHAT</span><span>ESCALATE</span></div></section>
<section class="grid"><div class="card"><h2>Conversation Shield</h2><p>Scores individual messages and the full risk session, so repeated grooming behaviour becomes more dangerous even when each message looks harmless alone.</p></div><div class="card"><h2>Content & Ad Guard</h2><p>Returns block, blur, suppress-ad and disable-autoplay controls for age-inappropriate or sexualized material.</p></div><div class="card"><h2>Global Reporting Router</h2><p>Routes high-risk cases toward verified child helplines and CSAM/exploitation reporting networks by country instead of inventing contact numbers.</p></div><div class="card"><h2>Privacy-Minimal Tracking</h2><p>Tracks risk-session hashes and safety metadata. Raw child conversations are not stored in the XGuard scan ledger.</p></div></section>
<section class="money"><div class="panel"><h2>Built to be safety infrastructure — and highly monetizable.</h2><p>Businesses prepay XGuard and are charged per safety event. This turns child protection into an API line item that scales with platform traffic instead of depending on donations.</p><div class="prices"><div class="price"><b>$0.005</b>single message</div><div class="price"><b>$0.010</b>chat window</div><div class="price"><b>$0.010</b>ad text</div><div class="price"><b>$0.015</b>image-description event</div><div class="price"><b>$0.020</b>video transcript event</div></div></div></section>
<div class="foot">XGuard provides automated safety classification and enforcement decisions to integrated products. It cannot remotely shut down third-party chats or accounts that have not integrated XGuard. Suspected child sexual exploitation should be routed to the appropriate official reporting channel and, where legally required, reported by the responsible service provider.</div>
</body></html>`;
}
