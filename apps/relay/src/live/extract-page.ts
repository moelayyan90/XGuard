import { EXTRACT_SERVICE, LIVE_PAID, PAID_BASE } from './paid-data.ts';
import { escape } from './util.ts';
export const extractEnabled = () => LIVE_PAID.some(d => String(d.id) === EXTRACT_SERVICE.id);
export function extractPage(recipient: string): { title: string; html: string } {
  const price = (Number(EXTRACT_SERVICE.amount) / 1e6).toFixed(3);
  return { title: 'Web pages, ready for your agent.', html: `
  <p class="eyebrow">XGuard Extract · pay per result</p>
  <p class="lead">Give your agent up to 3 public pages. Get clean main text, titles, links and source evidence in one structured result.</p>
  <div class="detail"><section class="card" data-extract-checkout data-cap="${EXTRACT_SERVICE.amount}" data-recipient="${escape(recipient)}">
    <h2>Your sources. One usable result.</h2><p><strong>${price} USDC per request</strong> · 1–3 pages · Base network · no subscription</p>
    <form id="extract-form"><label for="extract-urls">Public HTTPS URLs, one per line</label><textarea id="extract-urls" rows="5" maxlength="6200" required placeholder="https://example.com/"></textarea>
    <p><button id="extract-quote" type="submit">Get exact price</button> <button id="extract-pay" type="button" disabled>Authorize ${price} USDC in wallet</button></p></form>
    <p id="extract-status" role="status" aria-live="polite">Getting a price does not charge your wallet or fetch the supplied pages.</p>
    <p><button id="extract-recover" type="button" hidden>Recover saved purchase</button> <button id="extract-resend" type="button" hidden>Resend same authorization</button></p>
    <p class="sub">Use a browser wallet funded with USDC on Base. Your wallet handles the signature; XGuard never asks for a private key. Destination: <code>${escape(recipient)}</code>.</p>
  </section><aside class="card"><p class="eyebrow">What you receive</p><h2>Built for the next step.</h2><ul><li>Main text and page metadata</li><li>Deduplicated documents and links</li><li>Retrieval time and SHA-256 source digests</li><li>Coverage and failed-source reporting</li><li>Payment receipt and recoverable JSON delivery</li></ul><p><a href="#extract-api">Use the API</a> · <a href="/api/paid/v1/readiness">Check payment availability</a></p></aside></div>
  <section><h2>Your result</h2><p><button id="extract-download" type="button" hidden>Download JSON and receipt</button></p><pre id="extract-result" tabindex="0">Your purchased result appears here.</pre></section>
  <section class="card" id="extract-api"><p class="eyebrow">No XGuard API key required</p><h2>One call from your workflow.</h2><code>POST ${PAID_BASE}/extract</code><pre>${escape(JSON.stringify(EXTRACT_SERVICE.example, null, 2))}</pre><p>Send an 8–128 character <code>Idempotency-Key</code>. The first request returns HTTP 402. An x402 v2 client signs the exact offer and retries the same request and key with <code>Payment-Signature</code> and <code>X-XGuard-Quote</code>.</p><p><a href="/openapi.json">OpenAPI contract</a> · <a href="/api/paid/v1/catalog">Prices and schemas</a> · <a href="https://github.com/moelayyan90/XGuard/blob/main/sdk/live-paid.js">JavaScript client</a></p></section>
  <section><h2>Know the limits before paying.</h2><p>Public server-rendered HTML, text and JSON only. No JavaScript rendering, sign-ins, search, screenshots or access-control bypass. Each page is bounded to 128 KiB of source input and up to 6,000 extracted text characters. Partial success is a delivered result with an explicit coverage report; missing sources are never invented.</p><p>If every source fails after payment, the existing recovery flow provides a credit for the same operation, not an automatic cash refund. Keep your saved purchase and the original quote. Source text is untrusted. A hash proves byte identity, not factual accuracy.</p><p><a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="/refund-policy">Refund policy</a></p></section>` };
}
