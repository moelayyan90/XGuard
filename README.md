# XGuard Open Verifier

XGuard gives operators of open-source agents a way to inspect a merchant's signed x402 offer, approve one specific request and check the merchant receipt. The verifier runs locally on Node.js 24 under Apache-2.0. It works with independently configured merchants. The standalone package uses the Node standard library.

```sh
npm run verifier:demo
npm run verifier:test
```

The offline demo verifies sample artifacts and tries to use the same approval twice. Its output includes the price in token atomic units, the approval result and the reason the second use was rejected.

- [Operator guide, policy format and spending journal](packages/agent-verifier/README.md)
- [goose recipe](packages/agent-verifier/goose.yaml) and [installable version 1.0.0, host compatibility and maintainer guide](packages/agent-verifier/RELEASE.md)
- [Versioned profile, threat model and recovery](packages/agent-verifier/PROFILE.md)
- [Verifier tests](packages/agent-verifier/verifier.test.mjs) and [official MCP client interoperability test](apps/relay/test/open-agent-verifier.test.mjs)
- [Apache-2.0 license](LICENSE)

## Hosted reference API

XGuard also runs a paid technical intelligence API. Its public catalog gives current service definitions and prices. A merchant can implement the same signed-offer profile under its own domain and keys. The verifier, its local policy, tests and demo run independently of this service.

- [Production catalog](https://api.xguardgate.com/api/intelligence/v1/catalog)
- [OpenAPI](https://api.xguardgate.com/api/intelligence/v1/openapi.json) and [agent card](https://api.xguardgate.com/api/intelligence/v1/.well-known/agent-card.json)
- [Existing buyer and private result recovery](integrations/intelligence/README.md)
- [Hosted API operations](docs/operations/paid-intelligence-transition.md) and [historical commerce adapter scope](docs/operations/commerce-engine-20261117.md)

## Development

Use Node.js 24. To exercise the relay and the official MCP client as well as the standalone verifier, run the following commands from the repository root.

```sh
npm ci --prefix apps/relay
npm run check
npm test
npm run build
```

Production changes use the repository's pull request, CI and deployment workflows. A signed merchant receipt can be checked locally. Independent blockchain settlement and service delivery require their own evidence.
