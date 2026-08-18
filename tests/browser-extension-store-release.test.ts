import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const extension = join(root, "browser-extension");
const manifest = JSON.parse(
  readFileSync(join(extension, "manifest.json"), "utf8"),
) as {
  manifest_version: number;
  name?: string;
  version?: string;
  description?: string;
  permissions?: string[];
  host_permissions?: string[];
  content_scripts?: Array<{
    matches?: string[];
    exclude_matches?: string[];
    js?: string[];
  }>;
  icons?: Record<string, string>;
};

describe("browser extension store release", () => {
  it("uses Manifest V3 with minimal XGuard-only API permissions", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(["storage"]);
    expect(manifest.host_permissions).toEqual(["https://xguardgate.com/*"]);
  });

  it("makes task recovery the primary HTTPS surface while retaining payment adapters", () => {
    expect(manifest.name).toBe("XGuard Task Recovery");
    expect(manifest.version).toBe("0.3.0");
    expect(manifest.description).toContain("task-control and recovery");
    expect(manifest.content_scripts).toHaveLength(1);
    expect(manifest.content_scripts?.[0]?.matches).toEqual(["https://*/*"]);
    expect(manifest.content_scripts?.[0]?.exclude_matches).toContain(
      "https://xguardgate.com/*",
    );
    expect(manifest.content_scripts?.[0]?.js).toEqual([
      "recovery-layer.js",
      "universal-layer.js",
      "surface-rail.js",
    ]);
    for (const file of [
      "recovery-layer.js",
      "universal-layer.js",
      "surface-rail.js",
    ]) {
      expect(existsSync(join(extension, file))).toBe(true);
    }
  });

  it("ships the raster icons Chrome and Edge need", () => {
    for (const size of ["16", "32", "48", "128"]) {
      const relative = manifest.icons?.[size];
      expect(relative).toBeTruthy();
      expect(existsSync(join(extension, relative ?? ""))).toBe(true);
    }
  });

  it("ships explicit privacy and store-review disclosures", () => {
    const privacy = readFileSync(join(extension, "PRIVACY.md"), "utf8");
    const listing = readFileSync(
      join(extension, "STORE_SUBMISSION.md"),
      "utf8",
    );
    expect(privacy).toContain("Continue without XGuard");
    expect(privacy).toContain("does not sell user data");
    expect(privacy).toContain("field values");
    expect(privacy).toContain("card number");
    expect(listing).toContain("Single purpose");
    expect(listing).toContain("task continuity and recovery");
    expect(listing).toContain("Remote code");
    expect(listing).toContain("Website content");
  });
});
