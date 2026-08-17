import { describe, expect, it } from "vitest";
import { mcpubDiscoveryResponse } from "../apps/worker/src/mcpub-discovery.js";

const ORIGIN = "https://xguardgate.com";

describe("mcpub discovery alias", () => {
  it("serves /.well-known/mcp.json", async () => {
    const response = mcpubDiscoveryResponse(
      new Request(`${ORIGIN}/.well-known/mcp.json`),
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toContain("application/json");
    const body = (await response?.json()) as {
      name: string;
      version: string;
      mcp: string;
      registryName: string;
    };
    expect(body.name).toBe("XGuard");
    expect(body.version).toBe("0.5.1");
    expect(body.mcp).toBe(`${ORIGIN}/mcp`);
    expect(body.registryName).toBe("io.github.moelayyan90/xguard");
  });

  it("supports HEAD and ignores unrelated requests", async () => {
    const head = mcpubDiscoveryResponse(
      new Request(`${ORIGIN}/.well-known/mcp.json`, { method: "HEAD" }),
    );
    expect(head?.status).toBe(200);
    expect(await head?.text()).toBe("");
    expect(mcpubDiscoveryResponse(new Request(`${ORIGIN}/status`))).toBeNull();
    expect(
      mcpubDiscoveryResponse(
        new Request(`${ORIGIN}/.well-known/mcp.json`, { method: "POST" }),
      ),
    ).toBeNull();
  });
});
