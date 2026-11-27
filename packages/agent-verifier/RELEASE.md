# Release 1.0.0 and maintainer guide

The release includes a local MCP extension, a separate host-side EIP-3009 signing adapter, a versioned policy profile and a portable conformance suite. The extension bundle contains only the inspection entry point, policy and verification code, MCP transport, manifest and license. Operators provide a local policy. The grant project works independently of XGuard's hosted catalog.

| Tested component | Exercised path | Result |
| --- | --- | --- |
| goose 1.61.1 on Linux x86-64 | Real CLI, YAML recipe, stdio extension, two tool calls, structured output fed to the host signing adapter | One recovered test-wallet signature, second attempt refused, fixture receipt reconciled |
| Pydantic AI 1.87.0 on Linux | Real Agent, FunctionModel, MCPServerStdio and the same host adapter | One recovered test-wallet signature, second attempt refused, fixture receipt reconciled |
| Official MCP JavaScript SDK 1.29.0 | Tool discovery, signed offer, receipt and refused tool | Two read-only tools available |
| Node merchant and independent Python merchant | Ephemeral Node signing keys, deterministic Python P-256 JWS, retired receipt key cutoff, accepted and rejected vectors | Both implementations produce verifiable signed artifacts |
| Unsupported signing profiles | Permit2, delegated authorizations, unexpected asset metadata and a different configured wallet | Refused before wallet invocation |

Both agent runs use deterministic local model fixtures. The normal agent runtimes and the test wallet perform real local operations. The signing test recovers the signer address with viem. No facilitator, funded wallet, model subscription or chain transaction participates. The extension does not install a global hook into goose. A wallet integration must call the host adapter on every intended signing path.

## Reproduce a release

Run from the repository root using Node.js 24, Python 3.12, goose 1.61.1 and a local virtual environment. The Python dependencies are for interoperability tests. Runtime inspection and the portable vector tests use Node's standard library.

```sh
npm ci --prefix apps/relay
npm run verifier:test
node --test apps/relay/test/open-agent-verifier.test.mjs
python -m pip install 'pydantic-ai-slim[mcp]==1.87.0' 'cryptography==50.0.2'
python packages/agent-verifier/conformance/merchant.py --vectors | diff - packages/agent-verifier/conformance/v1.json
node apps/relay/test/verifier-hosts.mjs goose /absolute/path/to/goose
node apps/relay/test/verifier-hosts.mjs pydantic-ai /absolute/path/to/venv/bin/python
python packages/agent-verifier/release/build_bundle.py /tmp/xguard-open-verifier
diff -u packages/agent-verifier/server.json /tmp/xguard-open-verifier/server.json
mcp-publisher validate /tmp/xguard-open-verifier/server.json
```

For a new version, change the manifest and MCP server version together, update this matrix and release notes, rebuild the bundle and commit its generated server.json. Keep a new version for changed bundle bytes. Review the profile, recovery behavior and binary digests in the release workflow before merging. Public CI reruns both hosts, regenerates the independent vectors and checks the metadata. The publishing job creates a versioned GitHub release, downloads and checks its assets, authenticates to the official registry with repository OIDC and reads back the matching entry. Rerunning it verifies existing assets. A checksum mismatch stops the release.

- [Versioned GitHub release](https://github.com/moelayyan90/XGuard/releases/tag/open-verifier-v1.0.0)
- [Official registry entry for version 1.0.0](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.moelayyan90%2Fxguard-open-verifier/versions/1.0.0)
- [Release workflow](../../.github/workflows/open-verifier-release.yml)
