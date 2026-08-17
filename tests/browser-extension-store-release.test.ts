import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const extension = join(root, "browser-extension");
const manifest = JSON.parse(
  readFileSync(join(extension, "manifest.json"), "utf8"),
) as {
  manifest_version: number;
  permissions?: string[];
  host_permissions?: string[];
  content_scripts?: Array<{
    matches?: string[];
    exclude_matches?: string[];
  }>;
  icons?: Record<string, string>;
};

describe("browser extension store release", () => {
  it("uses Manifest V3 with minimal XGuard-only API permissions", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(["storage"]);
    expect(manifest.host_permissions).toEqual(["https://xguardgate.com/*"]);
  });

  it("detects checkout context on HTTPS pages only", () => {
    expect(manifest.content_scripts).toHaveLength(1);
    expect(manifest.content_scripts?.[0]?.matches).toEqual(["https://*/*"]);
    expect(manifest.content_scripts?.[0]?.exclude_matches).toContain(
      "https://xguardgate.com/*",
    );
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
    expect(privacy).toContain("card number");
    expect(listing).toContain("Single purpose");
    expect(listing).toContain("Remote code");
    expect(listing).toContain("Website content");
  });
});
