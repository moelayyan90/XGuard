import { createExecutionClient } from "../execution.js";
const client = createExecutionClient({ capability: process.env.XGUARD_CAPABILITY });
const operation = "github.repository.read";
const input = { owner: "moelayyan90", repo: "XGuard" };
await client.preflight({ operation, input });
const result = await client.execute({ operation, input, idempotencyKey: "read-xguard-repository-001" });
const evidence = await client.verify({ proof: result.proof, resultSha256: result.receipt.result_sha256 });
console.log(JSON.stringify({ result: result.result, execution_id: result.request_id, proof_valid: evidence.valid }, null, 2));
