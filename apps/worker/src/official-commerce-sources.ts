const FTS_ID = "uk-find-a-tender";
const FTS_NAME = "UK Find a Tender";
const FTS_BASE =
  "https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages";
const CF_ID = "uk-contracts-finder";
const CF_NAME = "UK Contracts Finder";
const CF_BASE =
  "https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search";
const TED_ID = "eu-ted";
const TED_NAME = "EU TED";
const TED_BASE = "https://api.ted.europa.eu/v3/notices/search";
const ECB_FX =
  "https://data-api.ecb.europa.eu/service/data/EXR/D.USD+GBP.EUR.SP00.A?lastNObservations=10&format=csvdata";
const MAX_RESPONSE_BYTES = 5_000_000;
const MAX_PAGES_PER_STAGE = 3;
const SOURCE_INTERVAL_MS = 10 * 60 * 1000;
const SOURCE_OVERLAP_MS = 30 * 60 * 1000;
const INITIAL_LOOKBACK_MS = 4 * 60 * 60 * 1000;

type JsonRecord = Record<string, unknown>;

export interface OfficialCommerceSourceEnv {
  DB: D1Database;
}

export interface FxTable {
  usdPerEur: number;
  currencyPerEur: Record<string, number>;
  observedAt: string | null;
}

export interface OfficialDemand {
  id: string;
  sourceName: string;
  sourceUrl: string;
  sourceRef: string;
  buyerName: string | null;
  buyerCountry: string | null;
  buyerEmail: string | null;
  productKey: string;
  description: string;
  quantity: number;
  unit: string;
  targetUnitPriceUsd: number | null;
  deadlineAt: string | null;
  paymentTerms: string;
  evidenceLevel: number;
  observedAt: string;
}

export interface VendorCandidate {
  id: string;
  sourceName: string;
  sourceUrl: string;
  sourceRef: string;
  supplierName: string;
  supplierCountry: string | null;
  supplierEmail: string | null;
  productKey: string;
  description: string;
  referenceValueUsd: number | null;
  evidenceLevel: number;
  observedAt: string;
}

export interface ParsedOfficialPackage {
  demands: OfficialDemand[];
  vendors: VendorCandidate[];
}

interface SourceRun {
  last_checked_at?: string | null;
  last_success_at?: string | null;
}

interface SourceSpec {
  id: string;
  name: string;
  base: string;
  fromKey: string;
  toKey: string;
}

const OCDS_SOURCES: SourceSpec[] = [
  {
    id: FTS_ID,
    name: FTS_NAME,
    base: FTS_BASE,
    fromKey: "updatedFrom",
    toKey: "updatedTo",
  },
  {
    id: CF_ID,
    name: CF_NAME,
    base: CF_BASE,
    fromKey: "publishedFrom",
    toKey: "publishedTo",
  },
];

export async function officialCommerceSourcesResponse(
  request: Request,
  env: OfficialCommerceSourceEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.pathname !== "/v1/commerce/sources/status"
  ) {
    return null;
  }

  const [runs, counts] = await Promise.all([
    env.DB.prepare(
      `SELECT source_id,source_name,last_checked_at,last_success_at,last_error,
              imported_demands,imported_offers,updated_at
         FROM commerce_source_runs
        ORDER BY source_name`,
    ).all<Record<string, unknown>>(),
    env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM commerce_demands
           WHERE source_name IN (?,?,?)) AS official_demands,
         (SELECT COUNT(*) FROM commerce_vendor_candidates) AS vendor_candidates`,
    )
      .bind(FTS_NAME, CF_NAME, TED_NAME)
      .first<Record<string, unknown>>(),
  ]);

  return json({
    mode: "official-public-procurement",
    policy: {
      tenderData: "buyer-demand evidence only",
      awardData: "supplier candidate evidence only",
      historicalAwardIsLiveInventory: false,
      publicTenderIsSecuredBuyerFunds: false,
    },
    counts: counts ?? {},
    sources: runs.results ?? [],
  });
}

export async function refreshOfficialCommerceSources(
  env: OfficialCommerceSourceEnv,
): Promise<{
  checked: number;
  imported: number;
  vendors: number;
  errors: string[];
}> {
  let checked = 0;
  let imported = 0;
  let vendors = 0;
  const errors: string[] = [];

  let fx: FxTable | null = null;
  try {
    fx = await fetchEcbFx();
  } catch (error) {
    errors.push(`ecb_fx:${errorText(error)}`);
  }

  for (const spec of OCDS_SOURCES) {
    const run = await getSourceRun(env, spec.id);
    if (!sourceDue(run)) continue;
    checked += 1;
    const now = new Date();
    const from = sourceWindowStart(run, now);
    await markChecked(env, spec.id, spec.name, now.toISOString());
    try {
      const totals = await refreshOcdsSource(env, spec, from, now, fx);
      imported += totals.demands;
      vendors += totals.vendors;
      await markSuccess(
        env,
        spec.id,
        spec.name,
        now.toISOString(),
        totals.demands,
        totals.vendors,
      );
    } catch (error) {
      const message = errorText(error);
      errors.push(`${spec.id}:${message}`);
      await markError(env, spec.id, spec.name, now.toISOString(), message);
    }
  }

  const tedRun = await getSourceRun(env, TED_ID);
  if (sourceDue(tedRun)) {
    checked += 1;
    const now = new Date();
    const from = sourceWindowStart(tedRun, now);
    await markChecked(env, TED_ID, TED_NAME, now.toISOString());
    try {
      const parsed = await fetchTedDemands(from, fx);
      for (const demand of parsed.demands) await persistDemand(env, demand);
      imported += parsed.demands.length;
      await markSuccess(
        env,
        TED_ID,
        TED_NAME,
        now.toISOString(),
        parsed.demands.length,
        0,
      );
    } catch (error) {
      const message = errorText(error);
      errors.push(`${TED_ID}:${message}`);
      await markError(env, TED_ID, TED_NAME, now.toISOString(), message);
    }
  }

  return { checked, imported, vendors, errors };
}

async function refreshOcdsSource(
  env: OfficialCommerceSourceEnv,
  spec: SourceSpec,
  from: Date,
  to: Date,
  fx: FxTable | null,
): Promise<{ demands: number; vendors: number }> {
  let demands = 0;
  let vendors = 0;
  for (const stage of ["tender", "award"] as const) {
    let pageUrl: string | null = buildOcdsUrl(spec, from, to, stage);
    for (let page = 0; page < MAX_PAGES_PER_STAGE && pageUrl; page += 1) {
      const body = await fetchJson(pageUrl);
      const parsed = parseOcdsReleasePackage(body, spec.id, spec.name, fx);
      for (const demand of parsed.demands) {
        await persistDemand(env, demand);
        demands += 1;
      }
      for (const vendor of parsed.vendors) {
        await persistVendor(env, vendor);
        vendors += 1;
      }
      pageUrl = safeNextPage(body, spec.base);
    }
  }
  return { demands, vendors };
}

export function parseOcdsReleasePackage(
  raw: unknown,
  sourceId: string,
  sourceName: string,
  fx: FxTable | null,
): ParsedOfficialPackage {
  const root = record(raw);
  const releases = array(root.releases);
  const demands: OfficialDemand[] = [];
  const vendors: VendorCandidate[] = [];

  for (const value of releases) {
    const release = record(value);
    const tender = record(release.tender);
    const tenderStatus = text(tender.status).toLowerCase();
    const tags = stringArray(release.tag).map((tag) => tag.toLowerCase());
    const sourceRef = text(release.id) || text(release.ocid);
    const productKey = productKeyFromOcds(tender, release);
    if (!sourceRef || !productKey) continue;

    const sourceUrl = officialOcdsSourceUrl(sourceId, sourceRef, release);
    const observedAt = validIso(release.date) ?? new Date().toISOString();
    const buyer = record(release.buyer);
    const parties = array(release.parties).map(record);
    const buyerParty = partyByIdOrRole(parties, text(buyer.id), "buyer");
    const buyerName = text(buyer.name) || text(buyerParty.name) || null;
    const buyerEmail = email(record(buyerParty.contactPoint).email);
    const buyerCountry =
      text(record(buyerParty.address).countryName) ||
      (sourceId.startsWith("uk-") ? "United Kingdom" : "") ||
      null;

    if (
      tags.some((tag) => tag === "tender" || tag === "tenderamendment") &&
      tenderStatus === "active"
    ) {
      const deadlineAt = validIso(record(tender.tenderPeriod).endDate);
      if (!deadlineAt || Date.parse(deadlineAt) > Date.now()) {
        const money = tenderMoney(tender);
        const title = text(tender.title);
        const classification = record(tender.classification);
        const description = compactDescription([
          title,
          text(tender.description),
          text(classification.description),
          ...array(tender.lots)
            .slice(0, 2)
            .map((lot) => text(record(lot).description)),
        ]);
        demands.push({
          id: stableKey("demand", sourceId, sourceRef),
          sourceName,
          sourceUrl,
          sourceRef,
          buyerName,
          buyerCountry,
          buyerEmail,
          productKey,
          description: description || productKey,
          quantity: 1,
          unit: "contract",
          targetUnitPriceUsd: money
            ? convertMoneyToUsd(money.amount, money.currency, fx)
            : null,
          deadlineAt,
          paymentTerms:
            "Public procurement notice; buyer funding and pre-funding are not independently verified.",
          evidenceLevel: 95,
          observedAt,
        });
      }
    }

    const awards = array(release.awards).map(record);
    const contracts = array(release.contracts).map(record);
    for (const award of awards) {
      if (text(award.status).toLowerCase() === "cancelled") continue;
      const awardId = text(award.id);
      const awardMoney =
        moneyValue(award.value) ?? contractMoney(contracts, awardId);
      for (const supplierValue of array(award.suppliers)) {
        const supplier = record(supplierValue);
        const supplierId = text(supplier.id);
        const supplierName = text(supplier.name);
        if (!supplierName) continue;
        const party = partyByIdOrRole(
          parties,
          supplierId,
          "supplier",
          supplierName,
        );
        const supplierEmail = email(record(party.contactPoint).email);
        const supplierCountry = text(record(party.address).countryName) || null;
        vendors.push({
          id: stableKey(
            "vendor",
            sourceId,
            sourceRef,
            awardId || "award",
            supplierId || supplierName,
            productKey,
          ),
          sourceName,
          sourceUrl,
          sourceRef: awardId ? `${sourceRef}:${awardId}` : sourceRef,
          supplierName,
          supplierCountry,
          supplierEmail,
          productKey,
          description:
            compactDescription([
              text(award.title),
              text(tender.title),
              text(record(tender.classification).description),
            ]) || productKey,
          referenceValueUsd: awardMoney
            ? convertMoneyToUsd(awardMoney.amount, awardMoney.currency, fx)
            : null,
          evidenceLevel: 85,
          observedAt: validIso(award.date) ?? observedAt,
        });
      }
    }
  }

  return { demands: dedupeDemands(demands), vendors: dedupeVendors(vendors) };
}

export function parseTedSearchResponse(
  raw: unknown,
  fx: FxTable | null,
): ParsedOfficialPackage {
  const notices = array(record(raw).notices);
  const demands: OfficialDemand[] = [];
  for (const value of notices) {
    const notice = record(value);
    const publication = firstText(notice["publication-number"]);
    const cpv = firstText(notice["classification-cpv"]);
    if (!publication || !cpv) continue;
    const deadline = firstDate(notice["deadline-date-lot"]);
    if (deadline && Date.parse(deadline) <= Date.now()) continue;
    const amount = firstNumber(notice["total-value"]);
    const currency = firstText(notice["total-value-cur"]);
    const title = firstText(notice["notice-title"]);
    const buyerName = firstText(notice["buyer-name"]) || null;
    const buyerEmail = email(firstText(notice["buyer-email"]));
    demands.push({
      id: stableKey("demand", TED_ID, publication),
      sourceName: TED_NAME,
      sourceUrl: `https://ted.europa.eu/en/notice/-/detail/${encodeURIComponent(publication)}`,
      sourceRef: publication,
      buyerName,
      buyerCountry: null,
      buyerEmail,
      productKey: `CPV-${cleanKey(cpv)}`,
      description: title || `TED notice ${publication}`,
      quantity: 1,
      unit: "contract",
      targetUnitPriceUsd:
        amount !== null && currency
          ? convertMoneyToUsd(amount, currency, fx)
          : null,
      deadlineAt: deadline,
      paymentTerms:
        "Public procurement notice; buyer funding and pre-funding are not independently verified.",
      evidenceLevel: 95,
      observedAt: new Date().toISOString(),
    });
  }
  return { demands: dedupeDemands(demands), vendors: [] };
}

export function parseEcbFxCsv(raw: string): FxTable {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) throw new Error("ecb_fx_empty");
  const header = parseCsvLine(lines[0]);
  const currencyIndex = header.indexOf("CURRENCY");
  const dateIndex = header.indexOf("TIME_PERIOD");
  const valueIndex = header.indexOf("OBS_VALUE");
  if (currencyIndex < 0 || dateIndex < 0 || valueIndex < 0) {
    throw new Error("ecb_fx_schema_changed");
  }
  const latest = new Map<string, { date: string; rate: number }>();
  for (const line of lines.slice(1)) {
    const row = parseCsvLine(line);
    const currency = text(row[currencyIndex]).toUpperCase();
    const date = text(row[dateIndex]);
    const rate = Number(row[valueIndex]);
    if (!currency || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!Number.isFinite(rate) || rate <= 0) continue;
    const current = latest.get(currency);
    if (!current || date > current.date) latest.set(currency, { date, rate });
  }
  const usd = latest.get("USD");
  if (!usd) throw new Error("ecb_usd_rate_missing");
  const currencyPerEur: Record<string, number> = { EUR: 1 };
  let observedAt = usd.date;
  for (const [currency, value] of latest) {
    currencyPerEur[currency] = value.rate;
    if (value.date < observedAt) observedAt = value.date;
  }
  return { usdPerEur: usd.rate, currencyPerEur, observedAt };
}

export function convertMoneyToUsd(
  amountRaw: unknown,
  currencyRaw: unknown,
  fx: FxTable | null,
): number | null {
  const amount = Number(amountRaw);
  const currency = text(currencyRaw).toUpperCase();
  if (!Number.isFinite(amount) || amount < 0 || !currency) return null;
  if (currency === "USD") return round2(amount);
  if (!fx) return null;
  const currencyPerEur = fx.currencyPerEur[currency];
  if (!Number.isFinite(currencyPerEur) || currencyPerEur <= 0) return null;
  return round2((amount / currencyPerEur) * fx.usdPerEur);
}

async function fetchTedDemands(
  from: Date,
  fx: FxTable | null,
): Promise<ParsedOfficialPackage> {
  const yyyymmdd = from.toISOString().slice(0, 10).replaceAll("-", "");
  const response = await fetchWithTimeout(TED_BASE, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "XGuard-Global-Commerce/1.0",
    },
    body: JSON.stringify({
      query: `PD >= ${yyyymmdd}`,
      fields: [
        "publication-number",
        "notice-title",
        "buyer-name",
        "buyer-email",
        "classification-cpv",
        "total-value",
        "total-value-cur",
        "deadline-date-lot",
      ],
      page: 1,
      limit: 100,
      scope: "ACTIVE",
      checkQuerySyntax: true,
      paginationMode: "PAGE_NUMBER",
    }),
  });
  const body = await responseText(response);
  if (!response.ok)
    throw new Error(`ted_http_${response.status}:${body.slice(0, 200)}`);
  return parseTedSearchResponse(JSON.parse(body) as unknown, fx);
}

async function fetchEcbFx(): Promise<FxTable> {
  const response = await fetchWithTimeout(ECB_FX, {
    headers: { accept: "text/csv", "user-agent": "XGuard-Global-Commerce/1.0" },
  });
  const body = await responseText(response);
  if (!response.ok) throw new Error(`ecb_http_${response.status}`);
  return parseEcbFxCsv(body);
}

async function persistDemand(
  env: OfficialCommerceSourceEnv,
  demand: OfficialDemand,
): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO commerce_demands(
       demand_id,source_name,source_url,source_ref,buyer_name,buyer_country,buyer_email,
       product_key,description,quantity,unit,target_unit_price_usd,deadline_at,payment_terms,
       evidence_level,status,observed_at,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'OPEN',?,?,?)
     ON CONFLICT(demand_id) DO UPDATE SET
       source_name=excluded.source_name,source_url=excluded.source_url,source_ref=excluded.source_ref,
       buyer_name=excluded.buyer_name,buyer_country=excluded.buyer_country,buyer_email=excluded.buyer_email,
       product_key=excluded.product_key,description=excluded.description,quantity=excluded.quantity,
       unit=excluded.unit,target_unit_price_usd=excluded.target_unit_price_usd,deadline_at=excluded.deadline_at,
       payment_terms=excluded.payment_terms,evidence_level=excluded.evidence_level,status='OPEN',
       observed_at=excluded.observed_at,updated_at=excluded.updated_at`,
  )
    .bind(
      demand.id,
      demand.sourceName,
      demand.sourceUrl,
      demand.sourceRef,
      demand.buyerName,
      demand.buyerCountry,
      demand.buyerEmail,
      demand.productKey,
      demand.description,
      demand.quantity,
      demand.unit,
      demand.targetUnitPriceUsd,
      demand.deadlineAt,
      demand.paymentTerms,
      demand.evidenceLevel,
      demand.observedAt,
      now,
      now,
    )
    .run();
}

async function persistVendor(
  env: OfficialCommerceSourceEnv,
  vendor: VendorCandidate,
): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO commerce_vendor_candidates(
       candidate_id,source_name,source_url,source_ref,supplier_name,supplier_country,supplier_email,
       product_key,description,reference_value_usd,evidence_level,observed_at,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(candidate_id) DO UPDATE SET
       source_url=excluded.source_url,source_ref=excluded.source_ref,supplier_name=excluded.supplier_name,
       supplier_country=excluded.supplier_country,supplier_email=excluded.supplier_email,
       product_key=excluded.product_key,description=excluded.description,
       reference_value_usd=excluded.reference_value_usd,evidence_level=excluded.evidence_level,
       observed_at=excluded.observed_at,updated_at=excluded.updated_at`,
  )
    .bind(
      vendor.id,
      vendor.sourceName,
      vendor.sourceUrl,
      vendor.sourceRef,
      vendor.supplierName,
      vendor.supplierCountry,
      vendor.supplierEmail,
      vendor.productKey,
      vendor.description,
      vendor.referenceValueUsd,
      vendor.evidenceLevel,
      vendor.observedAt,
      now,
      now,
    )
    .run();
}

function buildOcdsUrl(
  spec: SourceSpec,
  from: Date,
  to: Date,
  stage: string,
): string {
  const url = new URL(spec.base);
  url.searchParams.set(spec.fromKey, from.toISOString().slice(0, 19));
  url.searchParams.set(spec.toKey, to.toISOString().slice(0, 19));
  url.searchParams.set("stages", stage);
  url.searchParams.set("limit", "100");
  return url.toString();
}

function safeNextPage(raw: unknown, base: string): string | null {
  const next = text(record(record(raw).links).next);
  if (!next) return null;
  try {
    const url = new URL(next);
    const expected = new URL(base);
    if (url.protocol !== "https:" || url.origin !== expected.origin)
      return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetchWithTimeout(url, {
    headers: {
      accept: "application/json",
      "user-agent": "XGuard-Global-Commerce/1.0",
    },
  });
  const body = await responseText(response);
  if (!response.ok)
    throw new Error(`source_http_${response.status}:${body.slice(0, 200)}`);
  return JSON.parse(body) as unknown;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("source_url_not_https");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    return await fetch(parsed.toString(), {
      ...init,
      redirect: "error",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function responseText(response: Response): Promise<string> {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
    throw new Error("source_response_too_large");
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
    throw new Error("source_response_too_large");
  }
  return body;
}

async function getSourceRun(
  env: OfficialCommerceSourceEnv,
  id: string,
): Promise<SourceRun | null> {
  return env.DB.prepare(
    "SELECT last_checked_at,last_success_at FROM commerce_source_runs WHERE source_id=?",
  )
    .bind(id)
    .first<SourceRun>();
}

function sourceDue(run: SourceRun | null): boolean {
  const checked = run?.last_checked_at ? Date.parse(run.last_checked_at) : 0;
  return (
    !Number.isFinite(checked) || Date.now() - checked >= SOURCE_INTERVAL_MS
  );
}

function sourceWindowStart(run: SourceRun | null, now: Date): Date {
  const success = run?.last_success_at
    ? Date.parse(run.last_success_at)
    : Number.NaN;
  if (Number.isFinite(success)) return new Date(success - SOURCE_OVERLAP_MS);
  return new Date(now.getTime() - INITIAL_LOOKBACK_MS);
}

async function markChecked(
  env: OfficialCommerceSourceEnv,
  id: string,
  name: string,
  now: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO commerce_source_runs(source_id,source_name,last_checked_at,updated_at)
     VALUES(?,?,?,?)
     ON CONFLICT(source_id) DO UPDATE SET
       source_name=excluded.source_name,last_checked_at=excluded.last_checked_at,updated_at=excluded.updated_at`,
  )
    .bind(id, name, now, now)
    .run();
}

async function markSuccess(
  env: OfficialCommerceSourceEnv,
  id: string,
  name: string,
  now: string,
  demands: number,
  vendors: number,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO commerce_source_runs(
       source_id,source_name,last_checked_at,last_success_at,last_error,imported_demands,imported_offers,updated_at)
     VALUES(?,?,?, ?,NULL,?,?,?)
     ON CONFLICT(source_id) DO UPDATE SET
       source_name=excluded.source_name,last_checked_at=excluded.last_checked_at,
       last_success_at=excluded.last_success_at,last_error=NULL,
       imported_demands=commerce_source_runs.imported_demands+excluded.imported_demands,
       imported_offers=commerce_source_runs.imported_offers+excluded.imported_offers,
       updated_at=excluded.updated_at`,
  )
    .bind(id, name, now, now, demands, vendors, now)
    .run();
}

async function markError(
  env: OfficialCommerceSourceEnv,
  id: string,
  name: string,
  now: string,
  message: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO commerce_source_runs(source_id,source_name,last_checked_at,last_error,updated_at)
     VALUES(?,?,?,?,?)
     ON CONFLICT(source_id) DO UPDATE SET
       source_name=excluded.source_name,last_checked_at=excluded.last_checked_at,
       last_error=excluded.last_error,updated_at=excluded.updated_at`,
  )
    .bind(id, name, now, message.slice(0, 500), now)
    .run();
}

function productKeyFromOcds(tender: JsonRecord, release: JsonRecord): string {
  const direct = cleanKey(text(record(tender.classification).id));
  if (direct) return `CPV-${direct}`;
  for (const itemValue of array(tender.items)) {
    const item = record(itemValue);
    for (const classificationValue of [
      item.classification,
      ...array(item.additionalClassifications),
    ]) {
      const classification = record(classificationValue);
      if (text(classification.scheme).toUpperCase() !== "CPV") continue;
      const id = cleanKey(text(classification.id));
      if (id) return `CPV-${id}`;
    }
  }
  for (const awardValue of array(release.awards)) {
    for (const itemValue of array(record(awardValue).items)) {
      const id = cleanKey(text(record(record(itemValue).classification).id));
      if (id) return `CPV-${id}`;
    }
  }
  return "";
}

function tenderMoney(
  tender: JsonRecord,
): { amount: number; currency: string } | null {
  const direct = moneyValue(tender.value);
  if (direct) return direct;
  let total = 0;
  let currency = "";
  let found = false;
  for (const lotValue of array(tender.lots)) {
    const money = moneyValue(record(lotValue).value);
    if (!money) continue;
    if (currency && currency !== money.currency) return null;
    currency = money.currency;
    total += money.amount;
    found = true;
  }
  return found ? { amount: total, currency } : null;
}

function contractMoney(
  contracts: JsonRecord[],
  awardId: string,
): { amount: number; currency: string } | null {
  const contract =
    contracts.find((entry) => text(entry.awardID) === awardId) ?? contracts[0];
  return contract ? moneyValue(contract.value) : null;
}

function moneyValue(
  value: unknown,
): { amount: number; currency: string } | null {
  const money = record(value);
  const amount = Number(money.amount);
  const currency = text(money.currency).toUpperCase();
  return Number.isFinite(amount) && amount >= 0 && currency
    ? { amount, currency }
    : null;
}

function partyByIdOrRole(
  parties: JsonRecord[],
  id: string,
  role: string,
  name = "",
): JsonRecord {
  return (
    parties.find((party) => id && text(party.id) === id) ??
    parties.find(
      (party) => name && text(party.name).toLowerCase() === name.toLowerCase(),
    ) ??
    parties.find((party) =>
      stringArray(party.roles)
        .map((entry) => entry.toLowerCase())
        .includes(role.toLowerCase()),
    ) ??
    {}
  );
}

function officialOcdsSourceUrl(
  sourceId: string,
  sourceRef: string,
  release: JsonRecord,
): string {
  if (sourceId === FTS_ID) {
    return `https://www.find-tender.service.gov.uk/Notice/${encodeURIComponent(sourceRef)}`;
  }
  if (sourceId === CF_ID) {
    const ocid = text(release.ocid) || sourceRef;
    return `https://www.contractsfinder.service.gov.uk/Published/OCDS/Record/${encodeURIComponent(ocid)}`;
  }
  return "https://ted.europa.eu/";
}

function firstText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstText(item);
      if (found) return found;
    }
  }
  if (value && typeof value === "object") {
    const object = value as JsonRecord;
    for (const key of ["eng", "en", "value", "text"]) {
      const found = firstText(object[key]);
      if (found) return found;
    }
    for (const item of Object.values(object)) {
      const found = firstText(item);
      if (found) return found;
    }
  }
  return "";
}

function firstNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const number = Number(value.replaceAll(",", ""));
    return Number.isFinite(number) ? number : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstNumber(item);
      if (found !== null) return found;
    }
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as JsonRecord)) {
      const found = firstNumber(item);
      if (found !== null) return found;
    }
  }
  return null;
}

function firstDate(value: unknown): string | null {
  if (typeof value === "string") return validIso(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstDate(item);
      if (found) return found;
    }
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as JsonRecord)) {
      const found = firstDate(item);
      if (found) return found;
    }
  }
  return null;
}

function validIso(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function email(value: unknown): string | null {
  const valueText = text(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valueText) ? valueText : null;
}

function stableKey(prefix: string, ...parts: string[]): string {
  return [prefix, ...parts]
    .map((part) => part.trim().replace(/[^A-Za-z0-9_.:-]+/g, "-"))
    .join(":")
    .slice(0, 500);
}

function cleanKey(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 80);
}

function compactDescription(parts: string[]): string {
  return Array.from(new Set(parts.map((part) => part.trim()).filter(Boolean)))
    .join(" — ")
    .slice(0, 3000);
}

function dedupeDemands(values: OfficialDemand[]): OfficialDemand[] {
  return Array.from(new Map(values.map((value) => [value.id, value])).values());
}

function dedupeVendors(values: VendorCandidate[]): VendorCandidate[] {
  return Array.from(new Map(values.map((value) => [value.id, value])).values());
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  return array(value).map(text).filter(Boolean);
}

function text(value: unknown): string {
  return typeof value === "string"
    ? value.trim()
    : typeof value === "number"
      ? String(value)
      : "";
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
