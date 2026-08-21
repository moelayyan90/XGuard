# XGuard Global Commerce

XGuard Global Commerce is a demand-first, back-to-back procurement engine.

## Operating contract

1. Start with a verifiable, active buyer requirement.
2. Match only exact product identities or exact normalized part numbers.
3. Source upstream inventory globally without speculative inventory ownership.
4. Calculate full landed cost before quoting: product, freight, customs, tax, payment fees, insurance, other costs, and reserve.
5. Reject opportunities below the configured minimum profit or margin.
6. Reject restricted goods, unsafe jurisdictions, unverified stock, weak buyer evidence, and uncertain product identity.
7. Require buyer funding, funded escrow, advance payment, or another explicitly verified payment-before-purchase arrangement before supplier purchase authorization.
8. Never claim XGuard owns stock that remains with an upstream supplier.
9. Outreach is targeted only to a public business contact tied to a specific active requirement; duplicate contact is suppressed and a daily cap is enforced.
10. Supplier purchasing remains blocked until the opportunity is funded and all execution preconditions are satisfied.

## Mainnet endpoints

- `GET /v1/commerce/status` — public operating status and aggregate counts.
- `GET /v1/commerce/opportunities` — admin-ranked opportunities.
- `POST /v1/commerce/ingest` — admin normalized demand/supplier ingestion.
- `POST /v1/commerce/evaluate` — admin deterministic landed-cost and risk evaluation.
- `POST /v1/commerce/feeds` — admin registration of normalized HTTPS JSON feeds.
- `POST /v1/commerce/run` — admin immediate feed refresh, matching, ranking and eligible outreach.
- `POST /v1/commerce/opportunities/:id/outreach` — admin targeted official XGuard outreach.

Mainnet cron refreshes active feeds, rebuilds opportunity ranking, and contacts only opportunities that pass every READY gate.
