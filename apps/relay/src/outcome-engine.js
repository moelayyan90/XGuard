import { DOMParser, parseHTML } from "linkedom";
import { canonicalize } from "@x402/extensions/offer-receipt";
import { digestBytes } from "./core/execution-contract.js";

const encoder = new TextEncoder();
const tidy = (s, max = 300) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const hash = value => digestBytes(encoder.encode(typeof value === "string" ? value : canonicalize(value)));
function failure(code) { return Object.assign(new Error(code), { code }); }
function safeLink(value, base) {
  if (typeof value !== "string" || !value.trim()) return null;
  try { const u = new URL(value, base); if (!["https:", "http:"].includes(u.protocol) || u.username || u.password) return null; u.hash = ""; return u.toString().slice(0, 2048); } catch { return null; }
}
function canonicalLink(value) {
  const u = new URL(value);
  for (const key of [...u.searchParams.keys()]) if (/^utm_|^(fbclid|gclid)$/i.test(key)) u.searchParams.delete(key);
  u.hash = "";
  return u.toString();
}
function nodes(value) {
  const queue = Array.isArray(value) ? [...value] : [value];
  const found = [];
  while (queue.length && found.length < 256) {
    const node = queue.shift();
    if (!node || typeof node !== "object") continue;
    found.push(node);
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) queue.push(...child.slice(0, 50));
      else if (child && typeof child === "object") queue.push(child);
    }
  }
  return found;
}
const isType = (node, name) => [node?.["@type"]].flat().some(x => typeof x === "string" && x.split(/[\/#]/).at(-1) === name);
function decimal(value) {
  const s = String(value ?? "").trim();
  return /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(s) ? s : null;
}
function decimalUnits(s) { const [a, b = ""] = s.split("."); return BigInt(a) * 1000000n + BigInt(b.padEnd(6, "0")); }

export function extractDocument(html, source) {
  const { document } = parseHTML(String(html));
  const structured = [];
  let invalidJsonLd = 0;
  for (const script of [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0, 12)) {
    try { structured.push(...nodes(JSON.parse(script.textContent))); } catch { invalidJsonLd++; }
  }
  const title = tidy(document.querySelector("title")?.textContent || document.querySelector("h1")?.textContent);
  const description = tidy(document.querySelector('meta[name="description"]')?.getAttribute("content") || document.querySelector('meta[property="og:description"]')?.getAttribute("content"), 800);
  const links = [...new Set([...document.querySelectorAll("a[href]")].slice(0, 100).map(a => safeLink(a.getAttribute("href"), source)).filter(Boolean))].slice(0, 12);
  for (const el of document.querySelectorAll("script,style,nav,footer,header,form,svg,iframe,noscript,template")) el.remove();
  for (const el of document.querySelectorAll("p,div,h1,h2,h3,h4,li,section,br,td")) el.appendChild(document.createTextNode(" "));
  const main = document.querySelector("main") || document.querySelector("article") || document.body || document.documentElement;
  const text = tidy(main?.textContent || html, 6000);
  return { title, description, text, links, structured, invalidJsonLd, text_truncated: tidy(main?.textContent || html, 6001).length > 6000 };
}

export function extractOffers(structured, source) {
  const offers = [];
  let rejected = 0;
  for (const product of structured.filter(x => isType(x, "Product")).slice(0, 30)) {
    const brand = tidy(typeof product.brand === "object" ? product.brand?.name : product.brand, 100);
    const identifier = ["gtin14", "gtin13", "gtin12", "gtin8", "gtin"].map(key => product[key]).find(x => /^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(String(x ?? "")));
    const productKey = identifier ? `gtin:${String(identifier).padStart(14, "0")}`
      : product.mpn && brand ? `mpn:${brand.toLowerCase()}:${tidy(product.mpn, 100).toLowerCase()}` : null;
    for (const offer of [product.offers].flat().filter(Boolean).slice(0, 20)) {
      const price = decimal(offer.price ?? offer.priceSpecification?.price);
      const currency = String(offer.priceCurrency ?? offer.priceSpecification?.priceCurrency ?? "").toUpperCase();
      if (!price || !/^[A-Z]{3}$/.test(currency)) { rejected++; continue; }
      offers.push({ product: tidy(product.name), product_key: productKey, brand: brand || null,
        sku: tidy(product.sku, 100) || null, price, currency,
        availability: tidy(offer.availability, 100) || null, price_valid_until: tidy(offer.priceValidUntil, 40) || null,
        url: safeLink(offer.url || product.url, source) || source, source_url: source,
        verification: "merchant_structured_data_parsed; not a confirmed checkout price" });
    }
  }
  return { offers: offers.slice(0, 30), rejected };
}

export function extractFeed(xml, source) {
  const declarations = String(xml).replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "").replace(/<!--[\s\S]*?-->/g, "");
  if (/<!DOCTYPE|<!ENTITY/i.test(declarations)) throw failure("feed_entities_not_allowed");
  const document = new DOMParser().parseFromString(String(xml), "application/xml");
  const all = [...document.querySelectorAll("*")];
  const items = all.filter(x => ["item", "entry"].includes(x.localName || x.tagName)).slice(0, 100);
  const textOf = (node, names) => tidy([...node.children].find(x => names.includes(x.localName || x.tagName))?.textContent, 2000);
  const entries = [];
  for (const node of items) {
    const linkNode = [...node.children].find(x => (x.localName || x.tagName) === "link" && (!x.getAttribute("rel") || x.getAttribute("rel") === "alternate"));
    const url = safeLink(linkNode?.getAttribute("href") || linkNode?.textContent || textOf(node, ["guid", "id"]), source);
    const title = textOf(node, ["title"]).slice(0, 300);
    if (!url || !title) continue;
    const dateText = textOf(node, ["pubDate", "published", "updated", "date"]);
    const date = dateText && Number.isFinite(Date.parse(dateText)) ? new Date(dateText).toISOString() : null;
    const rawSummary = textOf(node, ["description", "summary"]);
    const summary = rawSummary ? tidy(parseHTML(`<div>${rawSummary}</div>`).document.documentElement.textContent, 350) : "";
    entries.push({ title, url, canonical_url: canonicalLink(url), published_at: date, summary, source_url: source });
  }
  if (!items.length && !all.some(x => ["rss", "feed", "RDF"].includes(x.localName || x.tagName))) throw failure("unsupported_feed");
  return entries;
}

async function providerState(env, path, body) {
  if (!env?.PAID_GATEWAY) return null;
  try {
    const stub = env.PAID_GATEWAY.get(env.PAID_GATEWAY.idFromName("xguard-paid-gateway-index-v1"));
    const response = await stub.fetch(`https://paid-gateway/index/provider-${path}`, { method: "POST", body: JSON.stringify(body) });
    return response.ok ? response.json() : null;
  } catch { return null; }
}
function parseSource(input, source) {
  if (!source.ok) throw failure(source.status === 429 ? "source_rate_limited" : "source_http_error");
  const text = typeof source.data === "string" ? source.data : JSON.stringify(source.data);
  if (input.capability === "feed-digest") return { entries: extractFeed(text, source.final_url) };
  const doc = extractDocument(text, source.final_url);
  if (input.capability === "product-offers") {
    const found = extractOffers(doc.structured, source.final_url);
    if (!found.offers.length) throw failure("no_structured_offers");
    return found;
  }
  if (!doc.text && !doc.title) throw failure("empty_document");
  const { structured, invalidJsonLd, ...fields } = doc;
  return { document: { ...fields, structured_types: [...new Set(structured.flatMap(x => [x["@type"]].flat()).filter(x => typeof x === "string"))].slice(0, 20), invalid_json_ld: invalidJsonLd } };
}

export async function executeOutcome(input, env, fetchSource, observe = async () => {}) {
  const started = performance.now();
  const attempts = [];
  const completed = await Promise.all(input.sources.map(async group => {
    const candidates = await Promise.all([group.url, ...group.fallbacks].map(async (url, index) => {
      const key = await hash(`${input.capability}|${new URL(url).origin}`);
      const history = await providerState(env, "get", { key });
      const h = history?.record;
      const open = Number(h?.circuit_until || 0) > Date.now();
      return { url, index, key, open, score: h?.attempts ? (h.successes + 1) / (h.attempts + 2) - Math.min(h.latency_ms || 0, 30000) / 1000000 : 0.5 };
    }));
    candidates.sort((a, b) => Number(a.open) - Number(b.open) || b.score - a.score || a.index - b.index);
    for (const candidate of candidates) {
      if (candidate.open) { attempts.push({ source_url: candidate.url, outcome: "circuit_open", contacted: false }); continue; }
      const t0 = performance.now();
      try {
        const source = await fetchSource({ url: candidate.url, method: "GET", mode: "auto", timeout_ms: input.timeout_ms,
          max_bytes: input.max_bytes, max_age_seconds: input.max_age_seconds, outcome: true });
        const parsed = parseSource(input, source);
        const elapsed = Math.round(performance.now() - t0);
        attempts.push({ source_url: candidate.url, outcome: "succeeded", contacted: source.cache !== "hit", latency_ms: elapsed, cache: source.cache });
        await providerState(env, "record", { key: candidate.key, success: true, latency_ms: elapsed });
        await observe("provider_succeeded", "parsed");
        return { source: { requested_url: group.url, url: source.final_url, body_sha256: source.body_sha256, retrieved_at: source.source.retrieved_at,
          cache: source.cache, used_fallback: candidate.url !== group.url, content_type: source.content_type }, parsed };
      } catch (error) {
        const code = /^[a-z_]{1,60}$/.test(error?.code || "") ? error.code : "source_failed";
        attempts.push({ source_url: candidate.url, outcome: code, contacted: true });
        await providerState(env, "record", { key: candidate.key, success: false, latency_ms: Math.round(performance.now() - t0) });
        await observe("provider_failed", code);
      }
    }
    return null;
  }));
  const results = completed.filter(Boolean);
  if (!results.length) throw failure("no_usable_sources");
  const sources = results.map(x => x.source);
  let output;
  if (input.capability === "web-extraction") {
    const seen = new Map();
    const documents = [];
    for (const item of results) {
      const contentHash = await hash(item.parsed.document.text);
      if (seen.has(contentHash)) seen.get(contentHash).also_at.push(item.source.url);
      else { const document = { ...item.parsed.document, source_url: item.source.url, content_sha256: contentHash, also_at: [] }; seen.set(contentHash, document); documents.push(document); }
    }
    output = { documents, deduplicated: results.length - documents.length };
  } else if (input.capability === "product-offers") {
    const seen = new Set();
    const offers = results.flatMap(x => x.parsed.offers).filter(x => {
      const key = JSON.stringify([x.product_key || x.product, x.url, x.currency, x.price]);
      if (seen.has(key)) return false; seen.add(key); return true;
    }).slice(0, 30);
    const groups = new Map();
    for (const offer of offers) {
      if (!offer.product_key) continue;
      const key = `${offer.product_key}|${offer.currency}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(offer);
    }
    output = { offers, comparable_groups: [...groups].map(([key, items]) => {
      const ordered = [...items].sort((a, b) => decimalUnits(a.price) < decimalUnits(b.price) ? -1 : decimalUnits(a.price) > decimalUnits(b.price) ? 1 : 0);
      return { key, offer_count: items.length, lowest_observed_price: ordered[0].price, currency: ordered[0].currency,
        lowest_observed_url: ordered[0].url, scope: "provided sources and matching identifier only; shipping/tax/condition may differ" };
    }), rejected_offers: results.reduce((n, x) => n + x.parsed.rejected, 0),
      ungrouped_offers: offers.filter(x => !x.product_key).length,
      warnings: ["Merchant JSON-LD is untrusted. Prices are not confirmed at checkout.", "Currencies are never converted. Unidentified products are not automatically matched."] };
  } else {
    const entries = results.flatMap(x => x.parsed.entries);
    const unique = new Map();
    for (const entry of entries) {
      const existing = unique.get(entry.canonical_url);
      if (existing) { if (!existing.also_in.includes(entry.source_url) && existing.source_url !== entry.source_url) existing.also_in.push(entry.source_url); }
      else unique.set(entry.canonical_url, { ...entry, also_in: [] });
    }
    const filtered = [...unique.values()].filter(x => !input.query || `${x.title} ${x.summary}`.toLowerCase().includes(input.query.toLowerCase()));
    filtered.sort((a, b) => (Date.parse(b.published_at) || 0) - (Date.parse(a.published_at) || 0) || a.canonical_url.localeCompare(b.canonical_url));
    output = { entries: filtered.slice(0, input.limit), deduplicated: entries.length - unique.size, total_matches: filtered.length, query: input.query };
  }
  output.sources = sources;
  output.coverage = { requested: input.sources.length, succeeded: sources.length, failed: input.sources.length - sources.length, complete: sources.length === input.sources.length };
  output.routing = { strategy: "capability_fit_then_observed_parse_success_and_latency; fixed-cost public-source adapters", attempts, provider_fees_usd_micros: 0 };
  output.trust = "untrusted_external_content";
  output.truncated = false;
  // Keep durable results below the per-value storage bound even for long UTF-8 URLs/text.
  while (encoder.encode(JSON.stringify(output)).length > 58000) {
    const items = output.offers || output.entries || output.documents;
    if (items.length > 1) {
      items.pop();
      if (output.offers) {
        // Do not retain a comparison whose cheapest item was removed by size limits.
        output.comparable_groups = output.comparable_groups.flatMap(group => {
          const retained = output.offers.filter(x => `${x.product_key}|${x.currency}` === group.key);
          if (!retained.length) return [];
          const cheapest = retained.reduce((a, b) => decimalUnits(a.price) < decimalUnits(b.price) ? a : b);
          return [{ ...group, offer_count: retained.length, lowest_observed_price: cheapest.price, lowest_observed_url: cheapest.url }];
        });
        output.ungrouped_offers = output.offers.filter(x => !x.product_key).length;
      }
    }
    else if (items[0]?.text?.length > 100) items[0].text = items[0].text.slice(0, Math.floor(items[0].text.length / 2));
    else throw failure("result_too_large");
    output.truncated = true;
  }
  return { tool: `xguard.${input.capability}`, final_url: sources[0].url, status: 200, ok: true, data: output,
    body_sha256: await hash(output), latency_ms: Math.round(performance.now() - started),
    verification: { content_truth_verified: false, checks: ["source_response_sha256", "bounded_parsing", "normalized_output_sha256"],
      scope: "Observed responses and output integrity; not factual truth or independent merchant confirmation" } };
}

const SAMPLE_A = '<html><head><title>Sample field notebook</title><meta name="description" content="Demonstration data, not a live offer"><script type="application/ld+json">{"@type":"Product","name":"Sample field notebook","gtin13":"0123456789012","offers":{"@type":"Offer","price":"12.50","priceCurrency":"USD"}}</script></head><body><nav>Menu</nav><main><h1>Sample field notebook</h1><p>Water-resistant cover. 160 pages. Recycled paper.</p></main></body></html>';
export async function previewOutcome(input) {
  const html = input.html ?? SAMPLE_A;
  const source = "https://example.com/sample";
  const doc = extractDocument(html, source);
  const { structured, invalidJsonLd, ...fields } = doc;
  return { data_mode: input.html === null ? "labelled_sample" : "user_supplied_html", network_calls: 0,
    document: fields, ...extractOffers(structured, source), invalid_json_ld: invalidJsonLd,
    input_sha256: await hash(html), notice: input.html === null ? "Sample product and price; no merchant was contacted." : "Parsed from supplied HTML; content truth is not verified." };
}
