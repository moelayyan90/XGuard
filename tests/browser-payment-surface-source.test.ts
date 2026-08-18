import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const contentPath = new URL(
  "../browser-extension/universal-layer.js",
  import.meta.url,
);
const inlinePath = new URL(
  "../browser-extension/surface-rail.js",
  import.meta.url,
);
const workerPath = new URL(
  "../browser-extension/service-worker.js",
  import.meta.url,
);
const manifestPath = new URL(
  "../browser-extension/manifest.json",
  import.meta.url,
);

describe("buyer browser payment-layer source invariants", () => {
  it("does not read common sensitive payment input values", async () => {
    const source = `${await readFile(contentPath, "utf8")}\n${await readFile(inlinePath, "utf8")}`;
    expect(source).not.toMatch(
      /input\s*\[\s*name\s*[*^$|~]?=\s*['"]?(?:card|cc|cvv|cvc|pan)/i,
    );
    expect(source).not.toMatch(
      /querySelectorAll\([^)]*(?:password|cc-number|card-number|cvv|cvc)/i,
    );
    expect(source).toContain("ترحيل لغايات الدفع");
    expect(source).toContain("دفع كل الفواتير");
    expect(source).toContain("تقسيم الفواتير");
    expect(source).toContain("دفع هذه فقط");
  });

  it("keeps payment memory local and sends server context only from explicit verification", async () => {
    const source = await readFile(contentPath, "utf8");
    const inline = await readFile(inlinePath, "utf8");
    const verifyFunctionIndex = source.indexOf(
      "async function verifyCurrent()",
    );
    const decisionMessageIndex = source.indexOf(
      'type: "XGUARD_PAYMENT_DECISION"',
    );
    expect(verifyFunctionIndex).toBeGreaterThan(-1);
    expect(decisionMessageIndex).toBeGreaterThan(verifyFunctionIndex);
    expect(source.slice(0, verifyFunctionIndex)).not.toContain(
      'type: "XGUARD_PAYMENT_DECISION"',
    );
    expect(source).toContain('type: "XGUARD_PAYMENT_DEFER"');
    expect(source).toContain('type: "XGUARD_PAY_SINGLE_START"');
    expect(source).toContain('type: "XGUARD_PAY_ALL_START"');
    expect(source).toContain('type: "XGUARD_SPLIT_CREATE"');
    expect(inline).not.toContain('type: "XGUARD_PAYMENT_DECISION"');
    expect(inline).toContain('type: "XGUARD_MEMORY_GET"');
    expect(inline).toContain('type: "XGUARD_PAYMENT_DEFER"');
    expect(inline).toContain('type: "XGUARD_PAY_SINGLE_START"');
    expect(inline).toContain('type: "XGUARD_PAY_ALL_START"');
  });

  it("stores payees, pending bills, sessions, and history in extension-local storage", async () => {
    const worker = await readFile(workerPath, "utf8");
    expect(worker).toContain('const CART_KEY = "xguardPayAllCart"');
    expect(worker).toContain('const SESSION_KEY = "xguardPayAllSession"');
    expect(worker).toContain('const PAYEES_KEY = "xguardSavedPayees"');
    expect(worker).toContain('const HISTORY_KEY = "xguardPaymentHistory"');
    expect(worker).toContain("chrome.storage.local");
    expect(worker).not.toContain("/v1/pay-all");
  });

  it("limits network host permission to XGuard while detecting payment surfaces locally", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(manifest.host_permissions).toEqual(["https://xguardgate.com/*"]);
    expect(manifest.content_scripts[0].all_frames).toBe(false);
    expect(manifest.content_scripts[0].matches).toEqual(["https://*/*"]);
    expect(manifest.content_scripts[0].js).toEqual([
      "universal-layer.js",
      "surface-rail.js",
    ]);
  });

  it("generates idempotency IDs for explicit XGuard server-side decisions", async () => {
    const source = await readFile(workerPath, "utf8");
    expect(source).toContain("crypto.randomUUID()");
    expect(source).toContain("/v1/payment/decision");
    expect(source).toContain("Authorization");
  });
});
