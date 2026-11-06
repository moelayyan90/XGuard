import { createExtractionCheckout } from './extract-checkout.js';

const root = document.querySelector('[data-extract-checkout]');
if (root) {
  const status = document.querySelector('#extract-status'), result = document.querySelector('#extract-result'), pay = document.querySelector('#extract-pay'), recover = document.querySelector('#extract-recover'), resend = document.querySelector('#extract-resend');
  const storageKey = 'xguard-extract-pending-v1';
  const checkout = createExtractionCheckout({ recipient: root.dataset.recipient, cap: root.dataset.cap,
    load: () => { try { return JSON.parse(localStorage.getItem(storageKey)); } catch { return null; } },
    save: value => { if (value) localStorage.setItem(storageKey, JSON.stringify(value)); else localStorage.removeItem(storageKey); },
  });
  function controls() {
    const p = checkout.pending(); pay.disabled = p?.state !== 'quoted'; recover.hidden = !p; resend.hidden = p?.state !== 'prepared';
    document.querySelector('#extract-quote').disabled = p?.state === 'prepared';
  }
  async function run(action) {
    for (const button of root.querySelectorAll('button')) button.disabled = true;
    status.textContent = 'Working…';
    try { const value = await action(); if (value?.ok) { result.textContent = JSON.stringify(value, null, 2); status.textContent = 'Delivered. Your result and payment receipt are below.'; document.querySelector('#extract-download').hidden = false; }
    } catch (error) { status.textContent = String(error.message || error); if (error.response) result.textContent = JSON.stringify(error.response, null, 2); }
    finally { for (const button of root.querySelectorAll('button')) button.disabled = false; controls(); }
  }
  document.querySelector('#extract-form').addEventListener('submit', event => { event.preventDefault(); run(async () => {
    const urls = document.querySelector('#extract-urls').value.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const offer = await checkout.quote(urls);
    status.textContent = `${(Number(offer.accepts[0].amount) / 1e6).toFixed(3)} USDC on Base for this complete request. Review your URLs, then authorize in your wallet.`;
  }); });
  const saved = checkout.pending();
  if (saved?.body) { try { document.querySelector('#extract-urls').value = JSON.parse(saved.body).urls.join('\n'); } catch {} }
  document.querySelector('#extract-urls').addEventListener('input', () => { pay.disabled = true; status.textContent = 'Sources changed. Get a new exact price before authorizing.'; });
  pay.addEventListener('click', () => run(async () => { if (!window.ethereum) throw new Error('Open this page in a browser with an EVM wallet. You can also use the documented x402 API.'); return checkout.authorize(window.ethereum); }));
  recover.addEventListener('click', () => run(() => checkout.recover()));
  resend.addEventListener('click', () => run(() => checkout.sendPrepared()));
  document.querySelector('#extract-download').addEventListener('click', () => { const a = document.createElement('a'), url = URL.createObjectURL(new Blob([result.textContent], { type: 'application/json' })); a.href = url; a.download = 'xguard-extraction.json'; a.click(); URL.revokeObjectURL(url); });
  if (checkout.pending()?.state === 'prepared') status.textContent = 'An authorization is saved in this browser. Recover it or resend the same authorization. No new payment signature is needed.';
  controls();
}
