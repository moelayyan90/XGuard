import { readJSON } from './io.mjs';
import { safeReason, serve } from './mcp.mjs';
import { loadPolicy } from './verify.mjs';

try {
  const path = process.argv[2] || process.env.XGUARD_VERIFIER_POLICY;
  if (!path) throw new Error('local_policy_required');
  await serve(loadPolicy(await readJSON(path)));
} catch (error) {
  console.error(safeReason(error));
  process.exitCode = 1;
}
