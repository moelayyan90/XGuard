/* global chrome, document, MutationObserver, HTMLInputElement, location, setTimeout, clearTimeout */
(() => {
  const PAYMENT_WORDS =
    /\b(pay(?:ment)?|pay now|buy now|place order|complete order|complete purchase|confirm payment|checkout|subscribe|purchase)\b|ادفع|الدفع|إتمام الطلب|تأكيد الطلب|الشراء/i;
  const CHECKOUT_PATH = /(checkout|payment|pay|order\/confirm|subscribe|purchase|billing|cart)/i;
  const TOTAL_WORDS = /\b(grand total|order total|amount due|total due|total)\b|الإجمالي|المجموع|المبلغ المستحق/i;
  const SUCCESS_WORDS = /\b(payment complete|payment successful|order confirmed|thank you for your order|purchase complete)\b|تمت الدفعة|تم الدفع|تم تأكيد الطلب|شكراً لطلبك/i;
  const PROVIDERS = [
    ["stripe", /stripe/i],
    ["paypal", /paypal/i],
    ["coinbase", /coinbase/i],
    ["shopify", /shopify|shop-pay/i],
    ["adyen", /adyen/i],
    ["checkout", /checkout\.com/i],
  ];
  const CURRENCIES = [
    ["د.أ", "JOD"],
    ["JOD", "JOD"],
    ["ر.س", "SAR"],
    ["SAR", "SAR"],
    ["د.إ", "AED"],
    ["AED", "AED"],
    ["ج.م", "EGP"],
    ["EGP", "EGP"],
    ["USDC", "USDC"],
    ["USD", "USD"],
    ["EUR", "EUR"],
    ["GBP", "GBP"],
    ["€", "EUR"],
    ["£", "GBP"],
    ["$", "USD"],
  ];

  let host = null;
  let shadow = null;
  let panelOpen = false;
  let state = { cart: [], session: null };
  let signal = null;
  let scanTimer = null;
  let lastUrl = location.href;

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 300);
  }

  async function scan() {
    if (document.visibilityState !== "visible") return;
    signal = detectPaymentIntent();
    try {
      state = await getPayAllState();
    } catch {
      state = { cart: [], session: null };
    }
    render();
  }

  function detectPaymentIntent() {
    let confidence = CHECKOUT_PATH.test(location.pathname) ? 2 : 0;
    const candidates = Array.from(
      document.querySelectorAll("button, [role='button'], input[type='submit'], a[href]"),
    ).slice(0, 300);
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
    const actions = forms.map((form) => form.action).filter(Boolean).join(" ");
    const scripts = Array.from(document.scripts)
      .slice(0, 150)
      .map((script) => script.src)
      .filter(Boolean)
      .join(" ");
    const provider = detectProvider(`${location.href} ${actions} ${scripts}`);
    if (provider !== "generic_http") confidence += 1;

    const structured = detectStructuredAmount();
    const total = structured || detectVisibleTotal(trigger);
    if (total?.amount) confidence += 1;

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
      amount: total?.amount || null,
      currency: total?.currency || "USD",
      payee: location.hostname,
      merchantOrigin: location.origin,
      title: document.title || location.hostname,
      url: location.href,
    };
  }

  function detectStructuredAmount() {
    const priceNodes = Array.from(
      document.querySelectorAll(
        'meta[itemprop="price"], meta[property="product:price:amount"], meta[name="price"], [itemprop="price"]',
      ),
    ).slice(0, 20);
    const currencyNodes = Array.from(
      document.querySelectorAll(
        'meta[itemprop="priceCurrency"], meta[property="product:price:currency"], meta[name="currency"]',
      ),
    ).slice(0, 20);

    for (const node of priceNodes) {
      const raw = node.getAttribute("content") || node.getAttribute("value") || node.textContent || "";
      const amount = normalizeAmount(raw);
      if (!amount) continue;
      const currency =
        currencyNodes
          .map((item) => item.getAttribute("content") || item.getAttribute("value") || item.textContent || "")
          .map((item) => item.trim().toUpperCase())
          .find(Boolean) || "USD";
      return { amount, currency };
    }
    return null;
  }

  function detectVisibleTotal(trigger) {
    const nodes = new Set();
    const selectors = [
      '[data-testid*="total" i]',
      '[data-test*="total" i]',
      '[aria-label*="total" i]',
      '[class*="grand-total" i]',
      '[class*="order-total" i]',
      '[id*="grand-total" i]',
      '[id*="order-total" i]',
    ];
    for (const selector of selectors) {
      try {
        document.querySelectorAll(selector).forEach((node) => nodes.add(node));
      } catch {
        // Ignore selector support differences.
      }
    }
    document.querySelectorAll("strong, b, dt, dd, th, td, [role='row']").forEach((node) => {
      const text = node.textContent?.trim() || "";
      if (text.length < 220 && TOTAL_WORDS.test(text)) nodes.add(node);
    });
    if (trigger) {
      const context = trigger.closest("form, section, main, aside");
      if (context) nodes.add(context);
    }

    const candidates = [];
    for (const node of Array.from(nodes).slice(0, 180)) {
      const text = (node.textContent || "").trim().slice(0, 1200);
      const parsed = parseAmountText(text);
      if (!parsed) continue;
      candidates.push({
        ...parsed,
        score: TOTAL_WORDS.test(text) ? 5 : 1,
      });
    }
    candidates.sort((a, b) => b.score - a.score || Number(b.amount) - Number(a.amount));
    return candidates[0] || null;
  }

  function parseAmountText(text) {
    const normalized = normalizeDigits(text).replace(/\u00a0/g, " ");
    const currency = detectCurrency(normalized);
    const numbers = Array.from(normalized.matchAll(/[0-9][0-9.,]{0,18}/g))
      .map((match) => normalizeAmount(match[0]))
      .filter(Boolean)
      .map(Number)
      .filter((value) => value > 0 && value < 1_000_000_000);
    if (!numbers.length) return null;
    return { amount: numbers[numbers.length - 1].toFixed(2), currency };
  }

  function visibleLabel(element) {
    if (element instanceof HTMLInputElement)
      return element.value || element.getAttribute("aria-label") || "";
    return `${element.textContent || ""} ${element.getAttribute("aria-label") || ""}`
      .trim()
      .slice(0, 180);
  }

  function detectProvider(haystack) {
    for (const [name, pattern] of PROVIDERS)
      if (pattern.test(haystack)) return name;
    return "generic_http";
  }

  function detectCurrency(text) {
    const value = String(text || "").toUpperCase();
    for (const [token, currency] of CURRENCIES)
      if (value.includes(token.toUpperCase())) return currency;
    return "USD";
  }

  function normalizeDigits(value) {
    return String(value)
      .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
      .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
  }

  function normalizeAmount(value) {
    let normalized = normalizeDigits(value)
      .replace(/\s/g, "")
      .replace(/[^0-9.,]/g, "");
    if (!normalized) return null;
    const comma = normalized.lastIndexOf(",");
    const dot = normalized.lastIndexOf(".");
    if (comma >= 0 && dot >= 0) {
      normalized =
        comma > dot
          ? normalized.replace(/\./g, "").replace(",", ".")
          : normalized.replace(/,/g, "");
    } else if (comma >= 0) {
      const decimals = normalized.length - comma - 1;
      normalized = decimals === 2 ? normalized.replace(",", ".") : normalized.replace(/,/g, "");
    }
    const amount = Number(normalized);
    return Number.isFinite(amount) && amount > 0 ? amount.toFixed(2) : null;
  }

  function shouldShow() {
    return Boolean(signal || state.cart.length || state.session?.status === "ACTIVE");
  }

  function ensureHost() {
    if (host?.isConnected) return;
    host = document.createElement("div");
    host.id = "xguard-floating-pay-all";
    host.style.cssText = "all:initial;position:fixed;right:18px;bottom:18px;z-index:2147483647";
    shadow = host.attachShadow({ mode: "closed" });
    document.documentElement.appendChild(host);
  }

  function render() {
    if (!shouldShow()) {
      host?.remove();
      host = null;
      shadow = null;
      return;
    }
    ensureHost();
    const current = currentSessionItem();
    const totals = totalsByCurrency(state.cart);
    const currentAmount = signal?.amount || "";
    const currentCurrency = signal?.currency || "USD";

    const items = state.cart
      .map(
        (item) => `<div class="item"><div class="item-main"><b>${escapeHtml(item.title || item.merchant)}</b><span>${escapeHtml(item.merchant)}</span><button class="remove" data-remove="${escapeHtml(item.id)}">إزالة</button></div><strong>${escapeHtml(formatMoney(item.amount, item.currency))}</strong></div>`,
      )
      .join("");
    const totalRows = totals
      .map(
        ([currency, amount]) => `<div class="total"><span>${escapeHtml(currency)}</span><b>${escapeHtml(formatMoney(amount, currency))}</b></div>`,
      )
      .join("");

    shadow.innerHTML = `<style>
      *{box-sizing:border-box}.wrap{direction:rtl;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#122a31}.launcher{display:flex;align-items:center;gap:9px;border:0;border-radius:999px;padding:10px 14px;background:#112c33;color:#fff;box-shadow:0 15px 44px #001b2345;cursor:pointer;font-weight:800}.mark{width:30px;height:30px;border-radius:10px;background:linear-gradient(135deg,#25c8bf,#0d8f8a);display:grid;place-items:center;font-weight:950}.count{min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:#d9fbf7;color:#08756f;display:grid;place-items:center;font-size:10px}.panel{position:absolute;right:0;bottom:56px;width:min(390px,calc(100vw - 28px));max-height:min(680px,calc(100vh - 94px));overflow:auto;background:#fff;border:1px solid #dbe8e6;border-radius:22px;box-shadow:0 26px 72px #001b2345}.head{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:10px;padding:15px 16px;background:#fff;border-bottom:1px solid #edf2f1}.head h3{margin:0;font-size:15px}.head p{margin:3px 0 0;color:#748b90;font-size:10px}.close{margin-right:auto;border:0;border-radius:9px;width:30px;height:30px;background:#eef4f3;color:#4f696d;cursor:pointer}.body{padding:13px}.session{padding:12px;border-radius:14px;background:#112c33;color:#fff;margin-bottom:11px}.session b{font-size:11px}.session p{margin:4px 0 0;color:#bfd0d2;font-size:10px;line-height:1.5}.session-actions{display:grid;grid-template-columns:1fr 72px;gap:7px;margin-top:9px}.next{border:0;border-radius:10px;background:#28c7bd;color:#082e30;padding:9px;font-size:10px;font-weight:850;cursor:pointer}.stop{border:1px solid #4d6870;border-radius:10px;background:transparent;color:#d9e5e6;font-size:9px;font-weight:750;cursor:pointer}.current{padding:13px;border:1px solid #bce8e4;background:#f1fffd;border-radius:16px}.eyebrow{color:#0b8d87;font-size:9px;font-weight:900}.merchant{margin-top:5px;font-size:12px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.amount{margin-top:4px;font-size:23px;font-weight:900}.fields{display:grid;grid-template-columns:1fr 88px;gap:7px;margin-top:9px;direction:ltr}.fields input,.fields select{min-width:0;border:1px solid #cddfdd;border-radius:10px;background:#fff;padding:9px;font:700 11px inherit;color:#18353b}.primary,.secondary{width:100%;border-radius:11px;padding:10px 12px;font:800 11px inherit;cursor:pointer}.primary{border:0;background:#0d918c;color:#fff;margin-top:9px}.primary:disabled{opacity:.45;cursor:not-allowed}.secondary{border:1px solid #d2e0df;background:#fff;color:#345259;margin-top:7px}.section{display:flex;justify-content:space-between;align-items:center;margin:15px 2px 8px;font-size:11px;font-weight:900}.cart{display:grid;gap:7px}.item{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;padding:9px 10px;border:1px solid #e3edec;border-radius:12px}.item-main{min-width:0}.item-main b{display:block;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.item-main span{display:block;margin-top:2px;color:#82969a;font-size:8px;direction:ltr;text-align:right}.item strong{font-size:10px;white-space:nowrap}.remove{border:0;background:transparent;color:#a45959;padding:4px 0 0;font-size:8px;cursor:pointer}.totals{display:grid;gap:4px;margin-top:9px;padding:9px 10px;background:#f1f5f4;border-radius:11px}.total{display:flex;justify-content:space-between;font-size:10px}.empty{padding:16px;text-align:center;color:#7e9397;font-size:10px}.note{margin-top:8px;color:#87999c;font-size:8px;line-height:1.5}.decision{margin-top:8px;padding:9px;border-radius:11px;background:#f3f6f5;font-size:9px}.decision strong{display:block;font-size:11px}.error{margin-top:7px;color:#a33037;font-size:9px}
    </style><div class="wrap"><button class="launcher" id="launcher"><span class="mark">X</span><span>XGuard${state.cart.length ? ` · ${state.cart.length}` : ""}</span>${state.cart.length ? `<span class="count">${state.cart.length}</span>` : ""}</button>${panelOpen ? `<section class="panel"><header class="head"><span class="mark">X</span><div><h3>XGuard Pay All</h3><p>احجز دفعات من مواقع مختلفة وادفعها من جلسة واحدة</p></div><button class="close" id="close">×</button></header><div class="body">${current ? `<div class="session"><b>جلسة Pay All · ${state.session.index + 1} من ${state.session.itemIds.length}</b><p>أكمل الدفع المعتاد لدى ${escapeHtml(current.merchant)} ثم انتقل للدفعة التالية.</p><div class="session-actions"><button class="next" id="next">تم الدفع — التالي</button><button class="stop" id="stop">إيقاف</button></div></div>` : ""}${signal ? `<div class="current"><div class="eyebrow">الدفعة الحالية</div><div class="merchant">${escapeHtml(signal.title)}</div>${signal.amount ? `<div class="amount">${escapeHtml(formatMoney(signal.amount, signal.currency))}</div>` : `<div class="note">لم أقرأ المبلغ بثقة. أدخله يدويًا.</div>`}<div class="fields"><input id="amountInput" inputmode="decimal" placeholder="المبلغ" value="${escapeHtml(currentAmount)}"><select id="currencyInput">${["JOD","USD","EUR","GBP","SAR","AED","EGP","USDC"].map((currency)=>`<option value="${currency}" ${currency===currentCurrency?"selected":""}>${currency}</option>`).join("")}</select></div><button class="primary" id="add">احجز هذه الدفعة</button><button class="secondary" id="verify">تحقق من هذه الدفعة عبر XGuard</button><div id="decision"></div><div class="note">XGuard لا يقرأ أرقام البطاقات أو CVV أو كلمات المرور.</div></div>` : ""}<div class="section"><span>الدفعات المحجوزة</span><span>${state.cart.length}</span></div>${state.cart.length ? `<div class="cart">${items}</div><div class="totals">${totalRows}</div>` : `<div class="empty">احجز دفعتك الأولى من أي Checkout.</div>`}<button class="primary" id="payAll" ${state.cart.length ? "" : "disabled"}>ادفع الكل</button>${state.cart.length ? `<button class="secondary" id="clear">مسح السلة</button>` : ""}<div class="note">«ادفع الكل» في هذه النسخة يعطي موافقة XGuard واحدة ثم يقود الدفعات الأصلية بالترتيب. خصم مصرفي واحد حقيقي ثم توزيع الأموال يحتاج rail/issuer يدعم batch authorization.</div></div></section>` : ""}</div>`;

    shadow.getElementById("launcher")?.addEventListener("click", () => {
      panelOpen = !panelOpen;
      render();
    });
    shadow.getElementById("close")?.addEventListener("click", () => {
      panelOpen = false;
      render();
    });
    shadow.getElementById("add")?.addEventListener("click", addCurrent);
    shadow.getElementById("verify")?.addEventListener("click", verifyCurrent);
    shadow.getElementById("payAll")?.addEventListener("click", startPayAll);
    shadow.getElementById("clear")?.addEventListener("click", clearCart);
    shadow.getElementById("next")?.addEventListener("click", nextPayment);
    shadow.getElementById("stop")?.addEventListener("click", stopSession);
    shadow.querySelectorAll("[data-remove]").forEach((button) =>
      button.addEventListener("click", () => removeItem(button.dataset.remove)),
    );
  }

  async function addCurrent() {
    if (!signal) return;
    const amount = normalizeAmount(shadow.getElementById("amountInput")?.value || signal.amount || "");
    const currency = shadow.getElementById("currencyInput")?.value || signal.currency || "USD";
    if (!amount) return showInlineError("أدخل مبلغًا صحيحًا أولًا.");
    const response = await send({
      type: "XGUARD_PAY_ALL_ADD",
      payment: {
        title: signal.title,
        url: location.href,
        amount,
        currency,
        provider: signal.provider,
      },
    });
    state = { cart: response.cart, session: response.session };
    panelOpen = true;
    render();
  }

  async function removeItem(id) {
    const response = await send({ type: "XGUARD_PAY_ALL_REMOVE", id });
    state = { cart: response.cart, session: response.session };
    render();
  }

  async function clearCart() {
    const response = await send({ type: "XGUARD_PAY_ALL_CLEAR" });
    state = { cart: response.cart, session: response.session };
    render();
  }

  async function startPayAll() {
    const response = await send({ type: "XGUARD_PAY_ALL_START" });
    state = { cart: response.cart, session: response.session };
    if (response.nextUrl && response.nextUrl !== location.href) location.href = response.nextUrl;
    else render();
  }

  async function nextPayment() {
    const response = await send({ type: "XGUARD_PAY_ALL_NEXT", outcome: "PAID" });
    state = { cart: response.cart, session: response.session };
    if (response.done) {
      panelOpen = true;
      render();
      return;
    }
    if (response.nextUrl) location.href = response.nextUrl;
  }

  async function stopSession() {
    const response = await send({ type: "XGUARD_PAY_ALL_STOP" });
    state = { cart: response.cart, session: response.session };
    render();
  }

  async function verifyCurrent() {
    if (!signal) return;
    const button = shadow.getElementById("verify");
    const result = shadow.getElementById("decision");
    const amount = normalizeAmount(shadow.getElementById("amountInput")?.value || signal.amount || "");
    const currency = shadow.getElementById("currencyInput")?.value || signal.currency || "USD";
    if (!amount) return showInlineError("أدخل مبلغًا صحيحًا قبل التحقق.");
    button.disabled = true;
    button.textContent = "جاري التحقق…";
    try {
      const response = await send({
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
      const record = response.record;
      result.innerHTML = `<div class="decision"><strong>${escapeHtml(record.decision)}</strong>Risk ${Number(record.riskScore) || 0}/100 · Record ${escapeHtml(record.decisionId)}</div>`;
      button.textContent = "تم التحقق";
    } catch (error) {
      button.disabled = false;
      button.textContent = "تحقق من هذه الدفعة عبر XGuard";
      result.innerHTML = `<div class="error">${escapeHtml(error instanceof Error ? error.message : "XGuard غير متاح")}</div>`;
    }
  }

  function showInlineError(message) {
    const result = shadow?.getElementById("decision");
    if (result) result.innerHTML = `<div class="error">${escapeHtml(message)}</div>`;
  }

  function currentSessionItem() {
    if (!state.session || state.session.status !== "ACTIVE") return null;
    const id = state.session.itemIds?.[state.session.index];
    return state.cart.find((item) => item.id === id) || null;
  }

  function totalsByCurrency(cart) {
    const totals = new Map();
    for (const item of cart)
      totals.set(item.currency, (totals.get(item.currency) || 0) + Number(item.amount));
    return Array.from(totals.entries());
  }

  function formatMoney(amount, currency) {
    const value = Number(amount);
    if (!Number.isFinite(value)) return `${amount} ${currency}`;
    try {
      return new Intl.NumberFormat(document.documentElement.lang || "ar", {
        style: "currency",
        currency: /^[A-Z]{3}$/.test(currency) ? currency : "USD",
        maximumFractionDigits: 2,
      }).format(value);
    } catch {
      return `${value.toFixed(2)} ${currency}`;
    }
  }

  async function getPayAllState() {
    return send({ type: "XGUARD_PAY_ALL_GET" });
  }

  async function send(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || "XGuard extension request failed");
    return response;
  }

  function escapeHtml(value) {
    return String(value).replace(
      /[&<>"']/g,
      (character) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
          character
        ],
    );
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("visibilitychange", scheduleScan, { passive: true });
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === "local") scheduleScan();
  });
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      scheduleScan();
    }
  }, 900);
  scheduleScan();
})();
