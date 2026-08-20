# XGuard — Smart Cross-Border Operations Employee

[![CI](https://github.com/moelayyan90/XGuard/actions/workflows/ci.yml/badge.svg)](https://github.com/moelayyan90/XGuard/actions/workflows/ci.yml)
[![CodeQL](https://github.com/moelayyan90/XGuard/actions/workflows/codeql.yml/badge.svg)](https://github.com/moelayyan90/XGuard/actions/workflows/codeql.yml)
[![Mainnet](https://github.com/moelayyan90/XGuard/actions/workflows/deploy-mainnet.yml/badge.svg)](https://github.com/moelayyan90/XGuard/actions/workflows/deploy-mainnet.yml)

**XGuard is an operations execution layer for companies dealing with government, customs, compliance, suppliers and cross-border workflows.**

The product goal is deliberately different from a traditional dashboard:

> **Give XGuard the objective. XGuard performs the repeatable operational work, tracks the deadline, chases missing inputs, prepares the case, hands it to an authorised execution route and returns the result or the exact exception that still needs a responsible person.**

XGuard starts with a focused EUDR operations workflow and expands only into government/customs workflows that are actually configured, validated and operationally supportable.

## Why XGuard exists

Cross-border operations often fail for ordinary reasons rather than exotic ones:

- a supplier never sent one required field;
- a deadline lived in somebody's mailbox;
- the same data was copied between several systems;
- a reference was not handed to the next party;
- an employee was overloaded and a follow-up was delayed;
- the company rebuilt the same evidence package repeatedly;
- a government/customs response was received but not converted into the next task.

Automation is useful precisely because repetitive work does not benefit from fatigue, mood or memory. XGuard therefore focuses on **consistent execution and visible exceptions**, not on pretending software replaces legal judgment.

## Product model

```text
SHIPMENT / PO / GOVERNMENT REQUEST / CUSTOMS REQUEST / COMPLIANCE TASK
        |
        v
configured country + authority + workflow
        |
        v
XGuard case
        |
        +--> reuse current authorised data
        +--> identify missing facts/evidence
        +--> request / remind / escalate
        +--> validate completeness
        +--> prepare forms/references/package
        +--> track deadline and state
        |
        v
READY or EXCEPTION
        |
        v
authorised execution / filing / handoff when supported
        |
        v
acknowledgement / status / reference
        |
        v
ERP / broker / customer / audit record
```

## The XGuard jobs

### Government Runner

Turns a supported government request into requirements, tasks, documents, deadlines and an operational execution path.

### Customs Coordinator

Maps shipment identifiers, required references and handoffs so customs-facing work does not live across disconnected email and spreadsheets.

### Compliance Desk

Builds repeatable case files, checks completeness, preserves evidence and escalates matters that require a legally responsible person.

### Supplier Chaser

Requests missing information, follows up, reminds and records supplier responses.

### Multilingual Relay

Normalises supported operational communications across languages while preserving source material and an audit trail.

### Deadline Engine

Keeps unresolved requests, due dates and exceptions visible until closure.

### Evidence Vault

Preserves input evidence, versions, hashes, handoffs, transformations and status history.

### ERP / API Worker

Accepts work through supported API/webhook/CSV/inbox paths and returns state, reference or exception to the system the customer already uses.

## First focused workflow: EUDR

XGuard's first production focus is EUDR operations:

- readiness assessment;
- supplier/reference Inbox;
- supplier follow-up;
- product/CN and origin mapping;
- evidence organisation;
- geodata preflight;
- case assembly;
- reference handoff;
- audit history;
- annual-review support.

EU Information System execution must only be enabled when the participant's authority/credentials and XGuard's current production integration have been validated. XGuard must never call a statement verified or submitted merely because an internal workflow completed.

See [EUDR Operations Engine](EUDR_OPERATIONS_ENGINE.md) and [EUDR Network](EUDR_NETWORK.md).

## Operating principle

> **90% is readiness. The final 10% is live execution.**

This is an XGuard product framework, not an official legal/statistical claim. Nine explicit readiness checks make up the pre-transaction 90%; the final 10% is reserved for the real movement/execution event.

## Launch pricing

| Service                                         |        XGuard launch price |
| ----------------------------------------------- | -------------------------: |
| Readiness + basic EUDR supplier/reference Inbox |                     **€0** |
| Completed EUDR operational case                 |              **€9 / case** |
| Recurring volume / embedded EUDR workflow       | **€4–€6 / completed case** |

No monthly seat subscription is required for these launch offers.

These are XGuard's own launch prices, not market averages. Government/customs workflows outside the published supported catalog are not charged as if they were automated. Third-party government, customs, data-provider, payment, translation or filing fees remain separate where applicable and must be disclosed before use.

## Commercial rule

XGuard should charge for **completed value-producing operational events**, not for promises.

A success-linked filing or execution fee is earned only when the defined event actually succeeds. Preparation or exception-handling services may have separate disclosed event prices where they perform real work.

## Product boundaries

XGuard must not:

- claim to be a government, customs authority, competent authority, law firm or certification body;
- claim a jurisdiction/workflow is supported until it is actually configured and validated;
- claim legal compliance merely because an internal readiness score is high;
- fabricate legal conclusions, official approvals, regulatory statuses or filing references;
- silently submit on behalf of a company without the required authority/credentials;
- hide mandatory third-party fees inside an apparently free or fixed-price operation;
- describe XGuard itself as legally mandatory.

The legally responsible company remains responsible for decisions and declarations that law assigns to it.

## Reusable infrastructure retained from earlier XGuard versions

The repository still contains earlier child-safety, x402/payment, MCP, A2A, webhook, routing, billing and security components. They remain available as reusable infrastructure or legacy surfaces while the primary product identity moves to cross-border operations.

Existing machine/developer surfaces include:

```text
/.well-known/xguard/payment-layer.json
/.well-known/xguard/protocols.json
/.well-known/mcp/server.json
/.well-known/agent-card.json
/openapi.json
/mcp
```

## Development and verification

```bash
npm run check
npm run verify:release
npm --workspace @xguard/worker run build:mainnet
```

## Contact

**info@xguardgate.com**

XGuard is an independent project and is not an official product of the European Commission, TRACES, any customs or government authority, Coinbase, Cloudflare, Base, Circle, x402 Foundation, Google, Microsoft or any other third party unless an explicit agreement states otherwise.

Apache-2.0. See [CONTRIBUTING.md](CONTRIBUTING.md).
