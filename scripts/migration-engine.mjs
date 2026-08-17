import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const XGUARD_ORIGIN = "https://xguardgate.com";
const BASE_MAINNET = "eip155:8453";
const USER_AGENT =
  "XGuard-Migration-Engine/1.0 (+https://github.com/moelayyan90/XGuard)";
const KNOWN_FACILITATOR_BASES = [
  "https://facilitator.payai.network",
  "https://api.cdp.coinbase.com/platform/v2/x402",
];
const REPOSITORY_PREFIXES = new Set([
  "api",
  "app",
  "mcp",
  "tools",
  "x402",
  "www",
]);
const MIGRATION_PATH_HINTS = [
  "x402",
  "facilitator",
  "payment",
  "settle",
  "middleware",
  "server",
  "route",
  "config",
  "index",
  "package.json",
];

function envInt(name, fallback, min, max) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function githubHeaders(token, accept = "application/vnd.github+json") {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    "User-Agent": USER_AGENT,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: githubHeaders(token),
    redirect: "manual",
    signal: AbortSignal.timeout(
      envInt("XGUARD_MIGRATION_TIMEOUT_MS", 8_000, 1_000, 30_000),
    ),
  });
  const text = await response.text();
  let body;
  try {
    body = text.length ? JSON.parse(text) : {};
  } catch {
    throw new Error(`non_json_response:${response.status}:${url}`);
  }
  if (!response.ok) throw new Error(`http_${response.status}:${url}`);
  return body;
}

async function fetchText(url, token) {
  const response = await fetch(url, {
    headers: githubHeaders(token, "application/vnd.github.raw+json"),
    redirect: "manual",
    signal: AbortSignal.timeout(
      envInt("XGUARD_MIGRATION_TIMEOUT_MS", 8_000, 1_000, 30_000),
    ),
  });
  if (!response.ok) throw new Error(`http_${response.status}:${url}`);
  return response.text();
}

function cleanRepoFullName(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.hostname !== "github.com") return null;
    const [owner, repo] = url.pathname.split("/").filter(Boolean);
    if (!owner || !repo) return null;
    return `${owner}/${repo.replace(/\.git$/i, "")}`;
  } catch {
    return null;
  }
}

function priorityRank(value) {
  if (value === "P0") return 0;
  if (value === "P1") return 1;
  if (value === "P2") return 2;
  return 3;
}

function repositorySearchTerm(packet) {
  if (typeof packet?.target !== "string") return null;
  const raw = packet.target.trim().toLowerCase();
  if (!raw) return null;
  let host = raw;
  try {
    host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname;
  } catch {
    // Keep the raw target when it is not parseable as a URL.
  }
  const labels = host
    .replace(/^www\./, "")
    .split(".")
    .filter(Boolean);
  if (labels.length === 0) return null;
  const first = labels[0];
  const core =
    labels.length > 1 && REPOSITORY_PREFIXES.has(first) ? labels[1] : first;
  if (!core || core.length < 2) return null;
  return core.replace(/[^a-z0-9_-]/g, "");
}

async function searchRepositories(token, query, perPage = 10) {
  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", query);
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("sort", "updated");
  url.searchParams.set("order", "desc");
  const body = await fetchJson(url, token);
  return Array.isArray(body?.items) ? body.items : [];
}

function repositoryCandidateScore(item, packet, term) {
  const target = String(packet?.target ?? "").toLowerCase();
  const name = String(item?.name ?? "").toLowerCase();
  const fullName = String(item?.full_name ?? "").toLowerCase();
  const description = String(item?.description ?? "").toLowerCase();
  const homepage = String(item?.homepage ?? "").toLowerCase();
  const topics = Array.isArray(item?.topics)
    ? item.topics.map((topic) => String(topic).toLowerCase())
    : [];
  let score = 0;
  if (name === term) score += 60;
  if (name.includes(term)) score += 45;
  if (fullName.includes(term)) score += 25;
  if (description.includes(term)) score += 15;
  if (homepage.includes(target)) score += 80;
  if (homepage.includes(term)) score += 35;
  if (topics.includes("x402")) score += 40;
  if (/x402/i.test(description)) score += 20;
  if (item?.archived || item?.disabled) score -= 100;
  if (item?.fork) score -= 10;
  return score;
}

async function discoverRepositories(packet, token) {
  const direct = cleanRepoFullName(packet?.target);
  if (direct)
    return [{ fullName: direct, source: "direct-target", evidence: [] }];
  const term = repositorySearchTerm(packet);
  if (!term) return [];
  try {
    const items = await searchRepositories(token, `${term} x402`, 10);
    const ranked = items
      .filter(
        (item) =>
          item?.full_name &&
          item.full_name !== "moelayyan90/XGuard" &&
          !item?.archived &&
          !item?.disabled,
      )
      .map((item) => ({
        fullName: item.full_name,
        source: "github-repository-search",
        evidence: [term],
        repositorySearchScore: repositoryCandidateScore(item, packet, term),
      }))
      .filter((repo) => repo.repositorySearchScore > 0)
      .sort((a, b) => b.repositorySearchScore - a.repositorySearchScore);
    return ranked.slice(
      0,
      envInt("XGUARD_MIGRATION_REPOS_PER_TARGET", 3, 1, 10),
    );
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "migration_repo_search_failed",
        target: packet?.target,
        term,
        error: String(error),
      }),
    );
    return [];
  }
}

function interestingPath(path) {
  if (typeof path !== "string") return false;
  if (/\.(lock|map|min\.js)$/i.test(path)) return false;
  if (/(^|\/)(dist|build|vendor|node_modules|coverage)(\/|$)/i.test(path))
    return false;
  return /\.(?:[cm]?[jt]sx?|json|ya?ml|toml|env|md)$/i.test(path);
}

function migrationPathScore(path) {
  if (!interestingPath(path)) return -1;
  const lower = path.toLowerCase();
  const base = lower.split("/").at(-1) ?? lower;
  let score = 0;
  if (base === "package.json") score += 70;
  if (base === "wrangler.toml" || base === "wrangler.jsonc") score += 45;
  if (/\.(?:[cm]?[jt]sx?)$/i.test(base)) score += 15;
  for (const hint of MIGRATION_PATH_HINTS) {
    if (lower.includes(hint)) score += hint === "x402" ? 60 : 20;
  }
  const depth = path.split("/").length - 1;
  if (depth <= 2) score += 15;
  if (/readme\.md$/i.test(base)) score += 10;
  return score;
}

function encodeRepositoryPath(path) {
  return String(path)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function discoverMigrationFiles(fullName, defaultBranch, token) {
  const branch = defaultBranch || "main";
  let tree;
  try {
    tree = await fetchJson(
      `https://api.github.com/repos/${fullName}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      token,
    );
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "migration_tree_scan_failed",
        repo: fullName,
        branch,
        error: String(error),
      }),
    );
    return [];
  }
  const candidates = (Array.isArray(tree?.tree) ? tree.tree : [])
    .filter((entry) => entry?.type === "blob" && interestingPath(entry?.path))
    .filter((entry) => Number(entry?.size ?? 0) <= 250_000)
    .map((entry) => ({
      path: entry.path,
      score: migrationPathScore(entry.path),
      size: Number(entry?.size ?? 0),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.size - b.size)
    .slice(0, envInt("XGUARD_MIGRATION_FILES_PER_REPO", 12, 1, 30));
  return candidates.map((entry) => ({
    path: entry.path,
    apiUrl: `https://api.github.com/repos/${fullName}/contents/${encodeRepositoryPath(entry.path)}?ref=${encodeURIComponent(branch)}`,
    htmlUrl: `https://github.com/${fullName}/blob/${encodeURIComponent(branch)}/${entry.path}`,
    terms: ["repository-tree-fallback"],
    pathScore: entry.score,
  }));
}

function facilitatorReferences(content) {
  const refs = [];
  for (const base of KNOWN_FACILITATOR_BASES) {
    if (content.includes(base)) refs.push(base);
  }
  return refs;
}

function containsXGuardOrigin(content) {
  const source = String(content ?? "");
  const urls = source.match(/https?:\/\/[^\s"'`<>)}\]]+/g) ?? [];
  return urls.some((candidate) => {
    try {
      return new URL(candidate).origin === XGUARD_ORIGIN;
    } catch {
      return false;
    }
  });
}

function authSnippet() {
  return [
    "const createAuthHeaders = async () => {",
    "  const headers = {",
    "    Authorization: `Bearer ${process.env.XGUARD_API_KEY!}`,",
    "  };",
    "  return { verify: headers, settle: headers, supported: headers, bazaar: headers };",
    "};",
  ].join("\n");
}

export function analyzeMigrationFile(content, path = "unknown") {
  const text = String(content ?? "");
  const refs = facilitatorReferences(text);
  const usesStandardClient = /\bHTTPFacilitatorClient\b/.test(text);
  const hasCreateAuthHeaders = /\bcreateAuthHeaders\b/.test(text);
  const alreadyXGuard =
    containsXGuardOrigin(text) || /\bXGUARD_API_KEY\b/.test(text);
  const mentionsX402 = /@x402\/|\bx402\b/i.test(text);
  const exactBaseReplacements = refs.map((from) => ({
    kind: "replace-facilitator-base",
    from,
    to: XGUARD_ORIGIN,
  }));

  let mode = "manual-review";
  if (alreadyXGuard) mode = "already-xguard";
  else if (usesStandardClient && refs.length > 0 && hasCreateAuthHeaders)
    mode = "url-replacement-ready";
  else if (usesStandardClient && refs.length > 0)
    mode = "url-and-auth-required";
  else if (refs.length > 0) mode = "config-reference-found";
  else if (usesStandardClient) mode = "standard-client-review";

  const requiredChanges = [];
  if (!alreadyXGuard && refs.length > 0) {
    requiredChanges.push(
      `Replace the incumbent facilitator base URL with ${XGUARD_ORIGIN}.`,
    );
  }
  if (!alreadyXGuard && usesStandardClient && !hasCreateAuthHeaders) {
    requiredChanges.push(
      "Attach XGUARD_API_KEY through createAuthHeaders for verify, settle, supported, and bazaar requests.",
    );
  }
  if (!alreadyXGuard && mentionsX402 && refs.length === 0) {
    requiredChanges.push(
      "Resolve the project's facilitator configuration indirection before changing any code.",
    );
  }

  return {
    path,
    mode,
    mentionsX402,
    usesStandardClient,
    hasCreateAuthHeaders,
    alreadyXGuard,
    facilitatorReferences: refs,
    autoPatchable:
      !alreadyXGuard &&
      usesStandardClient &&
      hasCreateAuthHeaders &&
      refs.length > 0,
    patchOperations: exactBaseReplacements,
    requiredChanges,
    requiredEnvironment: alreadyXGuard ? [] : ["XGUARD_URL", "XGUARD_API_KEY"],
    createAuthHeadersSnippet:
      !alreadyXGuard && usesStandardClient && !hasCreateAuthHeaders
        ? authSnippet()
        : null,
  };
}

async function scanRepository(repo, token) {
  let metadata = null;
  try {
    metadata = await fetchJson(
      `https://api.github.com/repos/${repo.fullName}`,
      token,
    );
  } catch (error) {
    return {
      ...repo,
      status: "repository-unavailable",
      error: String(error),
      files: [],
    };
  }
  if (metadata?.archived || metadata?.disabled) {
    return {
      ...repo,
      status: "inactive-repository",
      archived: Boolean(metadata?.archived),
      disabled: Boolean(metadata?.disabled),
      defaultBranch: metadata?.default_branch ?? null,
      files: [],
    };
  }

  const hits = await discoverMigrationFiles(
    repo.fullName,
    metadata?.default_branch,
    token,
  );
  const files = [];
  for (const hit of hits) {
    try {
      const content = await fetchText(hit.apiUrl, token);
      if (content.length > 250_000) continue;
      files.push({
        ...hit,
        analysis: analyzeMigrationFile(content, hit.path),
      });
    } catch (error) {
      files.push({ ...hit, error: String(error), analysis: null });
    }
  }

  const patchReady = files.filter(
    (file) => file.analysis?.autoPatchable,
  ).length;
  const alreadyXGuard = files.filter(
    (file) => file.analysis?.alreadyXGuard,
  ).length;
  const actionable = files.filter(
    (file) =>
      file.analysis &&
      !file.analysis.alreadyXGuard &&
      (file.analysis.facilitatorReferences.length > 0 ||
        file.analysis.usesStandardClient),
  ).length;

  return {
    ...repo,
    status:
      alreadyXGuard > 0
        ? "already-xguard"
        : patchReady > 0
          ? "patch-ready"
          : actionable > 0
            ? "migration-review-ready"
            : "no-migration-config-found",
    defaultBranch: metadata?.default_branch ?? null,
    pushedAt: metadata?.pushed_at ?? null,
    stars: Number(metadata?.stargazers_count ?? 0),
    fork: Boolean(metadata?.fork),
    files,
    patchReadyFileCount: patchReady,
    actionableFileCount: actionable,
  };
}

function targetStatus(repositories) {
  if (repositories.some((repo) => repo.status === "patch-ready"))
    return "patch-ready";
  if (repositories.some((repo) => repo.status === "migration-review-ready"))
    return "migration-review-ready";
  if (repositories.some((repo) => repo.status === "already-xguard"))
    return "already-xguard";
  if (repositories.length === 0) return "repository-not-resolved";
  return "no-actionable-config";
}

export function buildTargetPlan(packet, repositories) {
  return {
    target: packet?.target ?? null,
    kind: packet?.kind ?? null,
    priority: packet?.priority ?? "P3",
    conversionScore: Number(packet?.conversionScore ?? 0),
    confidence: packet?.confidence ?? null,
    live402Count: Number(packet?.live402Count ?? 0),
    resourceCount: Number(packet?.resourceCount ?? 0),
    mcpResourceCount: Number(packet?.mcpResourceCount ?? 0),
    incumbentHints: Array.isArray(packet?.incumbentHints)
      ? packet.incumbentHints
      : [],
    sampleResources: Array.isArray(packet?.sampleResources)
      ? packet.sampleResources.slice(0, 5)
      : [],
    status: targetStatus(repositories),
    repositories,
    automationBoundary: {
      readsPublicMetadataAndCode: true,
      changesThirdPartyInfrastructure: false,
      opensThirdPartyPullRequests: false,
      movesFunds: false,
      createsSyntheticPayments: false,
      sendsOutreach: false,
    },
  };
}

function renderMarkdown(report) {
  const rows = report.plans.slice(0, 50).map((plan) => {
    const repos =
      plan.repositories.map((repo) => repo.fullName).join(", ") || "unresolved";
    const patchReady = plan.repositories.reduce(
      (sum, repo) => sum + Number(repo.patchReadyFileCount ?? 0),
      0,
    );
    return `| ${plan.priority} | ${plan.conversionScore} | ${plan.target} | ${plan.status} | ${repos} | ${patchReady} | ${plan.live402Count} |`;
  });

  const details = report.plans.slice(0, 15).flatMap((plan, index) => {
    const lines = [
      `### ${index + 1}. ${plan.target}`,
      "",
      `- Status: **${plan.status}**`,
      `- Conversion evidence: ${plan.live402Count} live 402 / ${plan.resourceCount} public paid resources`,
    ];
    for (const repo of plan.repositories.slice(0, 3)) {
      lines.push(`- Repository: ${repo.fullName} — ${repo.status}`);
      for (const file of repo.files?.slice(0, 4) ?? []) {
        if (!file.analysis) continue;
        lines.push(
          `  - ${file.path}: ${file.analysis.mode}${file.analysis.autoPatchable ? " (exact URL replacement ready)" : ""}`,
        );
      }
    }
    lines.push("");
    return lines;
  });

  return [
    "# XGuard Migration Engine",
    "",
    `Generated: ${report.generatedAt}`,
    `Targets inspected: ${report.targetCount}`,
    `Patch-ready targets: ${report.patchReadyTargetCount}`,
    `Review-ready targets: ${report.reviewReadyTargetCount}`,
    "",
    "This report converts public x402 adoption evidence into repository/file-level migration packets. It is read-only against third-party projects: no pull requests, outreach, payments, or infrastructure changes are performed automatically.",
    "",
    "| Priority | Score | Target | Migration status | Repository candidates | Patch-ready files | Live 402 |",
    "| --- | ---: | --- | --- | --- | ---: | ---: |",
    ...rows,
    "",
    "## Highest-impact migration packets",
    "",
    ...details,
  ].join("\n");
}

export function selfTest() {
  const noAuth = analyzeMigrationFile(
    'const client = new HTTPFacilitatorClient({ url: "https://facilitator.payai.network" });',
    "src/payments.ts",
  );
  if (noAuth.mode !== "url-and-auth-required" || noAuth.autoPatchable) {
    throw new Error("self_test_auth_gate_failed");
  }
  if (!noAuth.createAuthHeadersSnippet?.includes("XGUARD_API_KEY")) {
    throw new Error("self_test_auth_snippet_failed");
  }

  const withAuth = analyzeMigrationFile(
    'const client = new HTTPFacilitatorClient({ url: "https://facilitator.payai.network", createAuthHeaders });',
    "src/payments.ts",
  );
  if (!withAuth.autoPatchable || withAuth.patchOperations.length !== 1) {
    throw new Error("self_test_patch_ready_failed");
  }

  const already = analyzeMigrationFile(
    `const url = "${XGUARD_ORIGIN}"; const key = process.env.XGUARD_API_KEY;`,
    "src/payments.ts",
  );
  if (already.mode !== "already-xguard") {
    throw new Error("self_test_already_xguard_failed");
  }

  const lookalike = analyzeMigrationFile(
    `const url = "https://attacker.example/?next=${encodeURIComponent(XGUARD_ORIGIN)}";`,
    "src/payments.ts",
  );
  if (lookalike.alreadyXGuard) {
    throw new Error("self_test_xguard_origin_boundary_failed");
  }

  const plan = buildTargetPlan(
    { target: "api.example.com", priority: "P0", conversionScore: 90 },
    [{ fullName: "owner/repo", status: "patch-ready", files: [] }],
  );
  if (plan.status !== "patch-ready") {
    throw new Error("self_test_target_status_failed");
  }

  if (
    cleanRepoFullName("https://github.com/acme/payments") !== "acme/payments"
  ) {
    throw new Error("self_test_repo_parse_failed");
  }
  return true;
}

async function main() {
  if (process.argv.includes("--self-test")) {
    selfTest();
    console.log(JSON.stringify({ migrationSelfTest: true }));
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token)
    throw new Error("GITHUB_TOKEN is required for migration discovery");

  const input = process.env.XGUARD_CONVERSION_JSON ?? "conversion-queue.json";
  const queue = JSON.parse(await readFile(input, "utf8"));
  const maxTargets = envInt("XGUARD_MIGRATION_TARGET_LIMIT", 25, 1, 100);
  const packets = (Array.isArray(queue?.packets) ? queue.packets : [])
    .slice()
    .sort(
      (a, b) =>
        priorityRank(a?.priority) - priorityRank(b?.priority) ||
        Number(b?.conversionScore ?? 0) - Number(a?.conversionScore ?? 0),
    )
    .slice(0, maxTargets);

  const plans = [];
  for (const packet of packets) {
    const repos = await discoverRepositories(packet, token);
    const scanned = [];
    for (const repo of repos) scanned.push(await scanRepository(repo, token));
    plans.push(buildTargetPlan(packet, scanned));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    network: queue?.network ?? BASE_MAINNET,
    sourceConversionTargetCount: Number(
      queue?.conversionTargetCount ?? packets.length,
    ),
    targetCount: plans.length,
    patchReadyTargetCount: plans.filter((plan) => plan.status === "patch-ready")
      .length,
    reviewReadyTargetCount: plans.filter(
      (plan) => plan.status === "migration-review-ready",
    ).length,
    plans,
  };

  await writeFile(
    process.env.XGUARD_MIGRATION_JSON ?? "migration-queue.json",
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await writeFile(
    process.env.XGUARD_MIGRATION_MARKDOWN ?? "migration-queue.md",
    renderMarkdown(report),
  );
  console.log(
    JSON.stringify({
      event: "migration_queue_ready",
      targets: report.targetCount,
      patchReady: report.patchReadyTargetCount,
      reviewReady: report.reviewReadyTargetCount,
    }),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        event: "migration_engine_failed",
        error: String(error),
      }),
    );
    process.exitCode = 1;
  });
}
