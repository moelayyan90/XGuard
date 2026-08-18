import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "browser-extension", "recovery-layer.js"),
  "utf8",
);

describe("browser task recovery source", () => {
  it("covers non-payment workflow categories", () => {
    for (const category of [
      "authentication",
      "booking",
      "application",
      "upload",
      "commerce",
      "transfer",
      "settings",
      "support",
      "generic",
    ]) {
      expect(source).toContain(`\"${category}\"`);
    }
    expect(source).toContain("Task Control & Recovery");
    expect(source).toContain("احفظ نقطة رجوع");
    expect(source).toContain("استئناف المهمة");
  });

  it("detects visible failure and human-verification states", () => {
    expect(source).toContain("FAILURE_WORDS");
    expect(source).toContain("HUMAN_WORDS");
    expect(source).toContain("HUMAN_REQUIRED");
    expect(source).toContain("aria-invalid");
    expect(source).toContain("input:invalid");
    expect(source.toLowerCase()).toContain("captcha");
  });

  it("stores only checkpoint metadata and never serializes field values", () => {
    expect(source).toContain('const STORAGE_KEY = "xguardTaskRecoveryState"');
    expect(source).toContain("requiredCount: model.task.requiredCount");
    expect(source).toContain(
      "incompleteRequired: model.task.incompleteRequired",
    );
    expect(source).not.toContain("fieldValues");
    expect(source).not.toContain("innerHTML: document");
    expect(source).not.toContain("outerHTML");
  });

  it("keeps recovery local instead of uploading task pages", () => {
    expect(source).not.toContain("fetch(");
    expect(source).toContain("chrome.storage.local");
    expect(source).toContain("قيم الحقول");
  });
});
