import manifest from '../../../../server.json' with { type: 'json' };
import { ORIGIN } from './types.ts';
import { factExample } from './public-fact.ts';
import { escape } from './util.ts';

export const installPath = '/install';
const mcpPath = '/mcp';
const mcpUrl = ORIGIN + mcpPath;
const name = 'xguard-live';
const config = { type: 'http', url: mcpUrl };
const vscode = 'vscode:mcp/install?' + encodeURIComponent(JSON.stringify({ name, ...config }));
const cursor = 'cursor://anysphere.cursor-deeplink/mcp/install?name=' + name +
  '&config=' + encodeURIComponent(btoa(JSON.stringify({ url: mcpUrl })));

export const integrationLinks = {
  install: ORIGIN + installPath,
  mcp: mcpUrl,
  mcp_server_card: mcpUrl + '/server-card',
  mcp_registry_manifest: ORIGIN + '/server.json',
  a2a_agent_card: ORIGIN + '/.well-known/agent-card.json',
};

export const installation = {
  title: 'Connect XGuard Live',
  ...integrationLinks,
  vscode_config: { servers: { [name]: config } },
  cursor_config: { mcpServers: { [name]: { url: mcpUrl } } },
  codex_command: 'codex mcp add ' + name + ' --url ' + mcpUrl,
  claude_code_command: 'claude mcp add --transport http ' + name + ' ' + mcpUrl,
  first_call: { name: 'xguard.fact.get', arguments: { factId: factExample } },
};

export const installHtml = `<p>Connect your AI client to read published software facts with their primary source, verification time and change history. Public fact reads require no account or API key.</p>
<h2>Connect with MCP</h2><p><a class="button" href="${escape(vscode)}">Add to VS Code</a> <a href="${escape(cursor)}">Add to Cursor ↗</a></p>
<p>For ChatGPT or another client with custom remote MCP support, use Streamable HTTP at <code>${mcpUrl}</code>.</p>
<h3>Codex</h3><pre>${installation.codex_command}</pre>
<h3>Claude Code</h3><pre>${installation.claude_code_command}</pre>
<h2>Try a free fact</h2><p>Ask your client to use <code>xguard.fact.get</code> for <code>${factExample}</code> and cite the primary source and verification time.</p>
<p><a href="/fact/${factExample}">Open the example fact ↗</a> · <a href="/topics">Browse fact IDs ↗</a></p>
<h2>Machine discovery</h2><p><a href="/mcp/server-card">MCP server card</a> · <a href="/server.json">MCP Registry manifest</a> · <a href="/.well-known/agent-card.json">A2A agent card</a></p>
<p>Paid web fetch and signed receipts are separate from free fact reads.</p>`;

export const registryManifest = manifest;
const { $schema, ...serverCard } = manifest;
export const mcpServerCard = {
  ...serverCard,
  remotes: [{ ...manifest.remotes[0], supportedProtocolVersions: ['2026-07-28', '2025-11-25'] }],
};
