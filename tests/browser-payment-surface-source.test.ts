import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const contentPath = new URL("../browser-extension/content.js", import.meta.url);
const workerPath = new URL(
  "../browser-extension/service-worker.js",
  import.meta.url,
);
const manifestPath = new URL(
  "../browser-extension/manifest.json",
  import.meta.url,
);

describe("buyer browser surface source invariants", () => {
  it("does not read common sensitive payment input values", async () => {
    const source = await readFile(contentPath, "utf8");
    expect(source).not.toMatch(
      /input\s*\[\s*name\s*[*^$|~]?=\s*['\"]?(?:card|cc|cvv|cvc|pan)/i,
    );
    expect(source).not.toMatch(
      /querySelectorAll\([^)]*(?:password|cc-number|card-number|cvv|cvc)/i,
    );
    expect(source).toContain("Use XGuard");
    expect(source).toContain("Continue without XGuard");
  });

  it("sends payment context only from the explicit Use XGuard click path", async () => {
    const source = await readFile(contentPath, "utf8");
    const sendIndex = source.indexOf("chrome.runtime.sendMessage");
    const clickIndex = source.indexOf(
      'shadow.querySelector(".use").addEventListener("click"',
    );
    expect(clickIndex).toBeGreaterThan(-1);
    expect(sendIndex).toBeGreaterThan(clickIndex);
    expect(source.slice(0, clickIndex)).not.toContain(
      "chrome.runtime.sendMessage",
    );
  });

  it("limits network host permission to XGuard while detecting checkout locally", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(manifest.host_permissions).toEqual([
      "https://xguardgate.com/*",
      "https://www.xguardgate.com/*",
    ]);
    expect(manifest.content_scripts[0].all_frames).toBe(false);
  });

  it("generates an idempotency request ID in the service worker", async () => {
    const source = await readFile(workerPath, "utf8");
    expect(source).toContain("crypto.randomUUID()");
    expect(source).toContain("/v1/payment/decision");
    expect(source).toContain("Authorization");
  });
});
