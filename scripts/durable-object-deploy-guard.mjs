#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const CONFIG_PATH = "apps/relay/wrangler.jsonc";
const STATE_VERSION_PATH = "apps/relay/deployment-state.json";

function readAt(ref) {
  return execFileSync("git", ["show", `${ref}:${CONFIG_PATH}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function paymentStateVersionAt(ref) {
  const present = execFileSync("git", ["ls-tree", "--name-only", ref, "--", STATE_VERSION_PATH], { encoding: "utf8" }).trim();
  if (!present) return 0;
  const manifest = JSON.parse(execFileSync("git", ["show", `${ref}:${STATE_VERSION_PATH}`], { encoding: "utf8" }));
  if (!Number.isSafeInteger(manifest.payment_state_version) || manifest.payment_state_version < 0) throw new Error("Invalid payment state compatibility version");
  return manifest.payment_state_version;
}

function stripJsonComments(source) {
  let result = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (current === "\n") {
        lineComment = false;
        result += current;
      }
      continue;
    }
    if (blockComment) {
      if (current === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (inString) {
      result += current;
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === '"') inString = false;
      continue;
    }
    if (current === '"') {
      inString = true;
      result += current;
    } else if (current === "/" && next === "/") {
      lineComment = true;
      index += 1;
    } else if (current === "/" && next === "*") {
      blockComment = true;
      index += 1;
    } else {
      result += current;
    }
  }
  return result;
}

function lifecycle(configText) {
  const config = JSON.parse(stripJsonComments(configText));
  const migrations = config.migrations ?? [];
  const bindings = (config.durable_objects?.bindings ?? [])
    .map(({ class_name, script_name, environment }) => ({ class_name, script_name, environment }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return { migrations, bindings };
}

function changedFiles(previousRef, currentRef) {
  const output = execFileSync("git", ["diff", "--name-only", previousRef, currentRef], {
    encoding: "utf8",
  });
  return output.split("\n").filter(Boolean);
}

export function evaluate(previousText, currentText, files = [], paymentState = { previous: 0, current: 0 }) {
  const previous = lifecycle(previousText);
  const current = lifecycle(currentText);
  const lifecycleChanged = JSON.stringify(previous) !== JSON.stringify(current);
  const paymentStateChanged = paymentState.previous !== paymentState.current;
  const paymentStateDowngrade = paymentState.current < paymentState.previous;
  const runtimeChanges = files.filter(
    (file) => file !== CONFIG_PATH && !file.startsWith("docs/") && file !== "CHANGELOG.md",
  );
  return {
    lifecycleChanged,
    paymentStateChanged,
    paymentStateDowngrade,
    rollbackAllowed: !lifecycleChanged && !paymentStateChanged,
    isolated: !paymentStateDowngrade && (!lifecycleChanged || runtimeChanges.length === 0),
    runtimeChanges,
    reason: paymentStateDowngrade ? "payment_state_downgrade_forbidden" : lifecycleChanged ? "durable_object_lifecycle_changed" : paymentStateChanged ? "payment_state_forward_recovery_required" : "same_durable_object_lifecycle",
  };
}

function emit(result) {
  const lines = [
    `lifecycle_changed=${result.lifecycleChanged}`,
    `rollback_allowed=${result.rollbackAllowed}`,
    `isolated=${result.isolated}`,
    `reason=${result.reason}`,
  ];
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [previousRef, currentRef] = process.argv.slice(2);
  if (!previousRef || !currentRef) {
    process.stderr.write("usage: durable-object-deploy-guard.mjs <previous-ref> <current-ref>\n");
    process.exit(2);
  }
  try {
    const result = evaluate(readAt(previousRef), readAt(currentRef), changedFiles(previousRef, currentRef), {
      previous: paymentStateVersionAt(previousRef), current: paymentStateVersionAt(currentRef),
    });
    emit(result);
    if (!result.isolated) {
      process.stderr.write(
        result.paymentStateDowngrade ? "Payment state downgrade forbidden: preserve reconciliation and no-repeat guards in a forward fix.\n" : `Durable Object lifecycle migrations must be deployed independently; runtime changes: ${result.runtimeChanges.join(", ")}\n`,
      );
      process.exit(1);
    }
  } catch (error) {
    emit({
      lifecycleChanged: true,
      rollbackAllowed: false,
      isolated: false,
      runtimeChanges: [],
      reason: "previous_deployment_source_unavailable",
    });
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
