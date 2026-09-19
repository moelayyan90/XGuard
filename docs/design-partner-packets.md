# Three bounded integration packets

Prepared 2026-09-19 from existing issues #240, #246 and #247 and current public source. These are proposals, not partnerships, installations, commitments to fund a canary, or customer revenue. No third-party repository was changed and no outreach was sent.

## Shared integration contract

Keep the merchant's price, asset, network, `payTo`, business response, credit system and existing authorization unchanged. Use the existing XGuard x402 compatibility client (`sdk/index.js`) or an official `HTTPFacilitatorClient` pointed at `https://api.xguardgate.com/facilitator`; confirm `/supported` and the merchant's existing authenticated billing configuration first. The `/v1/secretless/call` API is for scoped provider credentials and is not a replacement for the merchant's payer contract.

Select a cohort by a stable hash of the merchant's business request ID **before** verification. Persist the selected rail together with the payment authorization fingerprint. Start at 0%, then 1% of eligible Base requests only after the merchant approves. Keep the incumbent at 99%. Do not send the same authorization to both rails. Failures before any settlement submission may fall back using the documented original request. Any settlement timeout or uncertain response is pinned to its original rail and reconciled read-only; a fallback must never submit a second settlement.

Rollback changes the cohort for **new** requests to 0%; in-flight reservations retain their original rail until resolved. No secret, payment signature, full request body or raw capability belongs in telemetry. Operator-funded tests carry `x-xguard-traffic-class: canary` and are excluded from customer revenue.

Measure verify/settle p50/p95, confirmed settlement rate, ambiguous settlements, reconciliation time, delivered results, duplicate charges/executions and failure categories. Proposed acceptance: zero duplicated payments or executions; every paid failure accounted for by a durable unresolved record or recovery credit; at least 100 matched eligible observations before comparing rates; p95 no more than 20% worse than the measured incumbent. These thresholds are proposed gates, not measured results. Low traffic extends the observation window; it does not justify fabricated volume.

## 1. base-mcp-server — one HTTP route

- Source: [server.py](https://github.com/khlndaaa/base-mcp-server/blob/9ffa3f00f19c3a1ea173b547dd96db74ec27c277/server.py), existing [research #247](https://github.com/moelayyan90/XGuard/issues/247).
- Exact location: the `HTTPFacilitatorClient` / `x402ResourceServer` initialization and `PaymentMiddlewareASGI` registration for `GET /api/check-rugpull-risk` in `server.py`.
- Current incumbent: CDP client built with `create_facilitator_config`; shared resource server also supplies native MCP payment wrappers.
- Candidate adapter: a **separate** resource server for this HTTP route only, using the existing `RouteConfig`/`PaymentOption`, `X402_NETWORK`, price and `X402_PAY_TO`. Keep the native MCP wrapper on its incumbent.
- Scope: one read-only HTTP resource, Base only. Canary begins at 1% after approved authenticated fixture tests; no token, wallet or approval writes.
- Fallback/rollback: retain the original HTTP middleware configuration; return new requests to it by setting cohort to 0%. Never reinitialize the global shared server per request or race two settlement paths.
- Additional success criterion: HTTP settlement, delivery and discovery each have independent evidence. A Bazaar listing alone is not success.
- Open dependency: merchant approval, billing credential and funded canary budget have not been supplied.

## 2. APIbase — route-local resource server

- Source: [resource-server factory](https://github.com/whiteknightonhorse/APIbase/blob/3bddc569a8242bdf037188f0683406339697a321/src/services/x402-server.service.ts), [payment config](https://github.com/whiteknightonhorse/APIbase/blob/3bddc569a8242bdf037188f0683406339697a321/src/config/x402.config.ts), existing [research #246](https://github.com/moelayyan90/XGuard/issues/246).
- Exact location: `getSharedResourceServer()` in `src/services/x402-server.service.ts`, selected by `src/middleware/x402.middleware.ts` and the existing execution/payment pipeline. Implement a route-local alternative; do not replace the shared singleton for all tools.
- Current incumbent is configurable, not assumed: local on-chain settlement with PayAI fallback, or remote CDP/PayAI. The repository exposes `facilitatorMode`; production's selected mode has not been authenticated or independently verified.
- Candidate adapter: select XGuard only for one merchant-approved deterministic or read-only Base tool. Reuse `buildServerX402Requirements(priceUsd)` exactly, including trusted amount, asset and recipient. Retain MPP middleware and existing escrow/idempotency controls.
- Canary: 1% of this one eligible route, 0% of batches, device actions, MPP, money movement and other networks.
- Fallback/rollback: original factory and rail stay intact; route cohort 0% restores new traffic. Existing `payment-nonce` and operator locks remain active; no timeout-based double settlement.
- Additional success criterion: the provider response schema and escrow accounting remain identical to the incumbent. Compare actual delivery and payment diagnostics, not tool-count marketing.
- Open dependency: precise production tool choice and incumbent configuration require the operator; no claim that today's source is the deployed build.

## 3. Arch Tools — deterministic hash, gated on current middleware state

- Source: [application mount](https://github.com/Deesmo/Arch-AI-Tools/blob/ea53a34a4a2058ff890f4758d49a5590f642e395/api/src/index.ts), [SDK middleware](https://github.com/Deesmo/Arch-AI-Tools/blob/ea53a34a4a2058ff890f4758d49a5590f642e395/api/src/middleware/x402-sdk.ts), [tool handler](https://github.com/Deesmo/Arch-AI-Tools/blob/ea53a34a4a2058ff890f4758d49a5590f642e395/api/src/routes/tools/index.ts), existing [research #240](https://github.com/moelayyan90/XGuard/issues/240).
- Exact location: `POST /v1/tools/generate-hash`; router handler `/generate-hash` and its `toolMiddleware`/credit deduction. Do not change hash generation or tool credit cost.
- Source finding: the SDK module describes CDP with x402.org fallback, but current `api/src/index.ts` comments out the global `x402SdkMiddleware` mount and `initX402Sdk()`. Therefore the old issue's assumed SDK production path is **not confirmed**. Do not enable a global middleware based on that historical proposal.
- Candidate adapter: after maintainer confirmation of the active `toolMiddleware` payment path, add a route-local XGuard facilitator option before that path's verify/settle boundary; preserve existing API-key and credit modes.
- Canary stays 0% until the live payment path is confirmed; then 1% of paid Base generate-hash requests only. Existing platform pricing and `payTo` remain unchanged.
- Fallback/rollback: original route middleware and merchant-credit accounting; stable request cohorts; no resubmission after ambiguity.
- Additional success criterion: deterministic output equality, one merchant credit/accounting event, one settlement and one execution per business ID.
