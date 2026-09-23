# Strict governance and forecast-based operation selection

XGuard — Governed API Gateway combines scoped execution and paid seller APIs.
This change makes governance mandatory for external scoped execution and adds a complete
Python client in `sdk/xguard_governance.py`. It does not establish live customer
revenue, market arbitrage opportunities, or deployment to any agent's environment.

## Security boundary

The operator owns provisioning, the environment and the economic forecasts.
The agent receives only an expiring XGuard capability and a pinned public ProofRail
verification key. Provider API keys and wallet signing keys are never returned to
the agent, including in encrypted form. Encryption inside an agent process would
not prevent that process from decrypting or misusing a released key.

`XGuardAuthorizationGateway` is a Singleton in Python and per Durable Object storage
handle on the server. The actual authority is durable transactional state, scoped
credentials, cryptographic request binding and deployment egress controls. The
Singleton alone cannot stop arbitrary Python, subprocesses, alternate SDKs or a
privileged host administrator from opening a different socket.

Provision capabilities by including the required `governance` policy below in the
existing operator-only `POST /v1/egress/capabilities`. The policy cannot be modified
by the agent. All paths using that capability, including `/v1/egress/fetch`,
`/v1/secretless/call`, `/v1/execute`, MCP and A2A secretless calls, converge on the
same durable admission gate. Omitting a ticket cannot fall back to legacy mode.
New grants without this policy are refused. Persisted legacy grants without it
are latched and refused before reservation, billing, decryption or provider access.
There is no agent flag or environment switch to opt external execution out.
The server-created internal demo reaches only a fixed read-only fixture, without
external network access or payment; it is not assigned invented revenue forecasts.
Do not mount unrelated provider keys or wallet signers into the agent.

This is an authorization-contract change. Before deployment, reconcile uncertain
legacy operations, retrieve their stored receipts via read-only recovery, revoke
old grants, and provision fresh grants with reviewed forecasts. Update REST, MCP,
A2A and SDK callers to obtain a ticket before external execution. There is no
automatic policy upgrade, fabricated forecast or agent-accessible halt reset.

The release is version **6.0.0**. Durable state compatibility is raised to **3**:
automatic rollback to builds that ignore governance latches and exposure records
is forbidden. Preserve the records and use a compatible forward recovery fix.

Trusted gateway infrastructure accesses DNS, storage, billing and signing services
to implement the policy. It is not recursively passed through its own client gate.
Local client journal I/O is bookkeeping, not an external vector search. A vector DB
query must be an explicitly scoped remote HTTPS request. Generic provider egress is
supported; no specialist trading/risk adapter is advertised.

## Exact economics

All amounts are integer USD millionths serialized as decimal strings. The currency
is a forecast unit, not an assertion that one USD always equals one USDC. An operator
must include conversions, fees and any currency risk in the inputs.

```text
expected gross = floor(revenue if success × success probability / 10000)
expected failure loss = ceil(failure loss × (10000 − probability) / 10000)
operating cost = API + compute + payment + slippage + safety buffer
net expected value = expected gross − operating cost − expected failure loss
admit only when net expected value > 0 AND net expected value > minimum net
reserved exposure = operating cost + full stated failure loss
```

The safety margin is strictly exceeded; equality is rejected. Forecasts bind to
the SHA-256 of the exact request, expire within one hour of provisioning, and
are rechecked before authorization, reservation and dispatch. Expected revenue
cannot be supplied or overridden by the agent's execution request. Actual revenue
and actual profit remain `null` in this estimate. Signed forecasts prove who
authorized the estimate; they do not validate its business assumptions.

A durable UTC-day ledger is shared by all governed capabilities issued under the
same operator billing identity. Issuing a new capability does not reset that ledger.
Reservations use the full stated exposure and are not released after ambiguous
attempts or failed execution. The configured forecast exposure is not a measured
vendor invoice or a guarantee that a third party honors a predicted cost. Keep
provider-side hard quotas and per-operation limits consistent with this budget.
Rotating an operator billing identity creates a different accounting scope.

The engine ranks configured candidates by signed expected net contribution. It
does not solve a global allocation problem, maximize profit with certainty, or
measure millisecond opportunities. Polling is bounded to at least 250 ms and must
respect source limits. Discovery requests consume resources too: in this strict
contract they also require an explicit request-bound positive-value forecast.
If there is no defensible forecast for a scan, it is refused; do not fabricate
revenue for monitoring. Authorized control-plane operations and read-only recovery
do not represent revenue-generating work.

## Provisioning example

The following numbers are illustrative operator assumptions, not market data.
Compute the request digest locally before provisioning (see Python below), or
use the `request_digest` returned by `POST /v1/providers/plan` for a supported
provider operation. Recompute it if the request URL, method, headers or body changes.
Set `valid_until` to an actual future ISO timestamp, no more than one hour away.

```json
{
  "version": 1,
  "currency": "USD",
  "minimum_net_usd_micros": "100",
  "daily_cost_limit_usd_micros": "1000000",
  "forecasts": [{
    "request_digest": "<exact 64-character SHA-256>",
    "revenue_if_success_usd_micros": "10000",
    "success_probability_bps": 9000,
    "api_cost_usd_micros": "500",
    "compute_cost_usd_micros": "100",
    "payment_cost_usd_micros": "100",
    "slippage_cost_usd_micros": "100",
    "safety_buffer_cost_usd_micros": "100",
    "failure_loss_usd_micros": "100",
    "valid_until": "<future ISO timestamp>"
  }]
}
```

This example yields expected gross 9000, costs 900, expected failure loss 10,
net expected value 8090 and reserved exposure 1000, all in USD millionths.
The existing capability call count, expiration, credential scope and Usage Credit
limits apply as well. No automatic renewal or policy relaxation is performed.
For 24-hour operation, an operator-controlled provisioning service must supply
fresh grants and forecasts; restarting a halted agent is not renewal.

## Protocol and state

| Route | Behavior |
| --- | --- |
| `POST /v1/egress/authorize` | Raw scoped request, capability and stable idempotency key → signed 30-second ticket; no provider execution or budget reservation. |
| `POST /v1/secretless/authorize` | Supported operation ID/input envelope → the same raw request-bound ticket. |
| `POST /v1/egress/fetch` | Exact request plus `governance_authorization` → signature check, atomic admission, shared daily exposure reservation, billing, server-side credential injection, execution and proof. |
| `POST /v1/egress/recover` | Exact request and original key → stored response only; never reserves, bills or executes. |
| `POST /v1/egress/halt` | Capability-authenticated permanent stop for that workload. |
| `POST /v1/egress/governance-status` | Capability-authenticated state inspection. |

Tickets bind capability, request digest, idempotency-key hash, issuer, audience,
issue/expiry times and economics. A ticket is usable only for its one logical
operation. Concurrent or repeated use cannot dispatch again. Completed exact
replay is a read; an uncertain in-flight reservation is never reclaimed automatically.
Only one provider operation per governed capability can be in flight.

Invalid signatures, missing authorization, scope violations and ambiguous
execution latch `HALTED`. Routine negative/expired forecasts return 412 before
execution. Authentication precedes latching, so an unauthenticated stranger cannot
stop a workload merely by guessing its ID. A stop applies to the affected capability,
not unrelated customers. Client transport failures persist a local halt before
attempting to deliver a remote halt. If the gateway is unreachable, delivery of the
remote halt cannot be guaranteed. Already submitted remote actions can finish;
neither process cancellation nor a timeout rolls them back. Reconcile uncertain
orders through provider-side read-only evidence. Do not generate a fresh key to retry.

The client commits a private SQLite journal before dispatch. A process restart with
a submitted but unresolved job remains halted. It verifies signatures and exact
result bytes with the operator-pinned public key, not a key taken from the same
untrusted response. Read-only recovery does not clear a halt. Server recovery still
requires a valid, unrevoked capability; preserve receipts before expiry. There is
no agent-accessible reset endpoint. Operator revocation and explicit reprovisioning
follow reconciliation. Do not erase journals to make an unknown operation run again.

## Python integration

Install the SDK dependency with `python -m pip install -r sdk/requirements-governance.txt`.
The SDK requires Python 3.11 or later. Provision and pin the public JWK using the
operator's trusted deployment channel; key rotation is an operator action.

```python
import json
from pathlib import Path
from sdk.xguard_governance import Operation, XGuardAuthorizationGateway, request_digest

job = Operation("https://api.example.com/v1/result", "business-order-0001",
                method="POST", body_json={"task": "explicit approved task"})
print(request_digest(job.request()))  # Pure local setup; not an authorization.

# Files are workload configuration: an XGuard capability and PUBLIC proof key.
# Never mount an upstream provider secret, billing key or wallet private key.
gateway = XGuardAuthorizationGateway(
    capability=Path("/run/xguard/capability").read_text().strip(),
    pinned_jwk=json.loads(Path("/run/xguard/proof-public.json").read_text()),
    journal="/var/lib/xguard/agent.sqlite",
)
result = gateway.execute(job)
print(result.status, result.evidence["execution_id"])
```

`DailyYieldEngine.run(scan_factory, planner, max_cycles=None)` can run continuously
with explicit owner configuration. The callbacks compute local requests and parse
untrusted observations; all external reads and writes must be `Operation`s routed
through the gateway. Default `max_cycles=1` avoids accidentally starting an endless
paid loop. Business keys must persist across planning cycles and retries.

## Deployment enforcement

Use `integrations/governed-agent/network-policy.yaml` as a deny-by-default starting
point, in a cluster with a CNI that enforces NetworkPolicy. It permits the agent to
reach only an operator-owned enforcement proxy. That proxy must verify workload
identity and restrict methods, paths and upstream destination to the gateway.
Do not give the agent a general CONNECT tunnel, direct DNS egress, host networking,
privileged containers, other credentials, or permissions to modify network policy.
Provision the proxy service address and TLS trust through trusted configuration.
The template does not deploy a proxy, certify cluster isolation, or make existing
external agents use XGuard. Existing Cloudflare DNS-rebinding limitations are
unchanged; see the execution/security documentation.

Before a production rollout, prove that direct HTTPS, vector DB sockets, UDP,
alternate DNS, subprocess sockets and legacy credential paths fail from the actual
agent namespace, while the approved gateway path works. This environment has not
been supplied for the current source change, so enforcement deployment is unverified.

## Sources and checks

The enforcement boundary follows the separation of policy decisions and policy
enforcement in [NIST SP 800-207](https://csrc.nist.gov/pubs/sp/800/207/final).
[Kubernetes NetworkPolicy](https://kubernetes.io/docs/concepts/services-networking/network-policies/)
documents default-deny egress and CNI requirements. Neither source makes a
Singleton an unbypassable network control or guarantees a financial return.

Run the governance, execution, SDK and identity checks in Relay CI. Fixtures use
actual signatures and isolated providers; their success is not a production
payment, a trading backtest, an audited cost model or an observed profit.
