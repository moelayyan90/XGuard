import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("institutional child-safety contact routing", () => {
  it("wires the contact intake ahead of public child-safety pages", () => {
    const source = readFileSync(
      "apps/worker/src/universal-mainnet.ts",
      "utf8",
    );
    expect(source).toContain('from "./child-safety-contact.js"');
    expect(source).toContain("childSafetyContactResponse");
    expect(source.indexOf("childSafetyContactResponse")).toBeLessThan(
      source.indexOf("childSafetyInstitutionalResponse"),
    );
  });

  it("ships a D1 migration for institutional enquiries", () => {
    const migration = readFileSync(
      "apps/worker/migrations/0020_child_safety_institutional_contacts.sql",
      "utf8",
    );
    expect(migration).toContain("child_safety_institutional_contacts");
    expect(migration).toContain("source_ip_hash");
  });
});
