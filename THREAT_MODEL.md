# Threat model

## Assets

Payment authorizations, settlement uniqueness, merchant prepaid liabilities, earned XGuard revenue, treasury cash/stablecoins, payout state, API/provider credentials, audit evidence, and service availability.

## Adversaries

Malicious callers, replaying clients, competing requests, compromised merchants, malicious/compromised facilitators, forged provider webhooks, dependency attackers, internal configuration mistakes, infrastructure outages, and an attacker with partial database access.

| Threat                                    | Consequence                          | Primary controls                                                                       | Residual risk / response                                        |
| ----------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Same authorization replay                 | duplicate submission/billing         | immutable authorization key, unique constraints, one Durable Object owner              | chain/provider ambiguity still needs reconciliation             |
| Same Payment Identifier, new terms        | cross-request confusion              | fingerprint binding and conflict                                                       | TTL semantics are not permanent; auth key remains permanent     |
| Amount/recipient/asset/network alteration | unauthorized transfer                | accepted-requirements equality plus mechanism field validation                         | pure facilitator API cannot independently bind HTTP method/body |
| 10–1,000 concurrent duplicates            | race settlement                      | serialized RPC or `BEGIN IMMEDIATE`, CAS start                                         | multi-region Node mainnet is not approved                       |
| Facilitator timeout after submit          | blind second settlement              | persisted `OUTBOUND_STARTED`, `AMBIGUOUS`, no failover                                 | manual/automated evidence query required                        |
| Malicious facilitator response            | false finality                       | network/amount/transaction checks, bounds, quarantine, typed independent-finality gate | production chain adapter absent; mainnet is hard-disabled       |
| SSRF through checker                      | internal network access              | public DNS validation, DNS pinning, HTTPS/443, no redirects                            | DNS/provider behavior remains monitored                         |
| Oversized/malformed JSON                  | memory/CPU abuse or parser confusion | byte/depth/key limits, duplicate/prototype rejection                                   | platform rate limiting/WAF still required                       |
| SQL/command injection                     | truth-store or host compromise       | prepared SQL, no request-derived shell                                                 | operational scripts accept resolved paths only                  |
| Forged/replayed webhook                   | false credit/payout                  | provider signature + notification-id uniqueness required before connector activation   | connector is not active                                         |
| Decimal error                             | incorrect fee or reserve             | bigint billable ledger, exact parsers, DB checks                                       | provider decimal conversion needs integration tests             |
| Treasury/liability confusion              | merchant money paid to owner         | distinct liability/revenue accounts and distributable formula                          | external bank/provider balance reconciliation required          |
| Payout timeout                            | duplicate owner transfer             | atomic gross reservation, provider idempotency, typed final evidence, no resubmit      | connector inactive; human/provider evidence may be needed       |
| Dependency compromise                     | code/secret theft                    | lockfile, audit, CodeQL, Dependabot, tests, provenance-ready packages                  | maintainers still assess upgrades                               |
| Log injection/data leakage                | secret exposure                      | JSON logs, controlled fields, no raw body                                              | infrastructure log access must be restricted                    |

## Security invariants

1. A payment can produce at most one XGuard usage event.
2. Billing requires a known successful final settlement and mainnet status.
3. Ambiguity suspends retry and billing.
4. Testnet fee is always zero, even if configuration says otherwise.
5. Owner payout cannot use customer liabilities, unpaid operating liabilities, pending payouts, or required reserve.
6. Unknown or inconsistent financial state suspends payout.
7. No private financial destination appears in source, frontend, logs, metrics, or public documentation.

## Deliberate limitations

Drop-in facilitator requests do not carry the original HTTP method/body as a trusted signed field. XGuard binds all official payment and resource fields it receives; a resource-server middleware integration is required for application-specific operation/body binding. Exactly-once execution across independent networks is not promised.
