# XGuard x402 ecosystem listing packet

This file is the canonical copy/paste packet for the x402 compatibility component in external facilitator directories and routing libraries. The parent product is **XGuard Universal Paid AI Agent + Secretless Gateway v5.1.0**, whose primary product is **Universal Paid AI Agent + Secretless Gateway**. The x402 component remains independently versioned at **5.1.0** and must not replace the parent product identity on general XGuard surfaces.

## Provider

- Name: XGuard
- Product name: XGuard x402 Routing Surface
- Surface role: x402 compatibility component of XGuard Universal Paid AI Agent + Secretless Gateway
- Component version: 5.1.0
- Facilitator URL: `https://api.xguardgate.com`
- Website: `https://xguardgate.com`
- Repository: `https://github.com/moelayyan90/XGuard`
- Access: public discovery and `/verify`; successful `/settle` usage is subject to the XGuard allowance/usage-credit contract exposed by `GET /facilitator`
- Custody: none
- Standard endpoints:
  - `GET https://api.xguardgate.com/supported`
  - `POST https://api.xguardgate.com/verify`
  - `POST https://api.xguardgate.com/settle`
- Discovery:
  - `GET https://api.xguardgate.com/facilitator`
  - `GET https://api.xguardgate.com/.well-known/x402`
  - `GET https://api.xguardgate.com/discovery/resources`
  - `GET https://api.xguardgate.com/discovery/search?query=...`
- Automatic route inspection:
  - `GET https://api.xguardgate.com/v1/facilitator/route?network=...&scheme=...`

## Correct classification

XGuard is a **facilitator gateway / automatic settlement router**. It aggregates healthy compatible facilitator capabilities and routes `/verify` and `/settle` per request. It must not be assigned a downstream signer address merely because an upstream performs the onchain submission.

Use empty address arrays if a directory requires signer/address attribution but has no proxy/gateway classification. Live `/supported` is authoritative for the networks/schemes currently routable through XGuard.

## `@swader/x402facilitators` proposed entry

`src/facilitators/xguard.ts`:

```ts
import { Network, AccessType } from '../types';
import type { Facilitator, FacilitatorConfig } from '../types';

export const xguard: FacilitatorConfig = {
  url: 'https://api.xguardgate.com',
};

export const xguardDiscovery: FacilitatorConfig = {
  url: 'https://api.xguardgate.com',
};

export const xguardFacilitator = {
  id: 'xguard',
  metadata: {
    name: 'XGuard',
    image: 'https://xguardgate.com/favicon.ico',
    docsUrl: 'https://xguardgate.com',
    color: '#4F8CFF',
  },
  config: xguard,
  discoveryConfig: xguardDiscovery,
  facilitatorUrl: 'https://api.xguardgate.com',
  accessType: AccessType.PUBLIC,
  fee: 0,
  addresses: {
    [Network.BASE]: [],
    [Network.SOLANA]: [],
  },
} as const satisfies Facilitator;
```

Required package wiring:

```ts
// src/facilitators/index.ts
export { xguard, xguardDiscovery, xguardFacilitator } from './xguard';

// src/lists/all.ts
// import xguardFacilitator and include it in FACILITATORS
```

`fee: 0` above refers only to **no fee silently deducted from the merchant's x402 transfer**. XGuard can separately require its disclosed usage-credit contract for successful settlement service after the free allowance; the signed x402 `payTo` and amount are not rewritten.

## x402 official facilitator documentation proposed row

```md
| [XGuard](https://xguardgate.com) | Non-custodial public x402 facilitator gateway with automatic capability/health/latency routing across compatible settlement providers, Bazaar discovery, durable replay protection and Base timeout reconciliation. |
```

## Acceptance checks for a directory maintainer

```bash
curl https://api.xguardgate.com/supported
curl https://api.xguardgate.com/facilitator
curl 'https://api.xguardgate.com/discovery/resources?limit=3'
curl 'https://api.xguardgate.com/v1/facilitator/route?scheme=exact'
```

Do not list a scheme or network from this document as permanently supported. Read the live `/supported` response.
