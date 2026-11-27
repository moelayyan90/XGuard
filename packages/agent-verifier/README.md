# XGuard Open Verifier

This package checks signed x402 offers and merchant receipts for a local agent. Operators choose trusted issuers and budgets. The read-only MCP tools and the local spending journal have separate interfaces. Node.js 24 supplies the cryptography and SQLite. The package makes no network requests and includes no wallet.

## Try it

Run these commands from the repository root.

```sh
npm run verifier:demo
npm run verifier:test
```

The demo generates a sample merchant key in memory. It verifies an offer, records and consumes a local approval, rejects a second use, and verifies a sample receipt. To inspect individual inputs, create a private temporary directory and write the three sample JSON documents there. Generate them together so that the keys and artifacts match. Sample offers expire after five minutes.

```sh
sample_dir="$(mktemp -d)"
node packages/agent-verifier/cli.mjs example | node --input-type=module -e '
  import { writeFileSync } from "node:fs";
  import { join } from "node:path";
  let raw = "";
  for await (const part of process.stdin) raw += part;
  for (const [name, data] of Object.entries(JSON.parse(raw)))
    writeFileSync(join(process.argv[1], name + ".json"), JSON.stringify(data, null, 2), {mode: 0o600});
' "$sample_dir"
verifier=packages/agent-verifier/cli.mjs
node "$verifier" review "$sample_dir/policy.json" "$sample_dir/offerInput.json"
node "$verifier" receipt "$sample_dir/policy.json" "$sample_dir/receiptInput.json"
```

## Run with goose or another MCP host

The recipe starts a stdio extension from the repository root. The operator selects the policy before the session starts. The stdio connection exposes exactly `review_offer` and `verify_receipt`. Enter signed artifacts and request context as tool arguments. A client using a hosted model may transmit those arguments to its provider. Use a local model for private material.

```sh
export XGUARD_VERIFIER_POLICY="$sample_dir/policy.json"
goose recipe validate "$PWD/packages/agent-verifier/goose.yaml"
goose run --recipe "$PWD/packages/agent-verifier/goose.yaml"
```

Other MCP clients can start `node /absolute/path/to/cli.mjs mcp /absolute/path/to/policy.json`. Run `npm ci --prefix apps/relay` and `node --test apps/relay/test/open-agent-verifier.test.mjs` for the official MCP SDK client test.

With the goose executable installed, run `node packages/agent-verifier/goose-smoke.mjs` from the repository root to reproduce a real extension call using a deterministic loopback model fixture. This exercises the goose CLI, recipe, MCP transport and verifier without a model account.

## Set issuer trust and budgets

The policy file contains `version: 1`, one EVM network in CAIP-2 form, a token contract address, and `maxPerCallAtomic` and `maxPer24hAtomic` as positive decimal strings. Use the token's smallest units. Each resource entry pins an exact HTTPS URL, a payment recipient address, and an ES256 public JWK with its DID key identifier. Obtain the key from a source you independently trust for that merchant. Change pins explicitly on key rotation.

The supported profile is x402 v2, one exact EVM payment option, one compact ES256 JWS offer with an expiry, and a standard offer-receipt extension. A signed receipt must include a transaction. The expected payer, transaction, and earliest acceptable issue time come from the host's independent records. Receipt verification establishes what the pinned merchant attested. Transaction finality, the amount transferred and delivered response bytes require separate evidence. The [x402 extension specification](https://github.com/x402-foundation/x402/blob/main/specs/extensions/extension-offer-and-receipt.md) defines the signed fields.

## Put explicit approval before a signer

Let the operator inspect the request method, exact URL, body, price, recipient and expiry. Only the operator runs `approve` after consent. Immediately before any signature, the trusted host runs `consume` with the same operation ID, the exact input and the same persistent journal. The signer must use those verified fields, the same request bytes and the same operation ID. Give the agent only the inspection tools. Enforce filesystem and process isolation for agents that also have shell access.

```sh
node "$verifier" approve "$sample_dir/policy.json" "$sample_dir/offerInput.json" "$sample_dir/spending.sqlite" order-0001
node "$verifier" consume "$sample_dir/policy.json" "$sample_dir/offerInput.json" "$sample_dir/spending.sqlite" order-0001
```

A changed request, signed offer or payment option invalidates the approval. Consumption charges the local 24-hour allowance immediately and is permanent for that operation ID, including after a crash or a failed external payment. Reconcile the original operation with the merchant before a human authorizes any new attempt. A reviewed offer alone grants no spending permission.

Use an operator-owned private directory on a local disk, a trusted clock and one persistent journal per budget. SQLite serializes simultaneous writers. The journal stores hashes, token/network, amounts, operation IDs and consumption times. Keep policy, journal and signer outside the agent's write permissions. Replacing the database or using separate machines with independent copies creates separate spending limits.

The [Apache-2.0 license](../../LICENSE) permits independent reuse. The demo works without an XGuard account, network access or a funded wallet.
