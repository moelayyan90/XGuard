import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const XGUARD_ORIGIN = "https://xguardgate.com";
const USER_AGENT =
  "XGuard-Code-Switch-Engine/1.1 (+https://github.com/moelayyan90/XGuard)";
const INCUMBENT_URLS = [
  "https://facilitator.payai.network",
  "https://api.cdp.coinbase.com/platform/v2/x402",
];

function envInt(name, fallback, min, max) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function headers(token, accept = "application/vnd.github+json") {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    "User-Agent": USER_AGENT,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: headers(token),
    redirect: "manual",
    signal: AbortSignal.timeout(
      envInt("XGUARD_CODE_SWITCH_TIMEOUT_MS", 8_000, 1_000, 30_000),
    ),
  });
  const text = await response.text();
  let body;
  try {
    body = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    throw new Error(`non_json_response:${response.status}:${url}`);
  }
  if (!response.ok) throw new Error(`http_${response.status}:${url}`);
  return body;
}

async function fetchText(url, token) {
  const response = await fetch(url, {
    headers: headers(token, "application/vnd.github.raw+json"),
    redirect: "manual",
    signal: AbortSignal.timeout(
      envInt("XGUARD_CODE_SWITCH_TIMEOUT_MS", 8_000, 1_000, 30_000),
    ),
  });
  if (!response.ok) throw new Error(`http_${response.status}:${url}`);
  return response.text();
}

function repositoryPlans(migrationQueue) {
  const entries = [];
  for (const plan of Array.isArray(migrationQueue?.plans)
    ? migrationQueue.plans
    : []) {
    for (const repo of Array.isArray(plan?.repositories)
      ? plan.repositories
      : []) {
      if (typeof repo?.fullName !== "string" || !repo.fullName.includes("/"))
        continue;
      const seedFiles = (Array.isArray(repo?.files) ? repo.files : [])
        .filter(
          (file) =>
            typeof file?.path === "string" && typeof file?.apiUrl === "string",
        )
        .map((file) => ({
          path: file.path,
          apiUrl: file.apiUrl,
          htmlUrl: file.htmlUrl ?? null,
          score: codePathScore(file.path) + 25,
          source: "migration-seed",
        }));
      entries.push({
        target: plan.target,
        priority: plan.priority,
        conversionScore: Number(plan.conversionScore ?? 0),
        live402Count: Number(plan.live402Count ?? 0),
        resourceCount: Number(plan.resourceCount ?? 0),
        repository: repo.fullName,
        defaultBranch: repo.defaultBranch ?? "main",
        seedFiles,
      });
    }
  }
  const deduped = new Map();
  for (const entry of entries) {
    const key = `${entry.target}|${entry.repository}`;
    if (!deduped.has(key)) deduped.set(key, entry);
  }
  return [...deduped.values()].sort(
    (a, b) =>
      priorityRank(a.priority) - priorityRank(b.priority) ||
      b.conversionScore - a.conversionScore ||
      b.live402Count - a.live402Count,
  );
}

function priorityRank(value) {
  if (value === "P0") return 0;
  if (value === "P1") return 1;
  if (value === "P2") return 2;
  return 3;
}

function interestingPath(path) {
  if (typeof path !== "string") return false;
  if (/\.(lock|map|min\.js)$/i.test(path)) return false;
  if (/(^|\/)(dist|build|vendor|node_modules|coverage)(\/|$)/i.test(path))
    return false;
  return /\.(?:[cm]?[jt]sx?|json|ya?ml|toml|env|md)$/i.test(path);
}

function codePathScore(path) {
  if (!interestingPath(path)) return -1;
  const lower = path.toLowerCase();
  const base = lower.split("/").at(-1) ?? lower;
  let score = 0;
  if (lower.includes("x402")) score += 120;
  if (lower.includes("facilitator")) score += 110;
  if (lower.includes("payment")) score += 75;
  if (lower.includes("settle")) score += 65;
  if (lower.includes("middleware")) score += 50;
  if (lower.includes("paywall")) score += 50;
  if (lower.includes("route")) score += 35;
  if (lower.includes("config")) score += 35;
  if (lower.includes("server")) score += 25;
  if (lower.includes("index")) score += 20;
  if (base === "package.json") score += 55;
  if (/\.(?:[cm]?[jt]sx?)$/i.test(base)) score += 20;
  if (path.split("/").length <= 4) score += 15;
  if (/readme\.md$/i.test(base)) score += 5;
  return score;
}

function encodeRepositoryPath(path) {
  return String(path)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function discoverCodeHits(entry, token) {
  const found = new Map();
  for (const seed of entry.seedFiles ?? []) found.set(seed.path, seed);

  const branch = entry.defaultBranch || "main";
  try {
    const tree = await fetchJson(
      `https://api.github.com/repos/${entry.repository}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      token,
    );
    const candidates = (Array.isArray(tree?.tree) ? tree.tree : [])
      .filter((item) => item?.type === "blob" && interestingPath(item?.path))
      .filter((item) => Number(item?.size ?? 0) <= 250_000)
      .map((item) => ({
        path: item.path,
        score: codePathScore(item.path),
        size: Number(item?.size ?? 0),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.size - b.size);

    for (const item of candidates) {
      const existing = found.get(item.path);
      const hit = {
        path: item.path,
        apiUrl: `https://api.github.com/repos/${entry.repository}/contents/${encodeRepositoryPath(item.path)}?ref=${encodeURIComponent(branch)}`,
        htmlUrl: `https://github.com/${entry.repository}/blob/${encodeURIComponent(branch)}/${item.path}`,
        score: Math.max(item.score, Number(existing?.score ?? 0)),
        source: existing?.source ?? "repository-tree",
      };
      found.set(item.path, hit);
    }
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "code_switch_tree_scan_failed",
        repository: entry.repository,
        error: String(error),
      }),
    );
  }

  return [...found.values()]
    .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))
    .slice(0, envInt("XGUARD_CODE_SWITCH_FILES_PER_REPO", 30, 1, 60));
}

function exactIncumbentUrls(content) {
  return INCUMBENT_URLS.filter((url) => content.includes(url));
}

function detectClientConstruction(content) {
  return /\bHTTPFacilitatorClient\b/.test(content);
}

function detectAuth(content) {
  return (
    /\bcreateAuthHeaders\b/.test(content) ||
    /Authorization\s*:\s*[`"']Bearer\s+/.test(content) ||
    /XGUARD_API_KEY/.test(content)
  );
}

function detectFacilitatorIndirection(content) {
  return /\b(?:facilitatorUrl|facilitatorURL|facilitator_url|FACILITATOR_URL|X402_FACILITATOR(?:_URL)?|facilitator)\b/.test(
    content,
  );
}

function containsExactXGuardOrigin(content) {
  const matches = String(content ?? "").matchAll(
    /https:\/\/[^\s"'\x60<>)}\]]+/g,
  );
  for (const match of matches) {
    try {
      const candidate = new URL(match[0]);
      if (
        candidate.protocol === "https:" &&
        candidate.hostname === "xguardgate.com"
      )
        return true;
    } catch {
      // Ignore malformed URL-like text.
    }
  }
  return false;
}

export function analyzeSwitchCode(content, path = "unknown") {
  const text = String(content ?? "");
  const incumbents = exactIncumbentUrls(text);
  const standardClient = detectClientConstruction(text);
  const authPresent = detectAuth(text);
  const facilitatorIndirection = detectFacilitatorIndirection(text);
  const mentionsX402 = /@x402\/|\bx402\b/i.test(text);
  const alreadyXGuard = containsExactXGuardOrigin(text);
  const replacements = incumbents.map((from) => ({
    kind: "replace-exact-url",
    from,
    to: XGUARD_ORIGIN,
  }));

  let state = "manual-review";
  if (alreadyXGuard) state = "already-xguard";
  else if (incumbents.length > 0 && standardClient && authPresent)
    state = "patch-ready";
  else if (incumbents.length > 0 && standardClient) state = "url-plus-auth";
  else if (incumbents.length > 0) state = "exact-url-found";
  else if (standardClient) state = "client-found";
  else if (facilitatorIndirection && mentionsX402)
    state = "config-indirection-found";

  return {
    path,
    state,
    alreadyXGuard,
    standardClient,
    authPresent,
    facilitatorIndirection,
    mentionsX402,
    incumbentUrls: incumbents,
    replacements,
    exactUrlPatchReady:
      !alreadyXGuard && incumbents.length > 0 && standardClient && authPresent,
    requiredEnvironment: alreadyXGuard ? [] : ["XGUARD_API_KEY"],
    authContract:
      !alreadyXGuard && standardClient && !authPresent
        ? {
            description:
              "Attach merchant-scoped Bearer authentication to facilitator verify, settle, supported, and Bazaar requests.",
            environment: "XGUARD_API_KEY",
          }
        : null,
  };
}

async function scanRepository(entry, token) {
  const hits = await discoverCodeHits(entry, token);
  const files = [];
  for (const hit of hits) {
    try {
      const text = await fetchText(hit.apiUrl, token);
      if (text.length > 250_000) continue;
      files.push({
        ...hit,
        analysis: analyzeSwitchCode(text, hit.path),
      });
    } catch (error) {
      files.push({ ...hit, analysis: null, error: String(error) });
    }
  }
  const patchReadyFiles = files.filter(
    (file) => file.analysis?.exactUrlPatchReady,
  );
  const reviewReadyFiles = files.filter(
    (file) =>
      file.analysis &&
      !file.analysis.alreadyXGuard &&
      file.analysis.state !== "manual-review",
  );
  const alreadyXGuard = files.some((file) => file.analysis?.alreadyXGuard);
  return {
    ...entry,
    status: alreadyXGuard
      ? "already-xguard"
      : patchReadyFiles.length > 0
        ? "patch-ready"
        : reviewReadyFiles.length > 0
          ? "review-ready"
          : "no-switch-code-found",
    patchReadyFileCount: patchReadyFiles.length,
    reviewReadyFileCount: reviewReadyFiles.length,
    files,
  };
}

export function selfTest() {
  const ready = analyzeSwitchCode(
    'const createAuthHeaders = () => ({ Authorization: `Bearer ${process.env.XGUARD_API_KEY}` });\nconst c = new HTTPFacilitatorClient({ url: "https://facilitator.payai.network", createAuthHeaders });',
    "src/x402.ts",
  );
  if (!ready.exactUrlPatchReady || ready.state !== "patch-ready")
    throw new Error("code_switch_patch_ready_failed");
  if (ready.replacements[0]?.to !== XGUARD_ORIGIN)
    throw new Error("code_switch_replacement_failed");

  const needsAuth = analyzeSwitchCode(
    'const c = new HTTPFacilitatorClient({ url: "https://api.cdp.coinbase.com/platform/v2/x402" });',
  );
  if (needsAuth.state !== "url-plus-auth" || needsAuth.exactUrlPatchReady)
    throw new Error("code_switch_auth_boundary_failed");

  const indirection = analyzeSwitchCode(
    "const facilitatorUrl = process.env.X402_FACILITATOR_URL; // x402",
  );
  if (indirection.state !== "config-indirection-found")
    throw new Error("code_switch_indirection_failed");

  const unrelated = analyzeSwitchCode("const x = 1;");
  if (unrelated.state !== "manual-review")
    throw new Error("code_switch_false_positive_failed");
  return true;
}

function render(report) {
  const rows = report.repositories
    .slice(0, 50)
    .map(
      (repo) =>
        `| ${repo.priority} | ${repo.target} | ${repo.repository} | ${repo.status} | ${repo.patchReadyFileCount} | ${repo.reviewReadyFileCount} | ${repo.live402Count} |`,
    );
  const details = report.repositories.slice(0, 20).flatMap((repo, index) => {
    const lines = [
      `### ${index + 1}. ${repo.target} — ${repo.repository}`,
      "",
      `- Status: **${repo.status}**`,
      `- Live 402 evidence: ${repo.live402Count}`,
    ];
    for (const file of repo.files
      .filter((item) => item.analysis?.state !== "manual-review")
      .slice(0, 8)) {
      if (!file.analysis) continue;
      lines.push(`- ${file.path}: ${file.analysis.state}`);
      for (const replacement of file.analysis.replacements)
        lines.push(
          `  - replace \`${replacement.from}\` → \`${replacement.to}\``,
        );
      if (file.analysis.authContract)
        lines.push(
          `  - auth: ${file.analysis.authContract.description} (${file.analysis.authContract.environment})`,
        );
    }
    lines.push("");
    return lines;
  });
  return [
    "# XGuard Code Switch Engine",
    "",
    `Generated: ${report.generatedAt}`,
    `Repositories inspected: ${report.repositoryCount}`,
    `Patch-ready repositories: ${report.patchReadyRepositoryCount}`,
    `Review-ready repositories: ${report.reviewReadyRepositoryCount}`,
    "",
    "This engine scans public repository trees and high-signal x402/payment/config files using ordinary GitHub contents APIs, avoiding the much tighter code-search quota. It produces exact side-effect-free switch evidence only; it does not modify third-party repositories.",
    "",
    "| Priority | Target | Repository | Status | Patch-ready files | Review-ready files | Live 402 |",
    "| --- | --- | --- | --- | ---: | ---: | ---: |",
    ...rows,
    "",
    "## Highest-impact code switch packets",
    "",
    ...details,
  ].join("\n");
}

async function main() {
  if (process.argv.includes("--self-test")) {
    selfTest();
    console.log(JSON.stringify({ codeSwitchSelfTest: true }));
    return;
  }
  const token = process.env.GITHUB_TOKEN;
  if (!token)
    throw new Error("GITHUB_TOKEN is required for code switch discovery");
  const migrationPath =
    process.env.XGUARD_MIGRATION_JSON ?? "migration-queue.json";
  const migrationQueue = JSON.parse(await readFile(migrationPath, "utf8"));
  const entries = repositoryPlans(migrationQueue).slice(
    0,
    envInt("XGUARD_CODE_SWITCH_REPO_LIMIT", 24, 1, 100),
  );
  const repositories = [];
  for (const entry of entries)
    repositories.push(await scanRepository(entry, token));
  repositories.sort(
    (a, b) =>
      (b.patchReadyFileCount > 0 ? 1 : 0) -
        (a.patchReadyFileCount > 0 ? 1 : 0) ||
      (b.reviewReadyFileCount > 0 ? 1 : 0) -
        (a.reviewReadyFileCount > 0 ? 1 : 0) ||
      b.live402Count - a.live402Count ||
      b.conversionScore - a.conversionScore,
  );
  const report = {
    generatedAt: new Date().toISOString(),
    repositoryCount: repositories.length,
    patchReadyRepositoryCount: repositories.filter(
      (repo) => repo.status === "patch-ready",
    ).length,
    reviewReadyRepositoryCount: repositories.filter(
      (repo) => repo.status === "review-ready",
    ).length,
    repositories,
  };
  await writeFile(
    process.env.XGUARD_CODE_SWITCH_JSON ?? "code-switch-queue.json",
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await writeFile(
    process.env.XGUARD_CODE_SWITCH_MARKDOWN ?? "code-switch-queue.md",
    render(report),
  );
  console.log(
    JSON.stringify({
      event: "code_switch_queue_ready",
      repositories: report.repositoryCount,
      patchReady: report.patchReadyRepositoryCount,
      reviewReady: report.reviewReadyRepositoryCount,
    }),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(
      JSON.stringify({ event: "code_switch_failed", error: String(error) }),
    );
    process.exitCode = 1;
  });
}
