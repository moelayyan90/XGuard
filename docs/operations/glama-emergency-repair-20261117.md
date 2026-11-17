# Glama ownership repair — 2026-11-17

## Diagnosis

- Production at inspection: commit `aaebc283813d7bccf18c18efd545bf3b542e48ba`, Worker `cebcd744-c885-4ad6-aaa9-8b5709390253`.
- `GET https://xguardgate.com/.well-known/glama.json` returned HTTP 410 with the retired-service HTML page.
- `apps/relay/src/live/worker.ts` retires unhandled `/.well-known/*` routes. Production switched from the canonical entry chain to `src/live-entry.js` in `88aad38f` on 2026-10-04. The earlier Glama handler remains in `src/entry.js` and publishes a legacy maintainer email, but the active entry does not call it.
- No claim token was found in the complete fetched Git history, current files, Worker variable/secret names, or the authorized Glama-related mailbox search. After the owner completed account creation, the signed-in Glama claim panel supplied the real account-bound token and the exact endpoint proof URL `https://xguardgate.com/mcp/.well-known/glama.json`.
- Glama's live `io.github.moelayyan90/xguard` listing uses `https://xguardgate.com/mcp`; its observed health was Healthy, 100% over the previous 24 hours. The other listing is `io.github.moelayyan90/xguard-control-plane`.
- At inspection the official Registry latest was 6.0.0, while the repository and production `/server.json` were 6.1.0. Both use the same canonical MCP endpoint. Registry publication needs separate verification before claiming the metadata is synchronized.

## Limited correction

The active entry handles the public ownership proof before product routing,
authentication and the retirement fallback. Both canonical origins support
`/.well-known/glama.json` and `/mcp/.well-known/glama.json`, with no redirects.
GET and HEAD return 200 only with a configured token matching Glama's official
format; otherwise they return explicit, uncached 503 JSON. No storage, quota
ledger, upstream requests, paid tools or settlement changes are involved.

The actual claim is stored in `.well-known/glama.json` and bundled with the
Worker. Its value is intentionally public in the proof, but does not appear
in test evidence or error logs. No synthetic test token is a production fallback.

## Deployment and verification

1. Copy the account-bound claim from the signed-in Glama panel into `.well-known/glama.json` using the connector schema. This was completed for the owner's account; no new authentication credentials are stored.
2. Keep the same token published. No GitHub token, Google token, email, or session cookie belongs in this file.
3. Run the existing CI and deploy workflow. The new bundled-runtime preflight requires the owner token before **any** production mutation. Missing/invalid configuration stops deployment.
4. The Worker serves the bundled proof on both full and gradual releases. The production gate checks HTTP 200, JSON schema, exact equality with the account-bound proof, public access and release tag using only 4 GETs.
5. Choose Glama's official HTTP/endpoint verification or GitHub identity method. Record Glama's confirmation separately: HTTP success is not proof that Glama accepted ownership.
6. Verify MCP, A2A, x402 and settlement with the existing no-payment smoke tests. Never initiate a real payment to test this repair.

## Rollback

No Durable Object bindings, schemas, migrations or storage contracts change.
The deployment workflow retains the immediately preceding Worker version and
compatible-code rollback. Reverting this patch alone preserves all unrelated
current development; do not roll back to an old project-wide release.

## Official references

- https://glama.ai/mcp/faq
- https://glama.ai/mcp/schemas/connector.json
- https://glama.ai/mcp/connectors/io.github.moelayyan90/xguard
- https://glama.ai/mcp/connectors/io.github.moelayyan90/xguard-control-plane
