#!/usr/bin/env node
import process from "node:process";
import { Command } from "commander";
import pc from "picocolors";
import { runDoctor } from "./doctor.js";
import { applyMigration, rollbackLatest } from "./migration.js";

const program = new Command();
program
  .name("xguard")
  .description("Migrate and diagnose x402 v2 integrations safely")
  .version("0.1.0-alpha.0");

program
  .command("init")
  .description(
    "Detect a direct x402 facilitator and migrate it to XGuard with rollback",
  )
  .option(
    "--gateway <url>",
    "XGuard gateway URL",
    process.env.XGUARD_URL ?? "http://localhost:8787",
  )
  .option("--skip-tests", "Do not run the repository's existing test script")
  .action(async (options: { gateway: string; skipTests?: boolean }) => {
    const manifest = await applyMigration(
      process.cwd(),
      options.gateway,
      options.skipTests !== true,
    );
    console.log(
      pc.green(
        `Migrated ${manifest.changes.length} source file(s) to ${manifest.gatewayUrl}`,
      ),
    );
    console.log(
      `Detected framework(s): ${manifest.detectedFrameworks.join(", ") || "none"}`,
    );
    for (const change of manifest.changes)
      console.log(`  ${change.file} (facilitator URL migrated)`);
    for (const change of manifest.configurationChanges)
      console.log(`  ${change.file} (configuration)`);
    console.log(`Rollback: ${pc.bold("npx xguard rollback")}`);
  });

program
  .command("rollback")
  .description(
    "Restore the latest XGuard migration if files have not changed since",
  )
  .action(async () => {
    const manifest = await rollbackLatest(process.cwd());
    console.log(pc.green(`Restored ${manifest.changes.length} file(s)`));
  });

program
  .command("doctor")
  .description(
    "Diagnose x402 version, migration safety, gateway compatibility, and endpoint metadata",
  )
  .option("--endpoint <url>", "Optional paid x402 endpoint to inspect")
  .option("--json", "Emit machine-readable JSON")
  .action(async (options: { endpoint?: string; json?: boolean }) => {
    const checks = await runDoctor(process.cwd(), options.endpoint);
    if (options.json === true) console.log(JSON.stringify({ checks }, null, 2));
    else
      for (const check of checks) {
        const badge =
          check.status === "PASS"
            ? pc.green("PASS")
            : check.status === "WARN"
              ? pc.yellow("WARN")
              : pc.red("FAIL");
        console.log(`${badge} ${pc.bold(check.name)} — ${check.detail}`);
      }
    if (checks.some((check) => check.status === "FAIL")) process.exitCode = 1;
  });

program.parseAsync().catch((error: unknown) => {
  console.error(
    pc.red(error instanceof Error ? error.message : "XGuard CLI failed"),
  );
  process.exitCode = 1;
});
