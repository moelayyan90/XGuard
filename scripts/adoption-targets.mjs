import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const ACTIONABLE_PAIN =
  /\b(not\s+(?:indexed|indexing|appearing|discoverable|working|returning)|re-?index(?:ing)?|fail(?:ed|ing|ure)?|error|broken|missing|unable|doesn['’]?t|does not|never emits?|never returns?|blocked|reject(?:ed|ing)?|timeout)\b/i;

function actionablePain(candidate) {
  return (
    candidate?.candidateType === "pain-signal" &&
    typeof candidate.painSignal === "string" &&
    ACTIONABLE_PAIN.test(candidate.painSignal)
  );
}

function targetKey(candidate) {
  if (candidate?.candidateType === "resource" && candidate.host) {
    return `host:${candidate.host}`;
  }
  if (candidate?.candidateType === "repository" && candidate.repoUrl) {
    return `repo:${candidate.repoUrl}`;
  }
  return null;
}

function targetName(candidate) {
  if (candidate?.candidateType === "resource") return candidate.host;
  return candidate.repoUrl;
}

function scoreTarget(target) {
  let score = target.maxCandidateScore;
  if (target.live402Count >= 3) score += 5;
  if (target.resourceCount >= 5) score += 5;
  if (target.mcpResourceCount >= 1) score += 3;
  if (target.sources.length >= 2) score += 2;
  return Math.min(100, score);
}

export function aggregateTargets(candidates) {
  const groups = new Map();
  for (const candidate of candidates) {
    if (candidate.candidateType === "pain-signal") continue;
    const key = targetKey(candidate);
    if (!key) continue;
    const current = groups.get(key) ?? {
      key,
      target: targetName(candidate),
      kind: candidate.candidateType === "resource" ? "service-host" : "repository",
      resourceCount: 0,
      live402Count: 0,
      mcpResourceCount: 0,
      maxCandidateScore: 0,
      sources: new Set(),
      incumbentHints: new Set(),
      payTo: new Set(),
      sampleResources: [],
      minPriceMicroUsd: null,
      maxPriceMicroUsd: null,
      migrationRecipe: candidate.migrationRecipe ?? [],
    };

    if (candidate.candidateType === "resource") {
      current.resourceCount += 1;
      if (candidate.probe?.status === 402) current.live402Count += 1;
      if (candidate.mcp) current.mcpResourceCount += 1;
      if (
        candidate.resource &&
        current.sampleResources.length < 5 &&
        !current.sampleResources.includes(candidate.resource)
      ) {
        current.sampleResources.push(candidate.resource);
      }
      if (candidate.payTo) current.payTo.add(candidate.payTo);
      if (Number.isSafeInteger(candidate.priceMicroUsd)) {
        current.minPriceMicroUsd =
          current.minPriceMicroUsd === null
            ? candidate.priceMicroUsd
            : Math.min(current.minPriceMicroUsd, candidate.priceMicroUsd);
        current.maxPriceMicroUsd =
          current.maxPriceMicroUsd === null
            ? candidate.priceMicroUsd
            : Math.max(current.maxPriceMicroUsd, candidate.priceMicroUsd);
      }
    }

    for (const source of String(candidate.source ?? "")
      .split(",")
      .filter(Boolean)) {
      current.sources.add(source);
    }
    if (candidate.incumbentHint) {
      current.incumbentHints.add(candidate.incumbentHint);
    }
    if (candidate.score > current.maxCandidateScore) {
      current.maxCandidateScore = candidate.score;
      current.migrationRecipe = candidate.migrationRecipe ?? [];
    }
    groups.set(key, current);
  }

  return [...groups.values()]
    .map((target) => ({
      ...target,
      sources: [...target.sources].sort(),
      incumbentHints: [...target.incumbentHints].sort(),
      payTo: [...target.payTo].sort(),
      score: scoreTarget({
        ...target,
        sources: [...target.sources],
      }),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.live402Count - a.live402Count ||
        b.resourceCount - a.resourceCount ||
        String(a.target).localeCompare(String(b.target)),
    );
}

function moneyRange(target) {
  if (target.minPriceMicroUsd === null) return "unknown";
  const min = target.minPriceMicroUsd / 1_000_000;
  const max = target.maxPriceMicroUsd / 1_000_000;
  return min === max ? `$${min}` : `$${min}–$${max}`;
}

function renderMarkdown(report) {
  const rows = report.targets.slice(0, 50).map((target) => {
    return `| ${target.score} | ${target.target} | ${target.resourceCount} | ${target.live402Count} | ${target.mcpResourceCount} | ${target.incumbentHints.join(",") || "unknown"} | ${moneyRange(target)} |`;
  });
  const pain = report.actionablePainSignals.slice(0, 20).map((candidate) => {
    return `- ${candidate.painSignal} — ${candidate.issueUrl ?? candidate.repoUrl ?? "public GitHub signal"}`;
  });
  return [
    "# XGuard Adoption Targets",
    "",
    `Generated: ${report.generatedAt}`,
    `Raw candidates: ${report.rawCandidateCount}`,
    `Distinct merchant/service targets: ${report.targetCount}`,
    `Actionable public pain signals: ${report.actionablePainSignals.length}`,
    "",
    "| Score | Target | Resources | Live 402 | MCP | Incumbent hint | Observed price range |",
    "| ---: | --- | ---: | ---: | ---: | --- | --- |",
    ...rows,
    "",
    "## Actionable public pain signals",
    "",
    ...(pain.length ? pain : ["- None in this scan."]),
    "",
    "## Conversion rule",
    "",
    "Prioritize service hosts with verified live 402 responses, multiple paid resources, MCP exposure, or explicit facilitator/discovery pain. One merchant conversion can move every paid endpoint on that host through XGuard.",
    "",
  ].join("\n");
}

export function selfTest() {
  const candidates = [
    {
      candidateType: "resource",
      host: "api.example.com",
      resource: "https://api.example.com/a",
      probe: { status: 402 },
      mcp: true,
      source: "cdp-bazaar",
      incumbentHint: "cdp",
      score: 90,
      priceMicroUsd: 50_000,
      payTo: "0x1",
      migrationRecipe: ["migrate"],
    },
    {
      candidateType: "resource",
      host: "api.example.com",
      resource: "https://api.example.com/b",
      probe: { status: 402 },
      mcp: false,
      source: "payai-bazaar",
      incumbentHint: "payai",
      score: 82,
      priceMicroUsd: 100_000,
      payTo: "0x1",
      migrationRecipe: ["migrate"],
    },
  ];
  const targets = aggregateTargets(candidates);
  if (targets.length !== 1) throw new Error("self_test_target_dedupe_failed");
  if (targets[0].resourceCount !== 2 || targets[0].live402Count !== 2) {
    throw new Error("self_test_target_counts_failed");
  }
  if (!actionablePain({ candidateType: "pain-signal", painSignal: "Bazaar not indexed after settlement" })) {
    throw new Error("self_test_pain_filter_failed");
  }
  if (actionablePain({ candidateType: "pain-signal", painSignal: "Submit MCP server" })) {
    throw new Error("self_test_pain_noise_failed");
  }
  return true;
}

async function main() {
  if (process.argv.includes("--self-test")) {
    selfTest();
    console.log(JSON.stringify({ targetSelfTest: true }));
    return;
  }
  const input = process.env.XGUARD_ADOPTION_JSON ?? "adoption-report.json";
  const raw = JSON.parse(await readFile(input, "utf8"));
  const targets = aggregateTargets(raw.candidates ?? []);
  const actionablePainSignals = (raw.candidates ?? [])
    .filter(actionablePain)
    .sort((a, b) => b.score - a.score)
    .slice(0, 100);
  const report = {
    generatedAt: new Date().toISOString(),
    network: raw.network,
    rawCandidateCount: raw.candidateCount ?? raw.candidates?.length ?? 0,
    targetCount: targets.length,
    actionablePainSignals,
    targets,
  };
  await writeFile(
    process.env.XGUARD_ADOPTION_TARGETS_JSON ?? "adoption-targets.json",
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await writeFile(
    process.env.XGUARD_ADOPTION_TARGETS_MARKDOWN ?? "adoption-targets.md",
    renderMarkdown(report),
  );
  console.log(
    JSON.stringify({
      event: "adoption_targets_ready",
      rawCandidates: report.rawCandidateCount,
      targets: report.targetCount,
      actionablePainSignals: report.actionablePainSignals.length,
    }),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(
      JSON.stringify({ event: "adoption_targets_failed", error: String(error) }),
    );
    process.exitCode = 1;
  });
}
