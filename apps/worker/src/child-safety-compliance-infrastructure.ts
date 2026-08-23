import { authenticateMerchant } from "./mainnet-billing.js";

const MAX_BODY_BYTES = 24 * 1024;
const ID = /^[A-Za-z0-9._:-]{8,256}$/;
const PROVIDER = /^[A-Za-z0-9._:-]{2,120}$/;

const AGE_METHODS = [
  "eu_av_openid4vp",
  "digital_identity_service",
  "photo_id_matching",
  "facial_age_estimation",
  "open_banking",
  "mno_age_check",
  "credit_card_check",
  "email_age_estimation",
  "other",
] as const;

type AgeMethod = (typeof AGE_METHODS)[number];
type ThresholdResult = "meets_threshold" | "below_threshold" | "unknown";
type VerificationStatus =
  | "verified_by_provider"
  | "verified_by_host"
  | "not_verified";
type ProviderTrust =
  | "trusted_listed"
  | "certified"
  | "contracted"
  | "unverified";

interface ChildSafetyComplianceEnv {
  DB: D1Database;
}

interface AgeAssuranceInput {
  eventId: string;
  providerId: string;
  proofReference: string;
  method: AgeMethod;
  ageThreshold: number;
  result: ThresholdResult;
  verificationStatus: VerificationStatus;
  providerTrust: ProviderTrust;
  issuedAt: string;
  expiresAt: string;
  presentationProtocol?: "openid4vp_1_0" | "provider_api" | "host_native";
  technicalAccuracyEvaluated: boolean;
  robustnessTested: boolean;
  reliabilityMonitored: boolean;
  fairnessEvaluated: boolean;
  thirdPartyScrutiny: boolean;
  privacyPreserving: boolean;
  exactAgeDisclosedToXGuard: boolean;
  identityDisclosedToXGuard: boolean;
  jurisdiction?: string;
}

const COMPLIANCE_PROFILE = {
  product: "XGuard Privacy-Preserving Child Safety Compliance Infrastructure",
  version: "2026-08-20",
  certificationStatus: "not_certified_or_government_approved",
  claimBoundary:
    "XGuard provides technical controls and evidence. It does not claim regulator approval, certification, legal compliance, or trusted-list status unless independently granted and published by the relevant authority.",
  ageAssuranceBoundary: {
    role:
      "Accept a minimum-data result from an age-assurance verifier/provider or host and bind that result to a child-safety evidence envelope.",
    doesNotPerform:
      "This adapter does not itself inspect passports, retain dates of birth, or claim independent cryptographic verification of a wallet presentation.",
    euInteroperabilityTarget: ["OpenID4VP 1.0", "DCQL", "anonymous threshold proof"],
  },
  regulatoryTargets: {
    eu: {
      target:
        "DSA Article 28 protection-of-minors controls and EU Age Verification Scheme / blueprint interoperability",
      readinessEvidence: [
        "anonymous threshold result",
        "data minimisation",
        "third-party scrutiny flag",
        "provider/trust-basis metadata",
        "policy and evidence traceability",
      ],
    },
    uk: {
      target: "Online Safety Act highly effective age assurance evidence",
      criteria: ["technical_accuracy", "robustness", "reliability", "fairness"],
      note:
        "Evidence completeness is not an Ofcom approval. The regulated service remains responsible for its duties.",
    },
    international: {
      target: "ISO/IEC 27566-1:2025 age assurance framework readiness",
      note: "Readiness metadata is not ISO certification.",
    },
  },
  privacy: {
    rawDateOfBirthAccepted: false,
    rawIdentityDocumentAccepted: false,
    exactAgeRequired: false,
    anonymousThresholdResultPreferred: true,
    proofBodyStoredByThisEndpoint: false,
  },
} as const;

export async function childSafetyComplianceInfrastructureResponse(
  request: Request,
  env: ChildSafetyComplianceEnv,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/v1/child-safety/compliance-profile") {
    return json(COMPLIANCE_PROFILE);
  }

  if (request.method === "GET" && url.pathname === "/v1/child-safety/age-assurance/schema") {
    return json(ageAssuranceSchema());
  }

  if (request.method === "GET" && url.pathname === "/v1/child-safety/regulator-pack") {
    return json(regulatorPack());
  }

  if (request.method === "GET" && url.pathname === "/child-safety/age-assurance") {
    return html(ageAssurancePage());
  }

  if (
    request.method === "GET" &&
    url.pathname === "/child-safety/regulatory-readiness"
  ) {
    return html(regulatoryReadinessPage());
  }

  if (
    request.method === "OPTIONS" &&
    (url.pathname === "/v1/child-safety/age-assurance/evaluate" ||
      url.pathname === "/v1/child-safety/compliance-profile" ||
      url.pathname === "/v1/child-safety/age-assurance/schema" ||
      url.pathname === "/v1/child-safety/regulator-pack")
  ) {
    return new Response(null, { status: 204, headers: apiHeaders() });
  }

  if (
    request.method === "POST" &&
    url.pathname === "/v1/child-safety/age-assurance/evaluate"
  ) {
    const merchant = await authenticateRequest(request, env.DB);
    if (merchant === null) return json({ error: "unauthorized" }, 401, true);

    const parsed = await readJson(request);
    if (parsed instanceof Response) return parsed;
    const evaluated = evaluateAgeAssurance(parsed);
    if (!evaluated.ok) return json({ error: evaluated.error }, 400, true);

    return json(
      {
        ...evaluated.value,
        merchant: { merchantId: merchant.merchantId, name: merchant.name },
      },
      200,
      true,
    );
  }

  return null;
}

export function evaluateAgeAssurance(
  value: unknown,
  nowMs = Date.now(),
):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: "invalid_body" };

  for (const forbidden of [
    "dateOfBirth",
    "dob",
    "birthDate",
    "identityDocument",
    "documentImage",
    "passportNumber",
    "fullName",
    "address",
  ]) {
    if (forbidden in value) return { ok: false, error: `raw_identity_field_forbidden:${forbidden}` };
  }

  const input = parseInput(value);
  if (typeof input === "string") return { ok: false, error: input };

  const issuedMs = Date.parse(input.issuedAt);
  const expiresMs = Date.parse(input.expiresAt);
  if (!Number.isFinite(issuedMs) || !Number.isFinite(expiresMs))
    return { ok: false, error: "invalid_evidence_time" };
  if (expiresMs <= issuedMs) return { ok: false, error: "invalid_evidence_lifetime" };
  if (expiresMs <= nowMs) return { ok: false, error: "age_evidence_expired" };
  if (issuedMs > nowMs + 5 * 60 * 1000)
    return { ok: false, error: "age_evidence_issued_in_future" };

  const verificationSufficient = input.verificationStatus !== "not_verified";
  const ukCriteria = {
    technicalAccuracy: input.technicalAccuracyEvaluated,
    robustness: input.robustnessTested,
    reliability: input.reliabilityMonitored,
    fairness: input.fairnessEvaluated,
  };
  const ukEvidenceComplete =
    verificationSufficient && Object.values(ukCriteria).every(Boolean);
  const euPrivacyProfile =
    input.privacyPreserving &&
    !input.exactAgeDisclosedToXGuard &&
    !input.identityDisclosedToXGuard;
  const euBlueprintEvidenceComplete =
    verificationSufficient &&
    input.method === "eu_av_openid4vp" &&
    input.presentationProtocol === "openid4vp_1_0" &&
    euPrivacyProfile &&
    input.thirdPartyScrutiny;

  const evidenceId = `xg_age_${crypto.randomUUID()}`;
  const policySignal = !verificationSufficient
    ? "INSUFFICIENT_EVIDENCE"
    : input.result === "meets_threshold"
      ? "THRESHOLD_MET"
      : input.result === "below_threshold"
        ? "BELOW_THRESHOLD"
        : "INSUFFICIENT_EVIDENCE";

  return {
    ok: true,
    value: {
      evidenceId,
      eventId: input.eventId,
      evaluatedAt: new Date(nowMs).toISOString(),
      ageAssurance: {
        providerId: input.providerId,
        method: input.method,
        ageThreshold: input.ageThreshold,
        result: input.result,
        verificationStatus: input.verificationStatus,
        providerTrust: input.providerTrust,
        presentationProtocol: input.presentationProtocol ?? null,
        issuedAt: input.issuedAt,
        expiresAt: input.expiresAt,
        jurisdiction: input.jurisdiction ?? null,
        proofReferenceRetained: false,
        rawProofRetained: false,
        exactAgeRetained: false,
        rawIdentityDocumentRetained: false,
      },
      policySignal,
      evidence: {
        ukHeaaCriteria: ukCriteria,
        ukHeaaEvidenceComplete: ukEvidenceComplete,
        euPrivacyProfile,
        euBlueprintEvidenceComplete,
        thirdPartyScrutiny: input.thirdPartyScrutiny,
      },
      trustBoundary: {
        claimsAreCallerAttested: true,
        independentCryptographicVerificationPerformedByXGuard: false,
        regulatorApprovalAssertedByXGuard: false,
        providerTrustedListStatusIndependentlyCheckedByXGuard: false,
      },
      notices: [
        "This response is a technical evidence envelope, not a regulator approval or legal compliance certificate.",
        "The integrating service remains responsible for selecting an appropriate age-assurance method, vendor due diligence, privacy obligations and applicable legal duties.",
      ],
    },
  };
}

function parseInput(value: Record<string, unknown>): AgeAssuranceInput | string {
  const eventId = text(value.eventId, 256);
  const providerId = text(value.providerId, 120);
  const proofReference = text(value.proofReference, 256);
  const method = text(value.method, 80) as AgeMethod;
  const result = text(value.result, 40) as ThresholdResult;
  const verificationStatus = text(value.verificationStatus, 40) as VerificationStatus;
  const providerTrust = text(value.providerTrust, 40) as ProviderTrust;
  const issuedAt = text(value.issuedAt, 80);
  const expiresAt = text(value.expiresAt, 80);
  const presentationProtocol = text(value.presentationProtocol, 40) as
    | AgeAssuranceInput["presentationProtocol"]
    | "";
  const jurisdiction = text(value.jurisdiction, 80);
  const ageThreshold = value.ageThreshold;

  if (!ID.test(eventId)) return "invalid_event_id";
  if (!PROVIDER.test(providerId)) return "invalid_provider_id";
  if (!ID.test(proofReference)) return "invalid_proof_reference";
  if (!AGE_METHODS.includes(method)) return "invalid_age_method";
  if (!["meets_threshold", "below_threshold", "unknown"].includes(result))
    return "invalid_threshold_result";
  if (![
    "verified_by_provider",
    "verified_by_host",
    "not_verified",
  ].includes(verificationStatus)) return "invalid_verification_status";
  if (!["trusted_listed", "certified", "contracted", "unverified"].includes(providerTrust))
    return "invalid_provider_trust";
  if (!Number.isInteger(ageThreshold) || Number(ageThreshold) < 1 || Number(ageThreshold) > 120)
    return "invalid_age_threshold";
  if (
    presentationProtocol &&
    !["openid4vp_1_0", "provider_api", "host_native"].includes(presentationProtocol)
  ) return "invalid_presentation_protocol";

  const booleanFields = [
    "technicalAccuracyEvaluated",
    "robustnessTested",
    "reliabilityMonitored",
    "fairnessEvaluated",
    "thirdPartyScrutiny",
    "privacyPreserving",
    "exactAgeDisclosedToXGuard",
    "identityDisclosedToXGuard",
  ] as const;
  for (const field of booleanFields) {
    if (typeof value[field] !== "boolean") return `invalid_boolean:${field}`;
  }

  return {
    eventId,
    providerId,
    proofReference,
    method,
    ageThreshold: Number(ageThreshold),
    result,
    verificationStatus,
    providerTrust,
    issuedAt,
    expiresAt,
    presentationProtocol: presentationProtocol || undefined,
    technicalAccuracyEvaluated: value.technicalAccuracyEvaluated as boolean,
    robustnessTested: value.robustnessTested as boolean,
    reliabilityMonitored: value.reliabilityMonitored as boolean,
    fairnessEvaluated: value.fairnessEvaluated as boolean,
    thirdPartyScrutiny: value.thirdPartyScrutiny as boolean,
    privacyPreserving: value.privacyPreserving as boolean,
    exactAgeDisclosedToXGuard: value.exactAgeDisclosedToXGuard as boolean,
    identityDisclosedToXGuard: value.identityDisclosedToXGuard as boolean,
    jurisdiction: jurisdiction || undefined,
  };
}

function ageAssuranceSchema(): Record<string, unknown> {
  return {
    product: COMPLIANCE_PROFILE.product,
    endpoint: "POST /v1/child-safety/age-assurance/evaluate",
    authentication: "merchant API key",
    purpose:
      "Bind a minimum-data age-assurance result to regulator-oriented evidence without sending date of birth or identity documents to XGuard.",
    acceptedMethods: AGE_METHODS,
    required: {
      eventId: "opaque event id, 8-256 characters",
      providerId: "provider or verifier identifier",
      proofReference:
        "opaque one-time reference only; do not send a wallet presentation, token, DOB or identity document",
      method: "one accepted method",
      ageThreshold: "integer 1-120",
      result: ["meets_threshold", "below_threshold", "unknown"],
      verificationStatus: ["verified_by_provider", "verified_by_host", "not_verified"],
      providerTrust: ["trusted_listed", "certified", "contracted", "unverified"],
      issuedAt: "ISO-8601 timestamp",
      expiresAt: "ISO-8601 timestamp",
      technicalAccuracyEvaluated: "boolean",
      robustnessTested: "boolean",
      reliabilityMonitored: "boolean",
      fairnessEvaluated: "boolean",
      thirdPartyScrutiny: "boolean",
      privacyPreserving: "boolean",
      exactAgeDisclosedToXGuard: "boolean",
      identityDisclosedToXGuard: "boolean",
    },
    forbiddenRawFields: [
      "dateOfBirth",
      "dob",
      "birthDate",
      "identityDocument",
      "documentImage",
      "passportNumber",
      "fullName",
      "address",
    ],
    trustBoundary:
      "XGuard evaluates the supplied evidence metadata; it does not independently certify the provider or cryptographically verify a wallet proof in this adapter.",
  };
}

function regulatorPack(): Record<string, unknown> {
  return {
    product: COMPLIANCE_PROFILE.product,
    generatedFor: "regulator, government, auditor and platform due-diligence review",
    certificationStatus: COMPLIANCE_PROFILE.certificationStatus,
    controlChain: [
      "age / eligibility evidence",
      "child-safety risk decision",
      "proportionate host enforcement",
      "human review for serious or ambiguous cases",
      "machine-readable evidence",
    ],
    inspectableEndpoints: [
      "GET /v1/child-safety/principles",
      "GET /v1/child-safety/compliance-profile",
      "GET /v1/child-safety/age-assurance/schema",
      "POST /v1/child-safety/age-assurance/evaluate",
      "GET /v1/child-safety/reporting",
      "GET /v1/child-safety/regulator-pack",
    ],
    controls: {
      surveillanceBackdoor: false,
      backgroundDeviceMonitoring: false,
      rawDateOfBirthRequired: false,
      rawIdentityDocumentRequired: false,
      rawConversationLedgerRequired: false,
      hostRemainsAccountable: true,
      humanReviewSupported: true,
      regulatorEvidenceExportSupported: true,
    },
    externalWorkStillRequiredBeforeAnyApprovalClaim: [
      "independent security assessment",
      "age-assurance accuracy / robustness / reliability / fairness evidence",
      "privacy and child-rights impact assessment",
      "provider due diligence and trust-list verification",
      "jurisdiction-specific legal review",
      "applicable certification or conformity assessment",
      "formal submission to the relevant authority or scheme",
    ],
  };
}

async function authenticateRequest(request: Request, db: D1Database) {
  const auth = request.headers.get("authorization")?.trim() ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  const apiKey = bearer || request.headers.get("x-api-key")?.trim() || "";
  if (!apiKey) return null;
  return authenticateMerchant(db, apiKey);
}

async function readJson(request: Request): Promise<unknown | Response> {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES)
    return json({ error: "body_too_large" }, 413, true);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return json({ error: "invalid_json" }, 400, true);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function json(value: unknown, status = 200, noStore = false): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...apiHeaders(),
      "Cache-Control": noStore ? "no-store" : "public, max-age=300",
    },
  });
}

function apiHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, X-API-Key, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "X-Content-Type-Options": "nosniff",
  };
}

function html(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
  });
}

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} — XGuard</title><meta name="description" content="Privacy-preserving child safety compliance infrastructure, age-assurance evidence and regulator-ready controls."><style>*{box-sizing:border-box}body{margin:0;background:#080a0e;color:#f7f8fb;font-family:Inter,Arial,sans-serif}header,footer,main{max-width:1160px;margin:auto;padding:24px 28px}header,footer{display:flex;justify-content:space-between;gap:20px;align-items:center}.brand{font-size:24px;font-weight:900;color:#fff;text-decoration:none}nav{display:flex;gap:14px;flex-wrap:wrap}nav a,footer{color:#aeb3bd;text-decoration:none}main{padding-top:50px;padding-bottom:80px}.eyebrow{text-transform:uppercase;letter-spacing:.15em;color:#77a8ff;font-size:12px;font-weight:800}h1{font-size:clamp(42px,7vw,78px);line-height:.98;letter-spacing:-.035em;max-width:980px}h2{font-size:32px}.lead,p,li{color:#b9bec7;line-height:1.7}.lead{font-size:20px;max-width:900px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:28px}.card,.notice{border:1px solid #252b36;background:#10141a;border-radius:18px;padding:24px}.notice{margin-top:28px;border-color:#334155}.good{color:#9ee6b0}.warn{color:#ffd38a}.flow{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:28px 0}.flow div{border:1px solid #252b36;padding:18px;border-radius:14px}.flow b{display:block;color:#77a8ff;margin-bottom:8px}.cta{display:inline-block;margin-top:18px;padding:12px 16px;border-radius:10px;background:#eef4ff;color:#111827;text-decoration:none;font-weight:800}@media(max-width:850px){.grid,.flow{grid-template-columns:1fr}header{align-items:flex-start;flex-direction:column}}</style></head><body><header><a class="brand" href="/child-safety">XGuard.</a><nav><a href="/child-safety">Overview</a><a href="/child-safety/age-assurance">Age assurance</a><a href="/child-safety/regulatory-readiness">Regulatory readiness</a><a href="/child-safety/compliance">Compliance</a><a href="/child-safety/contact">Contact</a></nav></header><main>${body}</main><footer><span>Privacy-preserving child safety compliance infrastructure</span><span>info@xguardgate.com</span></footer></body></html>`;
}

function ageAssurancePage(): string {
  return shell(
    "Age Assurance",
    `<div class="eyebrow">XGuard Age + Safety Gateway</div><h1>Prove the threshold. Do not expose the child.</h1><p class="lead">XGuard binds minimum-data age-assurance results to child-safety controls and regulator-oriented evidence. The preferred model is an anonymous threshold proof such as “18+”, not a date of birth or identity document.</p><div class="flow"><div><b>01</b>Age / eligibility proof</div><div><b>02</b>Minimum-data result</div><div><b>03</b>Safety policy</div><div><b>04</b>Host enforcement</div><div><b>05</b>Evidence envelope</div></div><section class="grid"><article class="card"><h2>EU interoperability target</h2><p>Designed around the EU age-verification direction: privacy-preserving threshold proofs and compatibility with OpenID4VP 1.0 / DCQL verifier flows. XGuard does not claim EU trusted-list status until formally granted.</p></article><article class="card"><h2>UK evidence profile</h2><p>Capture evidence for Ofcom’s four highly-effective-age-assurance criteria: technical accuracy, robustness, reliability and fairness. A complete evidence profile is not itself Ofcom approval.</p></article><article class="card"><h2>Data minimisation</h2><p>The API rejects DOB, passport number, document image, full name and address fields. The supplied proof reference is not returned or retained by this endpoint.</p></article><article class="card"><h2>Independent accountability</h2><p>Provider trust, certification and scheme-list status remain externally verifiable facts. XGuard records the caller’s stated basis but does not manufacture an approval claim.</p></article></section><div class="notice"><strong class="warn">Regulatory status:</strong><p>XGuard is building conformity evidence and interoperability. It is not currently represented here as government-approved, EU-trusted-listed, Ofcom-approved or ISO-certified.</p></div><a class="cta" href="/v1/child-safety/age-assurance/schema">Open machine-readable schema →</a>`,
  );
}

function regulatoryReadinessPage(): string {
  return shell(
    "Regulatory Readiness",
    `<div class="eyebrow">Regulator readiness</div><h1>Inspectable controls before marketing claims.</h1><p class="lead">The objective is to make XGuard a credible technical component that can enter certification, procurement, trusted-list and regulator-review processes. The legal obligation should remain technology-neutral; XGuard competes to become an accepted implementation, not a brand written into law.</p><section class="grid"><article class="card"><h2>EU</h2><p>Target the EU Age Verification Scheme and blueprint ecosystem with anonymous threshold proofs, OpenID4VP compatibility, privacy safeguards and third-party scrutiny evidence.</p></article><article class="card"><h2>United Kingdom</h2><p>Maintain measurable evidence for technical accuracy, robustness, reliability and fairness, plus privacy, accessibility and interoperability. The regulated service remains accountable even when it uses a vendor.</p></article><article class="card"><h2>ISO/IEC 27566-1</h2><p>Map XGuard’s age-assurance governance and evidence model to the published 2025 framework while treating certification as separate third-party work.</p></article><article class="card"><h2>Procurement & pilots</h2><p>Offer bounded pilots with measurable outcomes, documented data flows, retention limits, human review, false-positive measurement and an explicit non-surveillance boundary.</p></article></section><div class="notice"><strong class="good">Already machine-readable:</strong><p><code>/v1/child-safety/compliance-profile</code> · <code>/v1/child-safety/age-assurance/schema</code> · <code>/v1/child-safety/regulator-pack</code></p></div><div class="notice"><strong class="warn">Still requires external evidence:</strong><p>Independent security assessment, empirical age-assurance testing, fairness analysis, privacy/child-rights impact assessments, provider trust-list verification, certification where applicable and formal applications to the relevant schemes.</p></div><a class="cta" href="/v1/child-safety/regulator-pack">Open regulator pack →</a>`,
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    return "&quot;";
  });
}
