import { describe, expect, it } from "vitest";
import {
  safeGenericHttpsTarget,
  validGenericUpstreamCredential,
} from "../apps/worker/src/generic-http-connector.js";

describe("XGuard generic HTTPS connector target safety", () => {
  it("accepts public HTTPS API targets", () => {
    expect(
      safeGenericHttpsTarget(
        "https://api.example.com/v1/orders?limit=10",
      )?.toString(),
    ).toBe("https://api.example.com/v1/orders?limit=10");
    expect(
      safeGenericHttpsTarget("https://api.stripe.com:443/v1/payment_intents")
        ?.hostname,
    ).toBe("api.stripe.com");
  });

  it("rejects non-HTTPS targets", () => {
    expect(
      safeGenericHttpsTarget("http://api.example.com/v1/orders"),
    ).toBeNull();
    expect(safeGenericHttpsTarget("ftp://api.example.com/file")).toBeNull();
  });

  it("rejects URL credentials and non-standard ports", () => {
    expect(
      safeGenericHttpsTarget("https://user:secret@api.example.com/v1/orders"),
    ).toBeNull();
    expect(
      safeGenericHttpsTarget("https://api.example.com:8443/v1/orders"),
    ).toBeNull();
  });

  it("rejects localhost, private-style names, metadata names, and IP literals", () => {
    for (const target of [
      "https://localhost/",
      "https://service.internal/",
      "https://router.local/",
      "https://metadata.google.internal/",
      "https://127.0.0.1/",
      "https://10.0.0.1/",
      "https://[::1]/",
      "https://singlelabel/",
    ]) {
      expect(safeGenericHttpsTarget(target)).toBeNull();
    }
  });

  it("rejects fragments so the upstream request is unambiguous", () => {
    expect(
      safeGenericHttpsTarget("https://api.example.com/v1/orders#private"),
    ).toBeNull();
  });

  it("requires a separate, bounded upstream credential", () => {
    expect(validGenericUpstreamCredential(null)).toBe(false);
    expect(validGenericUpstreamCredential("short")).toBe(false);
    expect(validGenericUpstreamCredential("real-api-key-123")).toBe(true);
    expect(validGenericUpstreamCredential("line1\nline2")).toBe(false);
    expect(validGenericUpstreamCredential("x".repeat(4097))).toBe(false);
  });
});
