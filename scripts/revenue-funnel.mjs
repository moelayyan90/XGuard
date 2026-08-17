import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

function integer(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function packetIndex(queue) {
  const index = new Map();
  for (const packet of Array.isArray(queue?.packets) ? queue.packets : []) {
    if (typeof packet?.target === "string" && packet.target.length > 0)
      index.set(packet.target, packet);
  }
  return index;
}

function codeSwitchIndex(queue) {
  const index = new Map();
  for (const repository of Array.isArray(queue?.repositories)
    ? queue.repositories
    : []) {
    if (
      typeof repository?.target !== "string" ||
      repository.target.length === 0
    )
      continue;
    const current = index.get(repository.target) ?? {
      repositoryCount: 0,
      patchReadyFiles: 0,
      reviewReadyFiles: 0,
    };
    current.repositoryCount += 1;
    current.patchReadyFiles += integer(repository?.patchReadyFileCount);
    current.reviewReadyFiles += integer(repository?.reviewReadyFileCount);
    index.set(repository.target, current);
  }
  return index;
}

export function buildRevenueFunnel(
  conversionQueue,
  migrationQueue,
  codeSwitchQueue = {},
) {
  const byTarget = packetIndex(conversionQueue);
  const codeSwitchByTarget = codeSwitchIndex(codeSwitchQueue);
  const plans = Array.isArray(migrationQueue?.plans)
    ? migrationQueue.plans
    : [];
  const rows = plans.map((plan) => {
    const packet = byTarget.get(plan?.target) ?? {};
    const codeSwitch = codeSwitchByTarget.get(plan?.target) ?? {
      repositoryCount: 0,
      patchReadyFiles: 0,
      reviewReadyFiles: 0,
    };
    const repositories = Array.isArray(plan?.repositories)
      ? plan.repositories
      : [];
    const migrationPatchReadyFiles = repositories.reduce(
      (sum, repo) => sum + integer(repo?.patchReadyFileCount),
      0,
    );
    const migrationActionableFiles = repositories.reduce(
      (sum, repo) => sum + integer(repo?.actionableFileCount),
      0,
    );
    const patchReadyFiles = Math.max(
      migrationPatchReadyFiles,
      codeSwitch.patchReadyFiles,
    );
    const reviewReadyFiles = Math.max(
      migrationActionableFiles,
      codeSwitch.reviewReadyFiles,
    );
    return {
      target: plan?.target ?? null,
      priority: plan?.priority ?? packet?.priority ?? "P3",
      conversionScore: integer(
        plan?.conversionScore ?? packet?.conversionScore ?? 0,
      ),
      live402Count: integer(plan?.live402Count ?? packet?.live402Count ?? 0),
      resourceCount: integer(plan?.resourceCount ?? packet?.resourceCount ?? 0),
      mcpResourceCount: integer(
        plan?.mcpResourceCount ?? packet?.mcpResourceCount ?? 0,
      ),
      migrationStatus: plan?.status ?? "unknown",
      repositoryCount: repositories.length,
      codeSwitchRepositoryCount: codeSwitch.repositoryCount,
      migrationPatchReadyFiles,
      migrationActionableFiles,
      codeSwitchPatchReadyFiles: codeSwitch.patchReadyFiles,
      codeSwitchReviewReadyFiles: codeSwitch.reviewReadyFiles,
      patchReadyFiles,
      reviewReadyFiles,
      actionableFiles: migrationActionableFiles,
      publicMigrationManifest:
        packet?.switchKit?.publicMigrationManifest ?? null,
    };
  });

  rows.sort(
    (a, b) =>
      (b.patchReadyFiles > 0 ? 1 : 0) - (a.patchReadyFiles > 0 ? 1 : 0) ||
      (b.reviewReadyFiles > 0 ? 1 : 0) - (a.reviewReadyFiles > 0 ? 1 : 0) ||
      b.live402Count - a.live402Count ||
      b.conversionScore - a.conversionScore,
  );

  const totals = {
    targets: rows.length,
    live402Endpoints: rows.reduce((sum, row) => sum + row.live402Count, 0),
    resources: rows.reduce((sum, row) => sum + row.resourceCount, 0),
    patchReadyTargets: rows.filter((row) => row.patchReadyFiles > 0).length,
    reviewReadyTargets: rows.filter(
      (row) => row.patchReadyFiles === 0 && row.reviewReadyFiles > 0,
    ).length,
    unresolvedTargets: rows.filter(
      (row) => row.migrationStatus === "repository-not-resolved",
    ).length,
    codeSwitchRepositories: rows.reduce(
      (sum, row) => sum + row.codeSwitchRepositoryCount,
      0,
    ),
  };

  return {
    generatedAt: new Date().toISOString(),
    network: conversionQueue?.network ?? migrationQueue?.network ?? null,
    totals,
    rows,
    accountingBoundary: {
      revenueClaimedFromOpportunityData: false,
      reason:
        "Public 402 observations are adoption opportunities, not XGuard settlements or earned fees.",
    },
  };
}

function markdown(report) {
  const rows = report.rows
    .slice(0, 50)
    .map(
      (row) =>
        `| ${row.priority} | ${row.target} | ${row.live402Count} | ${row.resourceCount} | ${row.migrationStatus} | ${row.migrationPatchReadyFiles} | ${row.codeSwitchPatchReadyFiles} | ${row.codeSwitchReviewReadyFiles} | ${row.publicMigrationManifest ? `[switch kit](${row.publicMigrationManifest})` : "-"} |`,
    );
  return [
    "# XGuard Revenue Conversion Funnel",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `- Targets inspected: ${report.totals.targets}`,
    `- Verified live 402 endpoints represented: ${report.totals.live402Endpoints}`,
    `- Public paid resources represented: ${report.totals.resources}`,
    `- Code-switch repositories inspected: ${report.totals.codeSwitchRepositories}`,
    `- Patch-ready targets: ${report.totals.patchReadyTargets}`,
    `- Review-ready targets: ${report.totals.reviewReadyTargets}`,
    `- Repository-unresolved targets: ${report.totals.unresolvedTargets}`,
    "",
    "> This is a conversion funnel, not revenue. Only successful billable settlements recorded by XGuard accounting are earned revenue.",
    "",
    "| Priority | Target | Live 402 | Resources | Migration status | Migration patch-ready | Code-switch patch-ready | Code-switch review-ready | Action |",
    "| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | --- |",
    ...rows,
    "",
  ].join("\n");
}

export function selfTest() {
  const report = buildRevenueFunnel(
    {
      network: "eip155:8453",
      packets: [
        {
          target: "api.example.com",
          priority: "P0",
          conversionScore: 90,
          live402Count: 4,
          resourceCount: 10,
          switchKit: {
            publicMigrationManifest: "https://example.test/migrate",
          },
        },
      ],
    },
    {
      plans: [
        {
          target: "api.example.com",
          status: "migration-review-ready",
          repositories: [{ patchReadyFileCount: 0, actionableFileCount: 1 }],
        },
      ],
    },
    {
      repositories: [
        {
          target: "api.example.com",
          patchReadyFileCount: 2,
          reviewReadyFileCount: 2,
        },
      ],
    },
  );
  if (report.totals.patchReadyTargets !== 1)
    throw new Error("revenue_funnel_patch_ready_failed");
  if (report.rows[0]?.codeSwitchPatchReadyFiles !== 2)
    throw new Error("revenue_funnel_code_switch_failed");
  if (report.totals.live402Endpoints !== 4)
    throw new Error("revenue_funnel_live402_failed");
  if (report.accountingBoundary.revenueClaimedFromOpportunityData)
    throw new Error("revenue_funnel_accounting_boundary_failed");
  return true;
}

async function main() {
  if (process.argv.includes("--self-test")) {
    selfTest();
    console.log(JSON.stringify({ revenueFunnelSelfTest: true }));
    return;
  }
  const conversionPath =
    process.env.XGUARD_CONVERSION_JSON ?? "conversion-queue.json";
  const migrationPath =
    process.env.XGUARD_MIGRATION_JSON ?? "migration-queue.json";
  const codeSwitchPath =
    process.env.XGUARD_CODE_SWITCH_JSON ?? "code-switch-queue.json";
  const [conversionQueue, migrationQueue, codeSwitchQueue] = await Promise.all([
    readFile(conversionPath, "utf8").then(JSON.parse),
    readFile(migrationPath, "utf8").then(JSON.parse),
    readFile(codeSwitchPath, "utf8").then(JSON.parse),
  ]);
  const report = buildRevenueFunnel(
    conversionQueue,
    migrationQueue,
    codeSwitchQueue,
  );
  await writeFile(
    process.env.XGUARD_REVENUE_FUNNEL_JSON ?? "revenue-funnel.json",
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await writeFile(
    process.env.XGUARD_REVENUE_FUNNEL_MARKDOWN ?? "revenue-funnel.md",
    markdown(report),
  );
  console.log(
    JSON.stringify({
      event: "revenue_funnel_ready",
      ...report.totals,
    }),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(
      JSON.stringify({ event: "revenue_funnel_failed", error: String(error) }),
    );
    process.exitCode = 1;
  });
}
