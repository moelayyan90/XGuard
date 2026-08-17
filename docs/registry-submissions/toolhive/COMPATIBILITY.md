# ToolHive compatibility evidence

XGuard's public remote MCP endpoint was exercised through ToolHive's own remote proxy path on 2026-08-17.

## Verified target

- XGuard MCP endpoint: `https://xguardgate.com/mcp`
- ToolHive version: `v0.43.0`
- ToolHive release commit: `8f294e26a9eecfc439c09e3e1d58a241064054f6`
- Platform: `linux/amd64`
- Transport: `streamable-http`
- Local ToolHive proxy port used for the test: `18080`
- GitHub Actions run: `31997034944`
- Source commit exercised: `8802cc64b49c188628453fce41abfbd14529e63d`

## Result

ToolHive successfully started a managed remote workload using:

```text
thv run https://xguardgate.com/mcp --name xguard-toolhive-smoke --proxy-port 18080 --transport streamable-http
```

An MCP `initialize` request sent through the ToolHive proxy returned HTTP 200 and negotiated protocol version `2025-11-25`.

A subsequent `tools/list` request sent through the ToolHive proxy returned HTTP 200 and exposed all three expected XGuard tools:

- `xguard_discover`
- `xguard_resource_details`
- `xguard_status`

The test completed with `TOOLHIVE_XGUARD_COMPATIBILITY=PASS`.

The one-off workflow used to perform the compatibility test was removed after the successful run so it does not become part of XGuard's permanent CI surface.
