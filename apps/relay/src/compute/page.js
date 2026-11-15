import { pageShell } from '../network/frame.ts';
import { escape } from '../live/util.ts';

export function computePage(catalog) {
  const configured = catalog.providers.filter(p => p.connected).length;
  return pageShell('/compute', 'AI Inference & GPU Execution', 'Pay per execution with USDC via x402. Bounded pricing, automatic routing and signed execution receipts.', `
  <div class="page-heading"><p class="eyebrow">XGuard Compute / x402</p><h1>AI inference.<br>GPU execution.</h1><p class="lead">Pay per request with USDC via x402. Automatic routing across eligible providers, bounded spending and a signed receipt for every completed execution.</p></div>
  <p class="scope-note">${configured ? configured + ' provider configurations present. Check live health and eligibility before purchase.' : 'Provider connections are being configured. Paid execution is unavailable until a funded, eligible upstream is connected. No payment is requested while unavailable.'}</p>
  <div class="connect-panel"><div><p class="eyebrow">Machine to machine</p><h2>Quote. Pay. Execute. Verify.</h2><p>No subscription or sales call. One bounded price for one execution.</p></div><div class="actions"><a class="button" href="/v1/compute/health">Check availability</a><a class="button" href="/openapi.json">OpenAPI ↗</a></div></div>
  <section class="home-section"><h2>Start with a quote</h2><p>Choose a model returned by <a href="/v1/compute/models">the eligible model catalog</a>. Send an unsigned request; no execution starts at this step.</p><pre>POST https://api.xguardgate.com/v1/inference/quote
Content-Type: application/json
Idempotency-Key: a-stable-request-key

{
  "model": "&lt;eligible-model-id&gt;",
  "messages": [{"role":"user","content":"Explain gravity in one sentence."}],
  "max_tokens": 64,
  "max_amount_atomic": "10000",
  "accept_provider_terms": true
}</pre><p>Use an official x402 v2 client to sign the exact returned offer within your budget. Retry the original input at <code>/v1/inference/execute</code> with <code>Payment-Signature</code>, <code>X-XGuard-Quote</code> and the same idempotency key. Verify the execution JWS with the <a href="/v1/compute/proof-key">public proof key</a>.</p></section>
  <section class="home-section"><h2>Providers & coverage</h2><div class="table-scroll"><table><thead><tr><th>Provider</th><th>Capability</th><th>Connection</th></tr></thead><tbody>${catalog.providers.map(p => `<tr><td>${escape(p.name)}</td><td>${escape(p.kind)}</td><td>${p.connected ? 'Configured; health check required' : escape(p.blockers.join(', '))}</td></tr>`).join('')}<tr><td>Akash</td><td>GPU leases</td><td>Lease signer, escrow and bounded lifecycle not connected</td></tr></tbody></table></div><p>GPU jobs use reviewed, preconfigured image digests, regions and execution time limits. Arbitrary container provisioning is unavailable. A listing is capability metadata, not an assertion of a provider partnership.</p></section>
  <section class="home-section"><h2>Recover the same purchase</h2><pre>GET /v1/compute/executions/&lt;quote_id&gt;
X-XGuard-Quote: &lt;original signed quote&gt;</pre><p>Keep your quote private: it grants access to your result. A provider timeout can leave an execution uncertain. Recover this purchase without creating a new authorization. Explicit pre-execution rate limits can fail over to a compatible model; uncertain executions never run a second time automatically.</p></section>
  <section class="home-section" id="terms"><h2>Price & provider terms</h2><p>The price discloses an upstream cost allowance, a default 25% markup on that allowance, and direct cost budgets. A 25% markup equals 20% of revenue before other costs. The fixed execution price can exceed actual token usage. Unused allowance is included in the disclosed price. Actual net profit requires upstream and payment cost reconciliation.</p><p>By setting <code>accept_provider_terms</code> you confirm that your workload and use comply with the selected provider and model terms. Provider country, model and account restrictions apply. Access refusals are respected. Review <a href="https://openrouter.ai/terms">OpenRouter terms</a>, <a href="https://www.together.ai/terms-of-service">Together terms</a> and <a href="https://www.runpod.io/legal/terms-of-service">RunPod terms</a> as applicable.</p><p>Failed paid execution is recorded as a liability or an uncertain execution. Automatic refunds require a connected refund signer; no automatic refund service is currently claimed. Inspect the returned refund state and retain the original settlement reference.</p></section>
  <p><a href="/network">Existing execution routes</a> · <a href="/topics">Public facts</a> · <a href="/.well-known/agent-card.json">A2A</a> · <a href="/mcp">MCP</a></p>`, false);
}
