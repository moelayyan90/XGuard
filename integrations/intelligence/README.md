# XGuard paid intelligence client

Use Node.js 24. Inspect a request by saving the following input as `fact.json`.

```json
{"fact":"npm/react/latest-version"}
```

```sh
node integrations/intelligence/request.mjs quote facts fact.json
```

The quote command checks the resource URL, Base network, USDC contract, treasury and amount in the HTTP body and Payment-Required header. One independent query costs 1,000 USDC atomic units. A 100-item fact batch costs 100,000.

## GitHub Actions

Check out the repository that owns the input file first. Pin the XGuard action to a reviewed commit in production workflows.

```yaml
- uses: actions/checkout@v6
- uses: moelayyan90/XGuard/integrations/intelligence@main
  with:
    service: facts
    input-file: fact.json
```

The composite action only inspects an unsigned quote. For paid use in a self-hosted job or local application, install the repository's pinned payer dependencies with `npm ci --prefix apps/relay`. Provision a narrowly funded signer through your own secret store as `XGUARD_PAYER_PRIVATE_KEY`. Give the job a private, persistent directory for its recovery record.

```sh
XGUARD_OPERATION_ID=my-release-001 XGUARD_MAX_AMOUNT_ATOMIC=1000 \
  node integrations/intelligence/request.mjs buy facts fact.json /private/xguard/release-001.json
node integrations/intelligence/request.mjs recover /private/xguard/release-001.json
```

Use the same operation ID and private recovery file on retries. The client writes the original quote and input before submitting the authorization, checks the signed receipt and result digest, and prints a delivered result to standard output. Keep the recovery file and paid output out of public logs or artifacts.

## MCP and A2A

`GET /api/intelligence/v1/install` returns server configurations for VS Code and Cursor, CLI commands for Codex, Claude Code and Gemini CLI, and the remote URL for ChatGPT workspaces with custom apps enabled. Protocol discovery is exercised with the official MCP and A2A SDKs. Installation in an individual account depends on its settings. Each paid tool call needs an authorized x402 buyer.

[Codex](https://developers.openai.com/learn/docs-mcp) · [Claude Code](https://code.claude.com/docs/en/mcp) · [Gemini CLI](https://geminicli.com/docs/tools/mcp-server/) · [VS Code](https://code.visualstudio.com/docs/agent-customization/mcp-servers) · [Cursor](https://cursor.com/docs/mcp) · [ChatGPT custom apps](https://developers.openai.com/api/docs/guides/custom-mcp-server)
