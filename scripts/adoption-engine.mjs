import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const BASE_MAINNET = "eip155:8453";
const XGUARD_ORIGIN = "https://xguard-mainnet.maqamapp.workers.dev";
const DEFAULT_SOURCES = [
  {
    id: "cdp-bazaar",
    url: "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources",
    incumbentHint: "cdp",
  },
  {
    id: "payai-bazaar",
    url: "https://facilitator.payai.network/discovery/resources",
    incumbentHint: "payai",
  },
];

const GITHUB_CODE_QUERIES = [
  '"@x402/express"',
  '"@x402/hono"',
  '"@x402/mcp"',
  '"createFacilitatorConfig" x402',
  '"facilitator.payai.network"',
];

const GITHUB_PAIN_QUERIES = [
  'x402 Bazaar "not indexed"',
  'x402 facilitator "not appearing" Bazaar',
  'x402 "EXTENSION-RESPONSES"',
  'x402 "Payment response header not found"',
];

const USER_AGENT = "XGuard-Adoption-Engine/1.0 (+https://github.com/moelayyan90/XGuard)";

function envInt(name, fallback, min, max) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function cleanUrl(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function acceptsBaseMainnet(item) {
  return Array.isArray(item?.accepts)
    ? item.accepts.some(
        (accept) =>
          accept?.network === BASE_MAINNET &&
          (accept?.scheme === undefined || accept?.scheme === "exact"),
      )
    : false;
}

function hasBazaarMetadata(item) {
  return Boolean(item?.extensions && typeof item.extensions === "object" && item.extensions.bazaar);
}

function looksLikeMcp(item) {
  const resource = String(item?.resource ?? "").toLowerCase();
  const type = String(item?.type ?? "").toLowerCase();
  const description = JSON.stringify(item?.extensions ?? {}).toLowerCase();
  return type === "mcp" || resource.includes("/mcp") || description.includes("mcp");
}

function priceMicroUsd(item) {
  if (!Array.isArray(item?.accepts)) return null;
  for (const accept of item.accepts) {
    if (accept?.network !== BASE_MAINNET) continue;
    const raw = accept.amount ?? accept.maxAmountRequired;
    const amount = typeof raw === "string" ? Number.parseInt(raw, 10) : raw;
    if (Number.isSafeInteger(amount) && amount >= 0) return amount;
  }
  return null;
}

export function normalizeBazaarItem(item, source) {
  const resource = cleanUrl(item?.resource ?? item?.url);
  if (!resource) return null;
  const payTo = Array.isArray(item?.accepts)
    ? item.accepts.find((entry) => entry?.network === BASE_MAINNET)?.payTo ?? null
    : null;
  return {
    id: `resource:${resource}`,
    candidateType: "resource",
    resource,
    host: new URL(resource).host,
    source: source.id,
    incumbentHint: source.incumbentHint,
    baseMainnet: acceptsBaseMainnet(item),
    bazaarMetadata: hasBazaarMetadata(item),
    mcp: looksLikeMcp(item),
    payTo,
    priceMicroUsd: priceMicroUsd(item),
    lastUpdated: Number.isFinite(item?.lastUpdated) ? item.lastUpdated : null,
    repoUrl: null,
    issueUrl: null,
    painSignal: null,
    probe: null,
  };
}

function scoreCandidate(candidate) {
  let score = 0;
  const reasons = [];
  if (candidate.baseMainnet) {
    score += 30;
    reasons.push("Base mainnet compatible");
  }
  if (candidate.bazaarMetadata) {
    score += 15;
    reasons.push("already declares Bazaar metadata");
  }
  if (candidate.mcp) {
    score += 12;
    reasons.push("agent/MCP-facing resource");
  }
  if (candidate.probe?.status === 402) {
    score += 20;
    reasons.push("live endpoint returned HTTP 402");
  }
  if (candidate.probe?.paymentRequired) {
    score += 8;
    reasons.push("PAYMENT-REQUIRED header observed");
  }
  if (candidate.repoUrl) {
    score += 8;
    reasons.push("public repository found");
  }
  if (candidate.issueUrl && candidate.painSignal) {
    score += 30;
    reasons.push("public facilitator/discovery pain signal");
  }
  if (candidate.incumbentHint === "cdp" || candidate.incumbentHint === "payai") {
    score += 5;
    reasons.push(`known incumbent hint: ${candidate.incumbentHint}`);
  }
  return { score: Math.min(100, score), reasons };
}

function recipeFor(candidate) {
  const steps = [
    "Register the service with POST https://xguard-mainnet.maqamapp.workers.dev/v1/register and retain the returned API key.",
    "Point the standard x402 HTTPFacilitatorClient base URL at https://xguard-mainnet.maqamapp.workers.dev and attach the API key to verify/settle/supported/bazaar requests.",
    "Run the existing x402 paid endpoint unchanged; XGuard remains protocol-compatible and does not require an XGuard runtime package.",
    "Confirm /verify and /settle succeed, then verify the resource appears in XGuard /discovery/resources after a successful Bazaar-bearing settlement.",
  ];
  if (candidate.incumbentHint === "cdp") {
    steps.unshift("Replace the CDP facilitator client/configuration only; keep the resource server payment requirements and payTo unchanged.");
  } else if (candidate.incumbentHint === "payai") {
    steps.unshift("Replace the PayAI facilitator base URL only; keep the existing x402 middleware and payment requirements unchanged.");
  }
  return steps;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
      ...(options.headers ?? {}),
    },
    redirect: "manual",
    signal: AbortSignal.timeout(envInt("XGUARD_ADOPTION_TIMEOUT_MS", 8_000, 1_000, 30_000)),
  });
  const text = await response.text();
  let body;
  try {
    body = text.length ? JSON.parse(text) : {};
  } catch {
    throw new Error(`non_json_response:${response.status}:${url}`);
  }
  if (!response.ok) throw new Error(`http_${response.status}:${url}`);
  return { response, body };
}

async function collectBazaarSource(source) {
  const pageSize = envInt("XGUARD_ADOPTION_PAGE_SIZE", 100, 1, 100);
  const maxPages = envInt("XGUARD_ADOPTION_MAX_PAGES", 100, 1, 250);
  const candidates = [];
  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(source.url);
    url.searchParams.set("network", BASE_MAINNET);
    url.searchParams.set("limit", String(pageSize));
    url.searchParams.set("offset", String(page * pageSize));
    const { body } = await fetchJson(url);
    const items = Array.isArray(body?.items)
      ? body.items
      : Array.isArray(body?.resources)
        ? body.resources
        : [];
    for (const item of items) {
      const normalized = normalizeBazaarItem(item, source);
      if (normalized?.baseMainnet) candidates.push(normalized);
    }
    const total = Number(body?.pagination?.total ?? body?.total ?? Number.NaN);
    if (items.length < pageSize) break;
    if (Number.isFinite(total) && (page + 1) * pageSize >= total) break;
  }
  return candidates;
}

async function probeResource(candidate) {
  if (candidate.candidateType !== "resource" || !candidate.resource) return candidate;
  try {
    const response = await fetch(candidate.resource, {
      method: "GET",
      headers: { "User-Agent": USER_AGENT, Accept: "application/json,*/*;q=0.8" },
      redirect: "manual",
      signal: AbortSignal.timeout(envInt("XGUARD_ADOPTION_PROBE_TIMEOUT_MS", 5_000, 1_000, 15_000)),
    });
    const paymentRequired =
      response.headers.has("payment-required") ||
      response.headers.has("x-payment-required") ||
      response.status === 402;
    return {
      ...candidate,
      probe: {
        status: response.status,
        paymentRequired,
        server: response.headers.get("server"),
      },
    };
  } catch (error) {
    return { ...candidate, probe: { status: null, paymentRequired: false, error: String(error) } };
  }
}

async function mapLimit(items, concurrency, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      output[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return output;
}

async function githubSearch(token) {
  if (!token) return { repositories: [], painSignals: [] };
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const repositories = new Map();
  for (const query of GITHUB_CODE_QUERIES) {
    const url = new URL("https://api.github.com/search/code");
    url.searchParams.set("q", `${query} in:file`);
    url.searchParams.set("per_page", "50");
    try {
      const { body } = await fetchJson(url, { headers });
      for (const item of body?.items ?? []) {
        const repo = item?.repository;
        if (!repo?.full_name || repo.full_name === "moelayyan90/XGuard") continue;
        repositories.set(repo.full_name, {
          id: `repo:${repo.full_name}`,
          candidateType: "repository",
          resource: null,
          host: null,
          source: "github-code-search",
          incumbentHint: query.includes("payai") ? "payai" : query.includes("createFacilitatorConfig") ? "cdp" : null,
          baseMainnet: false,
          bazaarMetadata: false,
          mcp: query.includes("@x402/mcp"),
          payTo: null,
          priceMicroUsd: null,
          lastUpdated: null,
          repoUrl: repo.html_url,
          issueUrl: null,
          painSignal: null,
          probe: null,
        });
      }
    } catch (error) {
      console.warn(JSON.stringify({ event: "github_code_search_failed", query, error: String(error) }));
    }
  }

  const painSignals = [];
  for (const query of GITHUB_PAIN_QUERIES) {
    const url = new URL("https://api.github.com/search/issues");
    url.searchParams.set("q", `${query} is:issue`);
    url.searchParams.set("sort", "updated");
    url.searchParams.set("order", "desc");
    url.searchParams.set("per_page", "30");
    try {
      const { body } = await fetchJson(url, { headers });
      for (const issue of body?.items ?? []) {
        const repoUrl = String(issue?.repository_url ?? "").replace("https://api.github.com/repos/", "https://github.com/");
        if (!repoUrl || repoUrl.includes("/x402-foundation/x402")) continue;
        painSignals.push({
          id: `pain:${issue.id}`,
          candidateType: "pain-signal",
          resource: null,
          host: null,
          source: "github-issues-search",
          incumbentHint: null,
          baseMainnet: true,
          bazaarMetadata: true,
          mcp: /mcp/i.test(`${issue.title ?? ""} ${issue.body ?? ""}`),
          payTo: null,
          priceMicroUsd: null,
          lastUpdated: null,
          repoUrl,
          issueUrl: issue.html_url,
          painSignal: issue.title,
          probe: null,
        });
      }
    } catch (error) {
      console.warn(JSON.stringify({ event: "github_issue_search_failed", query, error: String(error) }));
    }
  }
  return { repositories: [...repositories.values()], painSignals };
}

function dedupe(candidates) {
  const map = new Map();
  for (const candidate of candidates) {
    const key = candidate.resource
      ? `resource:${candidate.resource}`
      : candidate.repoUrl
        ? `repo:${candidate.repoUrl}`
        : candidate.id;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, candidate);
      continue;
    }
    map.set(key, {
      ...existing,
      ...candidate,
      source: [...new Set([...(String(existing.source).split(",")), ...(String(candidate.source).split(","))])].join(","),
      baseMainnet: existing.baseMainnet || candidate.baseMainnet,
      bazaarMetadata: existing.bazaarMetadata || candidate.bazaarMetadata,
      mcp: existing.mcp || candidate.mcp,
      repoUrl: existing.repoUrl ?? candidate.repoUrl,
      issueUrl: existing.issueUrl ?? candidate.issueUrl,
      painSignal: existing.painSignal ?? candidate.painSignal,
    });
  }
  return [...map.values()];
}

function renderMarkdown(report) {
  const rows = report.candidates.slice(0, 50).map((candidate) => {
    const target = candidate.resource ?? candidate.repoUrl ?? candidate.issueUrl ?? candidate.id;
    const kind = candidate.mcp ? "MCP" : candidate.candidateType;
    const evidence = candidate.probe?.status === 402 ? "live 402" : candidate.painSignal ? "pain signal" : candidate.source;
    return `| ${candidate.score} | ${kind} | ${target} | ${candidate.incumbentHint ?? "unknown"} | ${evidence} |`;
  });
  return [
    "# XGuard Adoption Engine",
    "",
    `Generated: ${report.generatedAt}`,
    `Sources scanned: ${report.sources.join(", ")}`,
    `Candidates: ${report.candidates.length}`,
    "",
    "| Score | Type | Target | Incumbent hint | Evidence |",
    "| ---: | --- | --- | --- | --- |",
    ...rows,
    "",
    "## Operating rule",
    "",
    "This report uses public x402 metadata and public GitHub signals only. It never fabricates traffic, pays endpoints, or sends bulk outreach. Highest-scoring targets should receive a specific migration proposal tied to observed evidence.",
    "",
  ].join("\n");
}

export function selfTest() {
  const source = { id: "fixture", incumbentHint: "cdp" };
  const candidate = normalizeBazaarItem(
    {
      resource: "https://example.com/mcp",
      type: "mcp",
      accepts: [{ network: BASE_MAINNET, scheme: "exact", amount: "50000", payTo: "0x0000000000000000000000000000000000000001" }],
      extensions: { bazaar: { info: { description: "example" } } },
      lastUpdated: 1,
    },
    source,
  );
  if (!candidate?.baseMainnet || !candidate.mcp || !candidate.bazaarMetadata) throw new Error("self_test_normalization_failed");
  const scored = scoreCandidate({ ...candidate, probe: { status: 402, paymentRequired: true }, repoUrl: "https://github.com/example/repo" });
  if (scored.score < 80) throw new Error("self_test_scoring_failed");
  const wrongNetwork = normalizeBazaarItem(
    { resource: "https://example.com/solana", accepts: [{ network: "solana:mainnet" }] },
    source,
  );
  if (wrongNetwork?.baseMainnet) throw new Error("self_test_network_filter_failed");
  return true;
}

async function main() {
  if (process.argv.includes("--self-test")) {
    selfTest();
    console.log(JSON.stringify({ selfTest: true }));
    return;
  }

  const rawSources = process.env.XGUARD_ADOPTION_SOURCES;
  const sources = rawSources
    ? rawSources.split(",").map((url, index) => ({ id: `custom-${index + 1}`, url: url.trim(), incumbentHint: null })).filter((entry) => entry.url)
    : DEFAULT_SOURCES;

  const all = [];
  for (const source of sources) {
    try {
      const found = await collectBazaarSource(source);
      console.log(JSON.stringify({ event: "adoption_source_scanned", source: source.id, candidates: found.length }));
      all.push(...found);
    } catch (error) {
      console.warn(JSON.stringify({ event: "adoption_source_failed", source: source.id, error: String(error) }));
    }
  }

  const github = await githubSearch(process.env.GITHUB_TOKEN);
  all.push(...github.repositories, ...github.painSignals);

  let candidates = dedupe(all);
  const probeLimit = envInt("XGUARD_ADOPTION_PROBE_LIMIT", 75, 0, 250);
  const probeTargets = candidates
    .filter((candidate) => candidate.resource && candidate.baseMainnet)
    .sort((a, b) => Number(b.mcp) - Number(a.mcp) || Number(b.bazaarMetadata) - Number(a.bazaarMetadata))
    .slice(0, probeLimit);
  const probed = await mapLimit(probeTargets, envInt("XGUARD_ADOPTION_PROBE_CONCURRENCY", 8, 1, 20), probeResource);
  const probes = new Map(probed.map((candidate) => [candidate.id, candidate]));
  candidates = candidates.map((candidate) => probes.get(candidate.id) ?? candidate);

  candidates = candidates
    .map((candidate) => {
      const scored = scoreCandidate(candidate);
      return { ...candidate, ...scored, migrationRecipe: recipeFor(candidate) };
    })
    .filter((candidate) => candidate.score >= envInt("XGUARD_ADOPTION_MIN_SCORE", 25, 0, 100))
    .sort((a, b) => b.score - a.score || String(a.resource ?? a.repoUrl).localeCompare(String(b.resource ?? b.repoUrl)));

  const report = {
    generatedAt: new Date().toISOString(),
    xguardOrigin: XGUARD_ORIGIN,
    network: BASE_MAINNET,
    sources: sources.map((source) => source.id).concat(process.env.GITHUB_TOKEN ? ["github-code-search", "github-issues-search"] : []),
    candidateCount: candidates.length,
    live402Count: candidates.filter((candidate) => candidate.probe?.status === 402).length,
    painSignalCount: candidates.filter((candidate) => candidate.painSignal).length,
    candidates,
  };

  await writeFile(process.env.XGUARD_ADOPTION_JSON ?? "adoption-report.json", `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(process.env.XGUARD_ADOPTION_MARKDOWN ?? "adoption-report.md", renderMarkdown(report));
  console.log(JSON.stringify({
    event: "adoption_report_ready",
    candidates: report.candidateCount,
    live402: report.live402Count,
    painSignals: report.painSignalCount,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ event: "adoption_engine_failed", error: String(error) }));
    process.exitCode = 1;
  });
}
