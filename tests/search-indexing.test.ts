import { describe, expect, it } from "vitest";
import { searchIndexResponse } from "../apps/worker/src/search-indexing.js";

const ORIGIN = "https://xguard-mainnet.maqamapp.workers.dev";

describe("public search indexing", () => {
  it("serves current root JSON metadata", async () => {
    const response = searchIndexResponse(new Request(`${ORIGIN}/`));
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toContain("application/json");

    const body = (await response?.json()) as {
      name: string;
      title: string;
      version: string;
      protocol: string;
      discovery: { sitemap: string; mcp: string; provider: string };
    };
    expect(body.name).toBe("XGuard");
    expect(body.title).toContain("x402 Economic Firewall");
    expect(body.version).toBe("0.4.0");
    expect(body.protocol).toBe("x402-v2");
    expect(body.discovery.sitemap).toBe(`${ORIGIN}/sitemap.xml`);
    expect(body.discovery.mcp).toBe(`${ORIGIN}/mcp`);
    expect(body.discovery.provider).toBe(
      `${ORIGIN}/.well-known/x402/facilitator.json`,
    );
  });

  it("serves an indexable HTML landing page to browsers and crawlers", async () => {
    const response = searchIndexResponse(
      new Request(`${ORIGIN}/`, { headers: { Accept: "text/html" } }),
    );
    const html = await response?.text();
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("x402 Economic Firewall");
    expect(html).toContain("/.well-known/x402/facilitator.json");
    expect(html).toContain("/.well-known/mcp/server.json");
    expect(html).toContain('rel="canonical"');
    expect(html).toContain("application/ld+json");
  });

  it("publishes a sitemap containing the machine discovery surfaces", async () => {
    const response = searchIndexResponse(new Request(`${ORIGIN}/sitemap.xml`));
    const xml = await response?.text();
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toContain("application/xml");
    expect(xml).toContain(`${ORIGIN}/`);
    expect(xml).toContain(`${ORIGIN}/.well-known/x402/facilitator.json`);
    expect(xml).toContain(`${ORIGIN}/.well-known/agent-card.json`);
    expect(xml).toContain(`${ORIGIN}/.well-known/mcp/server.json`);
    expect(xml).toContain(`${ORIGIN}/discovery/resources`);
    expect(xml).toContain(`${ORIGIN}/openapi.json`);
  });

  it("advertises the sitemap in robots.txt", async () => {
    const response = searchIndexResponse(new Request(`${ORIGIN}/robots.txt`));
    const robots = await response?.text();
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toContain("text/plain");
    expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
    expect(robots).toContain(`${ORIGIN}/mcp`);
    expect(robots).toContain(`${ORIGIN}/llms-full.txt`);
  });

  it("serves HEAD without a body and ignores mutating requests", async () => {
    const head = searchIndexResponse(
      new Request(`${ORIGIN}/sitemap.xml`, { method: "HEAD" }),
    );
    expect(head?.status).toBe(200);
    expect(await head?.text()).toBe("");

    expect(
      searchIndexResponse(new Request(`${ORIGIN}/`, { method: "POST" })),
    ).toBeNull();
    expect(searchIndexResponse(new Request(`${ORIGIN}/status`))).toBeNull();
  });
});
