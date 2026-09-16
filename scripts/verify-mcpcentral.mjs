// MCPCentral mirrors the official MCP registry; it has no separate publisher.
// https://mcpcentral.io/docs/submit-a-server
// https://mcpcentral.io/docs/consume-the-registry
import { readFile, appendFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../server.json", import.meta.url), "utf8"));
const endpoint = manifest.remotes.find(remote => remote.type === "streamable-http").url;
const report = { observed_at: new Date().toISOString(), name: manifest.name, expected_version: manifest.version,
  endpoint, publication_method: "official_registry_daily_mirror", upstream_published: false, mirror_verified: false };

async function get(url) {
  const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "XGuard-MCPCentral-Discovery/1.0" }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} at ${new URL(url).origin}${new URL(url).pathname}`);
  return response.json();
}

try {
  const upstream = await get(`https://registry.modelcontextprotocol.io/v0.1/servers?search=${encodeURIComponent(manifest.name)}&limit=100`);
  report.upstream_published = upstream.servers?.some(row => row.server?.name === manifest.name && row.server.version === manifest.version
    && row.server.remotes?.some(remote => remote.type === "streamable-http" && remote.url === endpoint)) === true;
  if (!report.upstream_published) throw new Error("Exact manifest version and endpoint are missing from the official registry");

  // The documented server identifier contains a namespace/name slash.
  const mirror = await get(`https://mcpcentral.io/api/servers/${manifest.name.split("/").map(encodeURIComponent).join("/")}`);
  const server = mirror.server ?? mirror.data?.server ?? mirror.data ?? mirror;
  report.response_fields = Object.keys(server);
  const registered = server.raw ?? server;
  report.observed_version = registered.version ?? server.version ?? null;
  report.mirror_verified = [server.id, server.name, registered.name].includes(manifest.name)
    && report.observed_version === manifest.version
    && (registered.remotes ?? server.remotes)?.some(remote => remote.type === "streamable-http" && remote.url === endpoint) === true;
  if (!report.mirror_verified) throw new Error("MCPCentral has not exposed the exact manifest version and endpoint; daily synchronization may still be pending");
} catch (error) {
  report.error = String(error.message);
  process.exitCode = 1;
}

console.log(JSON.stringify(report, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
  `## MCPCentral discovery\n\nOfficial registry publication: ${report.upstream_published ? "verified" : "not verified"}.\n\nMCPCentral exact-version mirror: ${report.mirror_verified ? "verified" : "not verified"}.\n\nMCPCentral synchronizes the official registry daily; no credentials are sent to a separate registry host.\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`);
