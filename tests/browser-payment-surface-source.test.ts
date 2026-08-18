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
      /input\s*\[\s*name\s*[*^$|~]?=\s*['"]?(?:card|cc|cvv|cvc|pan)/i,
    );
    expect(source).not.toMatch(
      /querySelectorAll\([^)]*(?:password|cc-number|card-number|cvv|cvc)/i,
    );
    expect(source).toContain("احجز هذه الدفعة");
    expect(source).toContain("ادفع الكل");
    expect(source).toContain("تحقق من هذه الدفعة عبر XGuard");
  });

  it("keeps Pay All local and sends payment-decision context only from explicit verification", async () => {
    const source = await readFile(contentPath, "utf8");

    const verifyFunctionIndex = source.indexOf(
      "async function verifyCurrent()",
    );
    const decisionMessageIndex = source.indexOf(
      'type: "XGUARD_PAYMENT_DECISION"',
    );
    expect(verifyFunctionIndex).toBeGreaterThan(-1);
    expect(decisionMessageIndex).toBeGreaterThan(verifyFunctionIndex);

    const beforeVerify = source.slice(0, verifyFunctionIndex);
    expect(beforeVerify).not.toContain('type: "XGUARD_PAYMENT_DECISION"');

    expect(source).toContain('type: "XGUARD_PAY_ALL_ADD"');
    expect(source).toContain('type: "XGUARD_PAY_ALL_START"');
  });

  it("keeps the Pay All cart in extension-local storage", async () => {
    const worker = await readFile(workerPath, "utf8");
    expect(worker).toContain('const CART_KEY = "xguardPayAllCart"');
    expect(worker).toContain('const SESSION_KEY = "xguardPayAllSession"');
    expect(worker).toContain("chrome.storage.local");
    expect(worker).not.toContain("/v1/pay-all");
  });

  it("limits network host permission to XGuard while detecting checkout locally", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(manifest.host_permissions).toEqual(["https://xguardgate.com/*"]);
    expect(manifest.content_scripts[0].all_frames).toBe(false);
    expect(manifest.content_scripts[0].matches).toEqual(["https://*/*"]);
  });

  it("generates an idempotency request ID in the service worker", async () => {
    const source = await readFile(workerPath, "utf8");
    expect(source).toContain("crypto.randomUUID()");
    expect(source).toContain("/v1/payment/decision");
    expect(source).toContain("Authorization");
  });
});
