# XGuard Agent Financial Authority — sandbox

This release reserves policy budgets, not bank balances. It cannot activate real spending via an environment toggle. No service fee is collected. An independent paying customer has not been established for this product.

## Run the executable evidence

```sh
npm ci --prefix apps/relay --no-audit --no-fund
npm run --prefix apps/relay authority:test
node sdk/financial-authority/verify-receipt.mjs docs/evidence/financial-authority/sample-sandbox-receipt.json docs/evidence/financial-authority/sample-sandbox-public-key.json
node scripts/authority-growth-model.mjs
```

The test creates only ephemeral authentication keys and a mock executor. It moves no real funds and creates no production wallet. The second verifier uses Node's crypto implementation and works offline without XGuard's server or installed npm dependencies. Pin the expected public key separately; a key included with an untrusted receipt is not a trust anchor. The checked-in key and receipt are **sandbox evidence**, never the production ProofRail key.

## Connect

Canonical API: `https://api.xguardgate.com/v1/authority`. Inspect `/catalog` first. Enroll with an existing funded unrestricted XGuard license, using `organizationForLicense(license)` for the deterministic organization ID, or obtain operator enrollment. The license is checked only at the pinned existing `/v1/balance` endpoint. No credit is consumed; no other product purchase is counted as authority revenue. Keep the license out of agent prompts, URLs and logs.

A runnable example needs Node 24 and your existing license in the local `XGUARD_LICENSE` environment variable:

```sh
node sdk/financial-authority/sandbox-demo.mjs
```

The example saves an **authentication** key in `~/.xguard/authority/sandbox-owner.json` with mode 0600, issues two levels of delegation, uses `adapter: "sandbox-simulation"`, verifies a receipt and revokes the demo grant. It creates no wallet or payment signature. Repeat enrollment with the same owner and identical policies safely returns the original tenant admission token; a changed owner or policy conflicts. A lost owner key is not recovered from the license.

Enrollment returns `organization_token`. Supply it as `X-XGuard-Organization-Token` or SDK `organizationToken`, in addition to every signed command. Invalid tokens fail before object lookup. Operator-secret rotation invalidates these sandbox tokens. The operator credential must never be given to a customer or agent.

```js
import { createIdentity, signCommand, sendCommand, organizationForLicense } from './client.mjs';

const owner = await createIdentity();
const agent = await createIdentity();
const org = await organizationForLicense(process.env.XGUARD_LICENSE);
const policy = {
  currency: 'USDC', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  network: 'eip155:8453', per_operation: '5000000', per_period: '20000000',
  lifetime: '100000000', period_seconds: 86400,
  payees: ['OWNER_APPROVED_EXACT_MERCHANT_ADDRESS'],
};
const enrollment = await signCommand(owner, org, 'enroll', {
  owner_key: owner.publicKey, policies: [policy], accept_price_atomic: '50000',
});
// Submit with sendCommand(enrollment, { enrollmentToken: process.env.XGUARD_LICENSE }).
// Merely signing this sandbox policy never signs a USDC payment.

const grant = await signCommand(owner, org, 'grant', {
  grant_id: 'agent_grant_001', parent: null, agent_key: agent.publicKey,
  policy, not_before: Date.now() - 1000,
  expires_at: Date.now() + 3600000, depth_remaining: 2,
});
// After enrollment, sendCommand(grant) stores the owner-signed delegation.
// A child grant is signed by the parent's key, identifies parent:'agent_grant_001',
// and narrows payees, limits, validity and depth_remaining.
```

Authentication keys belong in the customer's key store. `createIdentity` is a local example; exporting or persisting a private key is the caller's responsibility. Each key may have one delegation per organization in this release. An owner may `disable-agent` using `{ agent_id }`. `rotate-owner` requires the current owner signature and a new-key possession proof over `{ protocol: "xguard-afa-owner-rotation/1", org_id, previous_owner_id, new_owner_id, nonce }`; include `new_owner_key` and `new_owner_proof` in the payload. Historical root signatures remain verifiable. Up to 20 distinct owner rotations are retained. There is no renewal endpoint; issue a new key/grant.

`authorize` payload:

```json
{
  "operation_id": "customer_operation_001",
  "grant_id": "agent_grant_001",
  "currency": "USDC",
  "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "network": "eip155:8453",
  "payee": "OWNER_APPROVED_EXACT_MERCHANT_ADDRESS",
  "principal_atomic": "1000000",
  "provider_fee_cap_atomic": "0",
  "max_service_fee_atomic": "50000",
  "adapter": "operator_approved_adapter",
  "task_digest": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "expires_at": 0
}
```

Replace `task_digest` with the base64url SHA-256 of the exact customer task and `expires_at` with an integer millisecond time no more than 5 minutes ahead, within every grant's expiry. The all-A value above is illustrative. Sign the whole command with the leaf key. Exact asset, network and payee strings are case-sensitive; no conversion or recipient substitution occurs.

Preserve `operation_id` and the original payload across retries. A different payload with the same ID returns 409. A repeated nonce with changed content returns 409. An identical signed command returns current state. Expired envelopes can be replaced by a newly signed **status** command for the original operation. The client never signs or automatically buys a new payment after an uncertain outcome.

Commands `execute`, `reconcile`, `cancel` and `status` take `{ "operation_id": "..." }`. `revoke` takes `{ "grant_id": "..." }`, or null for the whole organization, and must be owner-signed. `audit` is owner-only and takes `{ "from": 1, "limit": 100 }`; `metrics` takes `{}`. All requests use the versioned envelope generated by `signCommand`.

MCP tools: `xguard.authority.catalog`, `xguard.authority.command` (argument `{envelope, organization_token}`), and `xguard.authority.verify_receipt` (argument `{receipt}`). A2A: `SendMessage` with one data part `{ "action": "xguard.authority", "envelope": {...}, "organization_token": "..." }`. Neither transport is allowed to smuggle the operator enrollment token. The HTTP API remains the canonical authorization contract.

## Executor contract and boundaries

The existing `AUTHORITY` binding is reused with distinct names `afa-v1:sandbox:<org_id>` and an `afa_records` table. Legacy mandates, ProofRail, C2SP and paid journals retain their bindings and formats. No new Cloudflare namespace or migration is created.

The built-in `sandbox-simulation` path has no external effects. No financial executor is configured in production by this release. A local/private executor needs `AFA_EXECUTOR`, `AFA_EXECUTOR_PUBLIC_JWK` (public P-256 key) and `AFA_EXECUTOR_ADAPTER` (exact allowed adapter name). The binding, never a caller-supplied URL, receives `POST /execute` once after durable dispatch, or **read-only** `POST /status` for reconciliation. Its idempotency key is `<organization_id>:<operation_id>`. It must independently enforce this key, verify the task digest against its actual task and preserve the exact recipient, principal and fee cap. XGuard cannot guarantee exactly-once side effects in a noncompliant external system.

The executor signs sorted JSON using ES256, with raw 64-byte P1363 signature, and returns `{payload,signature}`. Required payload fields: `protocol:'xguard-afa-settlement/1'`, `mode`, `organization_id`, `operation_id`, `intent_digest`, `currency`, `asset`, `network`, `payee`, `principal_atomic`, `provider_fee_atomic`, `observed_at` (milliseconds), `status` (`confirmed`, `unknown`, `failed_no_effect`), and a nonempty `transaction` for confirmed outcomes. Failed-no-effect requires zero provider fees. A pinned signature is **executor evidence**, not independent blockchain finality. Sandbox transaction references do not represent onchain transactions.

`RESERVED → DISPATCHING → CONFIRMED | FAILED | UNKNOWN`. Cancellation is allowed only before dispatch. Reconciliation cannot call `/execute`. All budgets remain held for unknown effects, including a process dying after dispatch was committed but before the network call. Recovery may require manual investigation if the executor cannot prove no effect. Expired reservations require an authenticated cancel; no unsafe automatic release is performed.

The gate cannot control an agent's separate wallet, API key or alternate network path. No custody, KYC, universal agent identity, AP2 conformance, certified security audit, working production settlement or commercial revenue is claimed.

## Before any live activation

Live mode is rejected in code. Aggregate service-fee budgets, one-invoice-only collection, read-only chain evidence and owner-key lifecycle are implemented and tested in isolation. A separate reviewed release must validate real settlement, legal classification, financial-state versioning, account-wide admission, actual costs and customer consent before enabling monetary collection. It needs independent security review and legal classification. Any new production financial key, gas funding, real transaction or paid infrastructure requires the owner's separate explicit approval. Sandbox tests alone satisfy none of these gates.

## Service-fee budgets and checkout

Service fees are a separate Base USDC budget. To opt into invoice simulation, add `service_fee_budget` to enrollment and a narrowing `service_fee_limit` to each policy and grant. Each is `{ per_operation: "50000", per_period: "500000", lifetime: "5000000", period_seconds: 86400 }`. The global institution fee budget applies across all merchant currencies. These are policy limits, not a deposit or proof of a balance.

Only a completed operation with a verified signed delivery can open one invoice. `checkout` takes `{ operation_id }` and returns a private invoice capability plus the exact x402 endpoint/idempotency key. Keep the capability out of URLs and logs. Production returns `authority_fee_activation_required` before accepting a payment. The fee path is available only in isolated simulations in this release; the production version binding prevents an environment toggle from activating it.

The closed commerce test uses the official x402 client, real ephemeral EIP-712 signatures and mocked facilitator/RPC responses. Identical payment replay returns the previous result; a different wallet is fenced before settlement. A lost settlement response cannot create a new debit. A definitely rejected no-effect attempt permits a newly signed replacement, capped at 3 attempts. Storage failure after settlement uses the original execution credit. Simulations and self-payments are excluded from revenue.

## Settlement evidence

`sandbox-simulation` has no external effects. All other executors remain private and operator pinned. For an optional Base USDC read-only evidence check, sign `payment_context: { payer, nonce }` as part of the intent, use the exact USDC asset/merchant and a zero provider-fee cap. Confirmation then also requires matching AuthorizationUsed and Transfer events, a canonical block and at least 2 confirmations through a configured RPC. This is evidence at observation time, not irreversible finality or independent proof of fiat settlement. Missing evidence remains UNKNOWN and keeps reservations. The checker never submits a transaction.
