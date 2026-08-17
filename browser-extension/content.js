/* global chrome, document, MutationObserver, HTMLInputElement, location, sessionStorage, setTimeout, clearTimeout */
(() => {
  const OFFER_COOLDOWN_MS = 5 * 60 * 1000;
  const PAYMENT_WORDS =
    /\b(pay(?:ment)?|pay now|buy now|place order|complete order|complete purchase|confirm payment|checkout|subscribe|purchase)\b/i;
  const CHECKOUT_PATH =
    /(checkout|payment|pay|order\/confirm|subscribe|purchase)/i;
  const AMOUNT =
    /(?:\$|USD\s?|EUR\s?|GBP\s?|JOD\s?|AED\s?|SAR\s?)([0-9]{1,9}(?:[,.][0-9]{1,2})?)/i;
  const PROVIDERS = [
    ["stripe", /stripe/i],
    ["paypal", /paypal/i],
    ["coinbase", /coinbase/i],
    ["shopify", /shopify|shop-pay/i],
    ["adyen", /adyen/i],
    ["checkout", /checkout\.com/i],
  ];

  let activeHost = null;
  let scanTimer = null;

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 350);
  }

  function scan() {
    if (activeHost || document.visibilityState !== "visible") return;
    const signal = detectPaymentIntent();
    if (!signal || signal.confidence < 3) return;
    const fingerprint = `${location.origin}|${location.pathname}|${signal.amount ?? "unknown"}`;
    const last = Number(sessionStorage.getItem(`xguard:${fingerprint}`) || "0");
    if (Date.now() - last < OFFER_COOLDOWN_MS) return;
    sessionStorage.setItem(`xguard:${fingerprint}`, String(Date.now()));
    showOffer(signal, fingerprint);
  }

  function detectPaymentIntent() {
    let confidence = CHECKOUT_PATH.test(location.pathname) ? 2 : 0;
    const candidates = Array.from(
      document.querySelectorAll(
        "button, [role='button'], input[type='submit'], a[href]",
      ),
    ).slice(0, 250);
    let trigger = null;
    for (const element of candidates) {
      const label = visibleLabel(element);
      if (PAYMENT_WORDS.test(label)) {
        confidence += 2;
        trigger = element;
        break;
      }
    }

    const forms = Array.from(document.forms).slice(0, 50);
    const actions = forms
      .map((form) => form.action)
      .filter(Boolean)
      .join(" ");
    const scripts = Array.from(document.scripts)
      .slice(0, 150)
      .map((script) => script.src)
      .filter(Boolean)
      .join(" ");
    const provider = detectProvider(`${location.href} ${actions} ${scripts}`);
    if (provider !== "generic_http") confidence += 1;

    const textSource =
      trigger?.closest("form, section, main, aside")?.textContent ||
      document.body?.innerText ||
      "";
    const observed = AMOUNT.exec(textSource.slice(0, 12000));
    const amount = observed ? normalizeAmount(observed[1]) : null;
    if (amount) confidence += 1;

    if (confidence < 3) return null;
    return {
      confidence,
      rail:
        provider === "coinbase"
          ? "coinbase"
          : provider === "paypal"
            ? "paypal"
            : provider === "stripe"
              ? "stripe"
              : "card",
      provider,
      amount,
      currency: detectCurrency(observed?.[0] || textSource),
      payee: location.hostname,
      merchantOrigin: location.origin,
    };
  }

  function visibleLabel(element) {
    if (element instanceof HTMLInputElement)
      return element.value || element.getAttribute("aria-label") || "";
    return `${element.textContent || ""} ${element.getAttribute("aria-label") || ""}`
      .trim()
      .slice(0, 160);
  }

  function detectProvider(haystack) {
    for (const [name, pattern] of PROVIDERS)
      if (pattern.test(haystack)) return name;
    return "generic_http";
  }

  function detectCurrency(text) {
    if (/JOD/i.test(text)) return "JOD";
    if (/AED/i.test(text)) return "AED";
    if (/SAR/i.test(text)) return "SAR";
    if (/EUR|€/i.test(text)) return "EUR";
    if (/GBP|£/i.test(text)) return "GBP";
    return "USD";
  }

  function normalizeAmount(value) {
    const normalized = value.replace(/,/g, "");
    return /^\d+(?:\.\d{1,2})?$/.test(normalized) && Number(normalized) > 0
      ? normalized
      : null;
  }

  function showOffer(signal, fingerprint) {
    const host = document.createElement("div");
    host.style.cssText =
      "all:initial;position:fixed;right:20px;bottom:20px;z-index:2147483647";
    const shadow = host.attachShadow({ mode: "closed" });
    const amountKnown = Boolean(signal.amount);
    shadow.innerHTML = `<style>
      *{box-sizing:border-box}.card{width:min(360px,calc(100vw - 32px));font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f5f2ea;color:#151619;border:1px solid #d7d3c9;border-radius:14px;box-shadow:0 22px 70px #0005;padding:18px;line-height:1.35}.top{display:flex;gap:11px;align-items:center}.mark{width:34px;height:34px;border-radius:9px;background:#ff2731;color:#fff;display:grid;place-items:center;font-weight:900}.title{font-size:15px;font-weight:760}.sub{font-size:11px;color:#77736d;margin-top:2px}.body{font-size:13px;color:#4e4b46;margin:14px 0}.facts{background:#ebe7de;border-radius:9px;padding:10px;margin:10px 0 13px}.fact{display:flex;justify-content:space-between;gap:12px;font-size:12px;padding:4px 0}.fact span{color:#76716a}.fact b{max-width:205px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.amount-input{display:flex;gap:7px;margin:10px 0}.amount-input input,.amount-input select{border:1px solid #cac5ba;background:#fff;border-radius:7px;padding:9px;font:600 13px inherit;color:#151619}.amount-input input{min-width:0;flex:1}.amount-input select{width:78px}.use{border:0;width:100%;border-radius:8px;padding:11px;background:#151619;color:#fff;font-weight:760;cursor:pointer}.skip{display:block;width:100%;border:0;background:transparent;padding:10px;color:#66615b;cursor:pointer;font-weight:650}.foot{text-align:center;color:#8b877f;font:600 10px ui-monospace,monospace;margin-top:8px}.result{margin-top:12px;padding:11px;border-radius:9px;background:#fff;border:1px solid #d8d3c9}.decision{font-weight:850;letter-spacing:.05em}.checks{font-size:11px;color:#5b5751;margin-top:6px}.error{font-size:12px;color:#9c1c23;margin-top:9px}
    </style><div class="card"><div class="top"><div class="mark">XG</div><div><div class="title">Check this payment with XGuard?</div><div class="sub">Optional · before payment</div></div></div><div class="body">Verify the declared amount, destination, route and transaction evidence before you continue.</div><div class="facts"><div class="fact"><span>Destination</span><b>${escapeHtml(signal.payee)}</b></div><div class="fact"><span>Provider</span><b>${escapeHtml(signal.provider)}</b></div>${amountKnown ? `<div class="fact"><span>Observed amount</span><b>${escapeHtml(signal.amount)} ${escapeHtml(signal.currency)}</b></div>` : ""}</div>${amountKnown ? "" : `<div class="amount-input"><input inputmode="decimal" aria-label="Payment amount" placeholder="Payment amount"><select aria-label="Currency"><option>USD</option><option>EUR</option><option>GBP</option><option>JOD</option><option>AED</option><option>SAR</option></select></div>`}<button class="use">Use XGuard</button><button class="skip">Continue without XGuard</button><div class="foot">SHOW = $0 · SKIP = $0 · FEE ONLY AFTER RESULT</div><div class="message"></div></div>`;
    document.documentElement.appendChild(host);
    activeHost = host;

    shadow.querySelector(".skip").addEventListener("click", () => close());
    shadow.querySelector(".use").addEventListener("click", async () => {
      const button = shadow.querySelector(".use");
      const message = shadow.querySelector(".message");
      let amount = signal.amount;
      let currency = signal.currency;
      if (!amount) {
        const input = shadow.querySelector("input");
        const select = shadow.querySelector("select");
        amount = normalizeAmount(input.value.trim());
        currency = select.value;
        if (!amount) {
          message.innerHTML = `<div class="error">Enter the payment amount before requesting the XGuard result. No fee has been charged.</div>`;
          return;
        }
      }
      button.disabled = true;
      button.textContent = "Checking…";
      try {
        const response = await chrome.runtime.sendMessage({
          type: "XGUARD_PAYMENT_DECISION",
          intent: {
            rail: signal.rail,
            provider: signal.provider,
            amount,
            currency,
            payee: signal.payee,
            merchantOrigin: signal.merchantOrigin,
            metadata: { detectionConfidence: signal.confidence },
          },
        });
        if (!response?.ok)
          throw new Error(response?.error || "XGuard service unavailable");
        const record = response.record;
        const nonPass = Array.isArray(record.checks)
          ? record.checks.filter((item) => item.status !== "PASS")
          : [];
        message.innerHTML = `<div class="result"><div class="decision">${escapeHtml(record.decision)}</div><div class="checks">Risk score ${Number(record.riskScore) || 0}/100 · ${nonPass.length ? nonPass.map((item) => escapeHtml(item.reasonCode)).join(" · ") : "No structural warning found"}</div><div class="checks">Record ${escapeHtml(record.decisionId)}</div></div>`;
        button.textContent = "XGuard result delivered";
      } catch (error) {
        button.disabled = false;
        button.textContent = "Use XGuard";
        message.innerHTML = `<div class="error">${escapeHtml(error instanceof Error ? error.message : "XGuard service unavailable")} No completed result means no XGuard fee should be earned.</div>`;
      }
    });

    function close() {
      host.remove();
      activeHost = null;
      sessionStorage.setItem(`xguard:${fingerprint}`, String(Date.now()));
    }
  }

  function escapeHtml(value) {
    return String(value).replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[character],
    );
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  document.addEventListener("visibilitychange", scheduleScan, {
    passive: true,
  });
  scheduleScan();
})();
