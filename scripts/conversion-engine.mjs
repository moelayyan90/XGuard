import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const XGUARD_ORIGIN = "https://xguard-mainnet.maqamapp.workers.dev";
const BASE_MAINNET = "eip155:8453";

function envInt(name, fallback, min, max) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function knownIncumbents(target) {
  return Array.isArray(target?.incumbentHints)
    ? target.incumbentHints.filter(
        (value) => value === "cdp" || value === "payai",
      )
    : [];
}

function sourceMode(target) {
  const incumbents = knownIncumbents(target);
  if (incumbents.includes("cdp") && incumbents.includes("payai"))
    return "cdp,payai";
  if (incumbents.includes("cdp")) return "cdp";
  if (incumbents.includes("payai")) return "payai";
  return "unknown";
}

function conversionScore(target) {
  const resourceCount = Number(target?.resourceCount ?? 0);
  const live402Count = Number(target?.live402Count ?? 0);
  const mcpCount = Number(target?.mcpResourceCount ?? 0);
  const targetScore = Number(target?.score ?? 0);
  const incumbents = knownIncumbents(target);

  let score = Math.min(15, Math.round(targetScore * 0.15));
  if (live402Count > 0) score += 15;
  score += Math.min(25, live402Count * 3);
  score += Math.min(
    20,
    Math.round(Math.log2(Math.max(1, resourceCount) + 1) * 3),
  );
  if (mcpCount > 0) score += 8;
  score += Math.min(7, Math.round(Math.log2(Math.max(1, mcpCount) + 1) * 2));
  if (incumbents.length > 0) score += 7;
  if (incumbents.length > 1) score += 3;
  return Math.min(100, score);
}

function priority(score) {
  if (score >= 75) return "P0";
  if (score >= 55) return "P1";
  if (score >= 35) return "P2";
  return "P3";
}

function confidence(target) {
  if (Number(target?.live402Count ?? 0) > 0) return "verified-live";
  if (Number(target?.resourceCount ?? 0) > 0) return "catalog-observed";
  return "repository-only";
}

function sampleResource(target) {
  return Array.isArray(target?.sampleResources) &&
    target.sampleResources.length > 0
    ? target.sampleResources[0]
    : null;
}

function migrationManifestUrl(target) {
  const url = new URL(`${XGUARD_ORIGIN}/.well-known/xguard/migrate`);
  url.searchParams.set("from", sourceMode(target));
  url.searchParams.set("name", String(target?.target ?? "merchant"));
  const resource = sampleResource(target);
  if (resource) url.searchParams.set("resource", resource);
  return url.toString();
}

function migrationReasons(target) {
  const reasons = [];
  const resources = Number(target?.resourceCount ?? 0);
  const live402 = Number(target?.live402Count ?? 0);
  const mcp = Number(target?.mcpResourceCount ?? 0);
  const incumbents = knownIncumbents(target);
  if (live402 > 0)
    reasons.push(`${live402} paid endpoint(s) returned live HTTP 402`);
  if (resources > 1)
    reasons.push(
      `${resources} paid resources can move with one merchant switch`,
    );
  if (mcp > 0) reasons.push(`${mcp} MCP-facing resource(s)`);
  if (incumbents.length > 0)
    reasons.push(`known facilitator path: ${incumbents.join(" + ")}`);
  if (Array.isArray(target?.sources) && target.sources.length > 1)
    reasons.push("observed in multiple public discovery catalogs");
  return reasons;
}

function switchKit(target) {
  const targetName = String(target?.target ?? "merchant");
  return {
    publicMigrationManifest: migrationManifestUrl(target),
    register: {
      method: "POST",
      url: `${XGUARD_ORIGIN}/v1/register`,
      headers: { "Content-Type": "application/json" },
      body: { name: targetName },
      output: "merchant + one-time apiKey",
    },
    fundServiceBalance: {
      method: "POST",
      url: `${XGUARD_ORIGIN}/v1/topups/intents`,
      authorization: "Bearer <apiKey>",
      note: "Create a Base USDC prepaid service-balance intent before billable settlements.",
    },
    configure: {
      facilitatorBaseUrl: XGUARD_ORIGIN,
      authorization: "Bearer <apiKey>",
      preserve: [
        "existing x402 middleware",
        "payment requirements",
        "payTo recipient",
        "resource pricing",
      ],
    },
    verify: [
      `GET ${XGUARD_ORIGIN}/supported`,
      `POST ${XGUARD_ORIGIN}/verify with Authorization: Bearer <apiKey>`,
      `POST ${XGUARD_ORIGIN}/settle with Authorization: Bearer <apiKey>`,
      `GET ${XGUARD_ORIGIN}/discovery/resources?network=${encodeURIComponent(BASE_MAINNET)}`,
    ],
  };
}

export function buildConversionQueue(targetReport) {
  const targets = Array.isArray(targetReport?.targets)
    ? targetReport.targets
    : [];
  const packets = targets.map((target) => {
    const score = conversionScore(target);
    return {
      target: target.target,
      kind: target.kind,
      conversionScore: score,
      priority: priority(score),
      confidence: confidence(target),
      resourceCount: Number(target.resourceCount ?? 0),
      live402Count: Number(target.live402Count ?? 0),
      mcpResourceCount: Number(target.mcpResourceCount ?? 0),
      sources: Array.isArray(target.sources) ? target.sources : [],
      incumbentHints: knownIncumbents(target),
      sampleResources: Array.isArray(target.sampleResources)
        ? target.sampleResources.slice(0, 5)
        : [],
      observedPriceRangeMicroUsd: {
        min: Number.isSafeInteger(target.minPriceMicroUsd)
          ? target.minPriceMicroUsd
          : null,
        max: Number.isSafeInteger(target.maxPriceMicroUsd)
          ? target.maxPriceMicroUsd
          : null,
      },
      reasons: migrationReasons(target),
      switchKit: switchKit(target),
    };
  });

  packets.sort(
    (a, b) =>
      b.conversionScore - a.conversionScore ||
      b.live402Count - a.live402Count ||
      b.resourceCount - a.resourceCount ||
      String(a.target).localeCompare(String(b.target)),
  );

  return {
    generatedAt: new Date().toISOString(),
    network: targetReport?.network ?? BASE_MAINNET,
    sourceTargetCount: targets.length,
    conversionTargetCount: packets.length,
    p0Count: packets.filter((packet) => packet.priority === "P0").length,
    p1Count: packets.filter((packet) => packet.priority === "P1").length,
    packets,
  };
}

function priceRange(packet) {
  const min = packet.observedPriceRangeMicroUsd.min;
  const max = packet.observedPriceRangeMicroUsd.max;
  if (min === null || max === null) return "unknown";
  const minUsd = min / 1_000_000;
  const maxUsd = max / 1_000_000;
  return minUsd === maxUsd ? `$${minUsd}` : `$${minUsd}–$${maxUsd}`;
}

function renderMarkdown(report) {
  const limit = envInt("XGUARD_CONVERSION_QUEUE_LIMIT", 50, 10, 100);
  const rows = report.packets.slice(0, limit).map((packet) => {
    const incumbents = packet.incumbentHints.join(",") || "unknown";
    const kit = packet.switchKit.publicMigrationManifest;
    return `| ${packet.priority} | ${packet.conversionScore} | ${packet.target} | ${packet.resourceCount} | ${packet.live402Count} | ${packet.mcpResourceCount} | ${incumbents} | ${priceRange(packet)} | [switch kit](${kit}) |`;
  });

  const top = report.packets
    .slice(0, 12)
    .flatMap((packet, index) => [
      `### ${index + 1}. ${packet.target}`,
      "",
      `- Priority: **${packet.priority} / ${packet.conversionScore}**`,
      `- Evidence: ${packet.reasons.join("; ") || "public x402 catalog evidence"}`,
      `- Migration manifest: ${packet.switchKit.publicMigrationManifest}`,
      `- Register: \`POST ${packet.switchKit.register.url}\` with \`${JSON.stringify(packet.switchKit.register.body)}\``,
      `- Switch facilitator base URL to \`${XGUARD_ORIGIN}\` and send \`Authorization: Bearer <apiKey>\`.`,
      "",
    ]);

  return [
    "# XGuard Conversion Queue",
    "",
    `Generated: ${report.generatedAt}`,
    `Targets: ${report.conversionTargetCount}`,
    `P0 targets: ${report.p0Count}`,
    `P1 targets: ${report.p1Count}`,
    "",
    "This is an execution queue: every row carries a machine-readable switch kit. XGuard never changes third-party infrastructure without the merchant controlling that service; the kit reduces the merchant-side change to registration, prepaid balance, and facilitator URL/auth replacement.",
    "",
    "| Priority | Score | Target | Resources | Live 402 | MCP | Current facilitator hint | Price range | Action |",
    "| --- | ---: | --- | ---: | ---: | ---: | --- | --- | --- |",
    ...rows,
    "",
    "## Highest-impact switch packets",
    "",
    ...top,
  ].join("\n");
}

export function selfTest() {
  const report = buildConversionQueue({
    network: BASE_MAINNET,
    targets: [
      {
        target: "api.example.com",
        kind: "service-host",
        score: 100,
        resourceCount: 40,
        live402Count: 5,
        mcpResourceCount: 10,
        sources: ["cdp-bazaar", "payai-bazaar"],
        incumbentHints: ["cdp", "payai"],
        sampleResources: ["https://api.example.com/mcp"],
        minPriceMicroUsd: 1_000,
        maxPriceMicroUsd: 100_000,
      },
      {
        target: "catalog-only.example",
        kind: "service-host",
        score: 55,
        resourceCount: 1,
        live402Count: 0,
        mcpResourceCount: 0,
        sources: ["cdp-bazaar"],
        incumbentHints: ["cdp"],
        sampleResources: ["https://catalog-only.example/api"],
      },
    ],
  });
  if (report.packets.length !== 2)
    throw new Error("self_test_packet_count_failed");
  if (report.packets[0].target !== "api.example.com")
    throw new Error("self_test_priority_sort_failed");
  if (report.packets[0].priority !== "P0")
    throw new Error("self_test_p0_failed");
  if (
    !report.packets[0].switchKit.publicMigrationManifest.includes(
      "from=cdp%2Cpayai",
    )
  )
    throw new Error("self_test_manifest_failed");
  if (report.packets[1].confidence !== "catalog-observed")
    throw new Error("self_test_confidence_failed");
  return true;
}

async function main() {
  if (process.argv.includes("--self-test")) {
    selfTest();
    console.log(JSON.stringify({ conversionSelfTest: true }));
    return;
  }

  const input =
    process.env.XGUARD_ADOPTION_TARGETS_JSON ?? "adoption-targets.json";
  const raw = JSON.parse(await readFile(input, "utf8"));
  const report = buildConversionQueue(raw);
  await writeFile(
    process.env.XGUARD_CONVERSION_JSON ?? "conversion-queue.json",
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await writeFile(
    process.env.XGUARD_CONVERSION_MARKDOWN ?? "conversion-queue.md",
    renderMarkdown(report),
  );
  console.log(
    JSON.stringify({
      event: "conversion_queue_ready",
      targets: report.conversionTargetCount,
      p0: report.p0Count,
      p1: report.p1Count,
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
        event: "conversion_engine_failed",
        error: String(error),
      }),
    );
    process.exitCode = 1;
  });
}
