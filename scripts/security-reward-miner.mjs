#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import yaml from "js-yaml";

const OSS_TIERS_URL =
  "https://raw.githubusercontent.com/google/bughunters/main/oss-repository-tier/README.md";
const PATCH_SCOPE_URL =
  "https://raw.githubusercontent.com/google/bughunters/main/patch-rewards-program/scope.md";
const API = "https://api.github.com";
const OUT_DIR = path.resolve("artifacts/security-reward-candidates");

const maxReposArg = process.argv.find((arg) => arg.startsWith("--max-repos="));
const MAX_REPOS = Math.max(
  1,
  Math.min(
    200,
    Number(
      maxReposArg?.split("=")[1] ??
        process.env.XGUARD_REWARD_MAX_REPOS ??
        115,
    ),
  ),
);

const githubToken = process.env.GITHUB_TOKEN?.trim();
const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "XGuard-Security-Reward-Miner/1.0",
  "X-GitHub-Api-Version": "2022-11-28",
  ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
};

function fail(message) {
  console.error(`[security-reward-miner] ${message}`);
  process.exitCode = 1;
}

async function fetchText(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`GET ${url} -> HTTP ${response.status}`);
  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url, { headers });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GET ${url} -> HTTP ${response.status}`);
  return response.json();
}

function repoFromGithubUrl(url) {
  const match = url.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/#?]+)\/?$/i,
  );
  if (!match) return null;
  return `${match[1]}/${match[2].replace(/\.git$/i, "")}`;
}

function parseOssTiers(markdown) {
  const rows = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(
      /^\|\s*(https:\/\/github\.com\/[^|\s]+)\s*\|\s*(OT[01])\s*\|/i,
    );
    if (!match) continue;
    const repo = repoFromGithubUrl(match[1]);
    if (repo) {
      rows.push({
        repo,
        tier: match[2].toUpperCase(),
        source: "google-oss-vrp",
      });
    }
  }
  return rows;
}

function parsePatchScope(markdown) {
  const rows = [];
  for (const line of markdown.split(/\r?\n/)) {
    const link = line.match(/\]\((https:\/\/github\.com\/[^)]+)\)/i)?.[1];
    if (!link) continue;
    const repo = repoFromGithubUrl(link);
    if (!repo) continue;
    const area = line.split("|").at(-1)?.trim() || "unknown";
    rows.push({ repo, area, source: "google-patch-rewards" });
  }
  return rows;
}

function mergeTargets(ossRows, patchRows) {
  const map = new Map();
  for (const row of ossRows) {
    map.set(row.repo.toLowerCase(), {
      repo: row.repo,
      ossTier: row.tier,
      patchArea: null,
      programs: [row.source],
    });
  }
  for (const row of patchRows) {
    const key = row.repo.toLowerCase();
    const existing = map.get(key) ?? {
      repo: row.repo,
      ossTier: null,
      patchArea: null,
      programs: [],
    };
    existing.patchArea = row.area;
    if (!existing.programs.includes(row.source)) {
      existing.programs.push(row.source);
    }
    map.set(key, existing);
  }

  return [...map.values()].sort((a, b) => {
    const score = (x) =>
      (x.ossTier === "OT0" ? 100 : x.ossTier === "OT1" ? 80 : 0) +
      (x.patchArea
        ?.toLowerCase()
        .includes("core infrastructure data parsers")
        ? 40
        : x.patchArea
          ? 20
          : 0);
    return score(b) - score(a) || a.repo.localeCompare(b.repo);
  });
}

function selectTargets(targets, maxRepos, now = Date.now()) {
  if (maxRepos >= targets.length) return targets;

  const coreCount = Math.min(10, maxRepos);
  const selected = targets.slice(0, coreCount);
  const remainder = targets.slice(coreCount);
  const rotatingSlots = maxRepos - coreCount;
  if (rotatingSlots <= 0 || remainder.length === 0) return selected;

  const dayNumber = Math.floor(now / 86_400_000);
  const start = (dayNumber * rotatingSlots) % remainder.length;
  for (let index = 0; index < rotatingSlots; index += 1) {
    selected.push(remainder[(start + index) % remainder.length]);
  }
  return selected;
}

function normalizeEvents(doc) {
  const on = doc?.on;
  if (typeof on === "string") return new Set([on]);
  if (Array.isArray(on)) return new Set(on.map(String));
  if (on && typeof on === "object") return new Set(Object.keys(on));
  return new Set();
}

function permissionsWritable(permissions) {
  if (permissions === "write-all") return true;
  if (!permissions || typeof permissions !== "object") return false;
  return Object.values(permissions).some(
    (value) => String(value).toLowerCase() === "write",
  );
}

function isDependabotOnlyJob(job) {
  const condition = String(job?.if ?? "").toLowerCase().replace(/\s+/g, " ");
  return (
    condition.includes("github.event.pull_request.user.login") &&
    condition.includes("dependabot[bot]")
  );
}

const UNTRUSTED_EXPRESSIONS = [
  "github.event.pull_request.title",
  "github.event.pull_request.body",
  "github.event.pull_request.head.ref",
  "github.event.pull_request.head.label",
  "github.event.issue.title",
  "github.event.issue.body",
  "github.event.comment.body",
  "github.head_ref",
];

function containsUntrustedExpression(text) {
  const lower = String(text ?? "").toLowerCase();
  return UNTRUSTED_EXPRESSIONS.find(
    (expr) =>
      lower.includes(`\${{ ${expr}`) || lower.includes(`\${{${expr}`),
  );
}

function controlledCheckoutRef(step) {
  if (!step || typeof step !== "object") return null;
  if (
    !String(step.uses ?? "")
      .toLowerCase()
      .startsWith("actions/checkout@")
  ) {
    return null;
  }
  const ref = String(step.with?.ref ?? "");
  const lower = ref.toLowerCase();
  const patterns = [
    "github.event.pull_request.head.sha",
    "github.event.pull_request.head.ref",
    "github.head_ref",
  ];
  return patterns.find((pattern) => lower.includes(pattern)) ?? null;
}

function thirdPartyMutableAction(step) {
  if (!step || typeof step !== "object" || !step.uses) return null;
  const uses = String(step.uses);
  if (uses.startsWith("./") || uses.startsWith("docker://")) return null;
  const [action, ref] = uses.split("@");
  if (!ref || action.toLowerCase().startsWith("actions/")) return null;
  if (/^[0-9a-f]{40}$/i.test(ref)) return null;
  return uses;
}

function scanWorkflow(target, workflowPath, raw) {
  let doc;
  try {
    doc = yaml.load(raw);
  } catch (error) {
    return [
      {
        repo: target.repo,
        workflow: workflowPath,
        program: target.programs,
        ossTier: target.ossTier,
        patchArea: target.patchArea,
        kind: "parser-error",
        confidence: "none",
        score: 0,
        evidence: String(error.message ?? error),
        action: "ignore",
      },
    ];
  }

  const events = normalizeEvents(doc);
  const privilegedPr = events.has("pull_request_target");
  const writableTop = permissionsWritable(doc?.permissions);
  const findings = [];

  for (const [jobName, job] of Object.entries(doc?.jobs ?? {})) {
    const dependabotOnly = isDependabotOnlyJob(job);
    const jobWritable = writableTop || permissionsWritable(job?.permissions);
    const steps = Array.isArray(job?.steps) ? job.steps : [];
    let untrustedCheckout = null;
    let secretUse = false;
    let untrustedRun = null;
    const mutableActions = [];

    for (const step of steps) {
      const ref = controlledCheckoutRef(step);
      if (ref) untrustedCheckout = ref;
      const run = String(step?.run ?? "");
      const expr = containsUntrustedExpression(run);
      if (expr) untrustedRun = expr;
      if (/secrets\.[A-Z0-9_]+/i.test(JSON.stringify(step))) secretUse = true;
      const mutable = thirdPartyMutableAction(step);
      if (mutable) mutableActions.push(mutable);
    }

    if (
      privilegedPr &&
      !dependabotOnly &&
      untrustedCheckout &&
      (jobWritable || secretUse)
    ) {
      findings.push({
        repo: target.repo,
        workflow: workflowPath,
        job: jobName,
        program: target.programs,
        ossTier: target.ossTier,
        patchArea: target.patchArea,
        kind: "privileged-pr-untrusted-checkout",
        confidence: "high",
        score: 100,
        evidence: `pull_request_target checks out attacker-controlled ref (${untrustedCheckout}) while job has ${jobWritable ? "write permissions" : "secret access"}`,
        action:
          "manual-validate-and-report-only-if-reproducible-without-impact",
      });
    }

    if (
      privilegedPr &&
      !dependabotOnly &&
      untrustedRun &&
      (jobWritable || secretUse)
    ) {
      findings.push({
        repo: target.repo,
        workflow: workflowPath,
        job: jobName,
        program: target.programs,
        ossTier: target.ossTier,
        patchArea: target.patchArea,
        kind: "privileged-pr-shell-interpolation",
        confidence: "high",
        score: 95,
        evidence: `attacker-controlled expression (${untrustedRun}) is interpolated into a shell step in pull_request_target context`,
        action:
          "manual-validate-and-report-only-if-reproducible-without-impact",
      });
    }

    if ((jobWritable || secretUse) && mutableActions.length > 0) {
      findings.push({
        repo: target.repo,
        workflow: workflowPath,
        job: jobName,
        program: target.programs,
        ossTier: target.ossTier,
        patchArea: target.patchArea,
        kind: "mutable-third-party-action",
        confidence: "medium",
        score: target.patchArea ? 45 : 30,
        evidence: `privileged workflow uses action(s) not pinned to a full commit SHA: ${mutableActions.join(", ")}`,
        action: target.patchArea
          ? "consider-security-hardening-patch"
          : "review-only-do-not-report-as-vulnerability-without-impact",
      });
    }
  }

  return findings;
}

async function listWorkflowFiles(repo) {
  const data = await fetchJson(
    `${API}/repos/${repo}/contents/.github/workflows`,
  );
  if (!Array.isArray(data)) return [];
  return data
    .filter(
      (entry) =>
        entry?.type === "file" && /\.ya?ml$/i.test(entry.name ?? ""),
    )
    .map((entry) => ({
      name: entry.name,
      path: entry.path,
      downloadUrl: entry.download_url,
    }))
    .filter((entry) => entry.downloadUrl);
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const [ossMarkdown, patchMarkdown] = await Promise.all([
    fetchText(OSS_TIERS_URL),
    fetchText(PATCH_SCOPE_URL),
  ]);
  const targets = mergeTargets(
    parseOssTiers(ossMarkdown),
    parsePatchScope(patchMarkdown),
  );
  const selected = selectTargets(targets, MAX_REPOS);
  const findings = [];
  const errors = [];

  for (const target of selected) {
    try {
      const workflows = await listWorkflowFiles(target.repo);
      for (const workflow of workflows) {
        const raw = await fetchText(workflow.downloadUrl);
        findings.push(...scanWorkflow(target, workflow.path, raw));
      }
    } catch (error) {
      errors.push({ repo: target.repo, error: String(error.message ?? error) });
    }
  }

  const ranked = findings
    .filter((finding) => finding.score > 0)
    .sort((a, b) => b.score - a.score || a.repo.localeCompare(b.repo));

  const generatedAt = new Date().toISOString();
  const payload = {
    generatedAt,
    policy: {
      mode: "public-source-only",
      activeNetworkScanning: false,
      exploitation: false,
      automaticSubmission: false,
      note: "Candidates are hypotheses. Validate against current program rules and produce a non-impacting reproduction before any report or patch submission.",
    },
    sources: {
      ossTiers: OSS_TIERS_URL,
      patchScope: PATCH_SCOPE_URL,
    },
    stats: {
      officialTargets: targets.length,
      scannedRepos: selected.length,
      findings: ranked.length,
      errors: errors.length,
    },
    scannedTargets: selected.map((target) => target.repo),
    findings: ranked,
    errors,
  };

  const jsonPath = path.join(OUT_DIR, "candidates.json");
  await fs.writeFile(
    jsonPath,
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );

  const lines = [
    "# XGuard Security Reward Candidates",
    "",
    `Generated: ${generatedAt}`,
    "",
    "> Public-source inspection only. No exploitation, target scanning, or automatic vulnerability submission is performed.",
    "",
    `Official targets discovered: **${targets.length}**`,
    `Repositories inspected this run: **${selected.length}**`,
    `Candidate findings: **${ranked.length}**`,
    "",
  ];

  for (const finding of ranked.slice(0, 100)) {
    lines.push(
      `## ${finding.score} — ${finding.repo} — ${finding.kind}`,
      "",
      `- Workflow: \`${finding.workflow}\``,
      `- Job: \`${finding.job ?? "n/a"}\``,
      `- Confidence: **${finding.confidence}**`,
      `- Programs: ${finding.program.join(", ")}`,
      `- OSS tier: ${finding.ossTier ?? "n/a"}`,
      `- Patch area: ${finding.patchArea ?? "n/a"}`,
      `- Evidence: ${finding.evidence}`,
      `- Next action: ${finding.action}`,
      "",
    );
  }

  if (errors.length) {
    lines.push("## Retrieval errors", "");
    for (const error of errors) lines.push(`- ${error.repo}: ${error.error}`);
    lines.push("");
  }

  await fs.writeFile(
    path.join(OUT_DIR, "candidates.md"),
    `${lines.join("\n")}\n`,
    "utf8",
  );
  console.log(JSON.stringify(payload.stats));
}

main().catch((error) => fail(error.stack ?? error.message ?? String(error)));
