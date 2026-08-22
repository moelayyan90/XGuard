(() => {
  if (window.top !== window.self) return;
  if (document.documentElement.dataset.xguardPayAllMounted === "1") return;
  document.documentElement.dataset.xguardPayAllMounted = "1";

  const HOST_ID = "xguard-pay-all-root";
  const PAYMENT_URL_HINT = /\b(checkout|payment|pay|billing|cart|order|purchase|confirm|invoice)\b/i;
  const PAYMENT_TEXT_HINT = /\b(pay now|place order|complete purchase|checkout|amount due|order total|grand total|payment)\b|ادفع|الدفع|إتمام الطلب|تأكيد الطلب|الإجمالي|المبلغ المستحق/i;
  const TOTAL_HINT = /\b(grand total|order total|amount due|total due|total)\b|الإجمالي|المجموع|المبلغ المستحق/i;

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

  let detected = detectPayment();
  let state = { cart: [], session: null };
  let open = false;
  let lastUrl = location.href;

  function normalizeDigits(value) {
    return String(value)
      .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
      .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
  }

  function inferCurrency(text) {
    const value = String(text || "").toUpperCase();
    for (const [token, currency] of CURRENCIES) {
      if (value.includes(token.toUpperCase())) return currency;
    }
    return null;
  }

  function parseNumericAmount(raw) {
    let value = normalizeDigits(raw).replace(/\s/g, "").replace(/[^0-9.,]/g, "");
    if (!value) return null;

    const comma = value.lastIndexOf(",");
    const dot = value.lastIndexOf(".");
    if (comma >= 0 && dot >= 0) {
      if (comma > dot) value = value.replace(/\./g, "").replace(",", ".");
      else value = value.replace(/,/g, "");
    } else if (comma >= 0) {
      const decimals = value.length - comma - 1;
      value = decimals === 2 ? value.replace(",", ".") : value.replace(/,/g, "");
    }

    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0 ? amount : null;
  }

  function amountFromText(text) {
    const normalized = normalizeDigits(String(text || "")).replace(/\u00a0/g, " ");
    const currency = inferCurrency(normalized);
    const matches = [...normalized.matchAll(/(?:^|\s|[:(])([0-9][0-9.,]{0,18})(?=\s|$|[)])/g)];
    const values = matches
      .map((match) => parseNumericAmount(match[1]))
      .filter((amount) => amount !== null && amount < 1000000000);
    if (!values.length) return null;
    return { amount: values[values.length - 1], currency };
  }

  function structuredPayment() {
    const priceNodes = [
      ...document.querySelectorAll(
        'meta[itemprop="price"], meta[property="product:price:amount"], meta[name="price"], [itemprop="price"]',
      ),
    ];
    const currencyNodes = [
      ...document.querySelectorAll(
        'meta[itemprop="priceCurrency"], meta[property="product:price:currency"], meta[name="currency"]',
      ),
    ];

    for (const node of priceNodes) {
      const raw = node.getAttribute("content") || node.getAttribute("value") || node.textContent;
      const amount = parseNumericAmount(raw);
      if (!amount) continue;
      const currency =
        currencyNodes
          .map((item) => item.getAttribute("content") || item.getAttribute("value") || item.textContent)
          .map((item) => String(item || "").trim().toUpperCase())
          .find(Boolean) || inferCurrency(document.body?.innerText || "") || "USD";
      return { amount, currency, confidence: "structured" };
    }
    return null;
  }

  function visibleTotalCandidates() {
    const selectors = [
      '[data-testid*="total" i]',
      '[data-test*="total" i]',
      '[aria-label*="total" i]',
      '[class*="grand-total" i]',
      '[class*="order-total" i]',
      '[id*="grand-total" i]',
      '[id*="order-total" i]',
      '[class~="total" i]',
      '[id~="total" i]',
    ];

    const nodes = new Set();
    for (const selector of selectors) {
      try {
        document.querySelectorAll(selector).forEach((node) => nodes.add(node));
      } catch {
        // Ignore selectors unsupported by older Chromium builds.
      }
    }

    document.querySelectorAll("strong, b, dt, dd, th, td, [role='row']").forEach((node) => {
      const text = node.textContent?.trim();
      if (text && TOTAL_HINT.test(text) && text.length < 180) nodes.add(node);
    });

    const candidates = [];
    for (const node of [...nodes].slice(0, 150)) {
      const text = node.textContent?.trim();
      if (!text || text.length > 240) continue;
      const parsed = amountFromText(text);
      if (!parsed?.amount) continue;
      candidates.push({
        amount: parsed.amount,
        currency: parsed.currency || inferCurrency(text) || "USD",
        score: TOTAL_HINT.test(text) ? 5 : 1,
        text,
      });
    }
    return candidates.sort((a, b) => b.score - a.score || b.amount - a.amount);
  }

  function looksLikePaymentPage() {
    if (PAYMENT_URL_HINT.test(location.pathname) || PAYMENT_URL_HINT.test(location.search)) return true;
    const buttons = [...document.querySelectorAll("button, [role='button'], input[type='submit'], a")].slice(0, 300);
    return buttons.some((node) => {
      const text = node.textContent || node.getAttribute("value") || node.getAttribute("aria-label") || "";
      return PAYMENT_TEXT_HINT.test(text);
    });
  }

  function detectPayment() {
    const structured = structuredPayment();
    const totals = visibleTotalCandidates();
    const best = totals[0] || structured;
    const likely = looksLikePaymentPage() || Boolean(best);
    return {
      likely,
      amount: best?.amount ?? null,
      currency: best?.currency ?? "USD",
      confidence: best?.confidence || (totals.length ? "page-total" : "none"),
      merchant: location.hostname.replace(/^www\./, ""),
      title: document.title || location.hostname,
      url: location.href,
    };
  }

  function money(amount, currency) {
    const value = Number(amount);
    if (!Number.isFinite(value)) return `— ${currency || ""}`;
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

  function totalsByCurrency(cart) {
    const totals = new Map();
    for (const item of cart) {
      totals.set(item.currency, (totals.get(item.currency) || 0) + Number(item.amount));
    }
    return [...totals.entries()];
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function currentSessionItem() {
    if (!state.session || state.session.status !== "ACTIVE") return null;
    const id = state.session.itemIds?.[state.session.index];
    return state.cart.find((item) => item.id === id) || null;
  }

  async function send(type, payload = {}) {
    const response = await chrome.runtime.sendMessage({ type, ...payload });
    if (!response?.ok) throw new Error(response?.error || "XGuard extension error");
    return response.result;
  }

  async function refresh() {
    const result = await send("XG_GET_STATE");
    state = result;
    render();
  }

  function ensureHost() {
    let host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement("div");
      host.id = HOST_ID;
      host.style.all = "initial";
      host.style.position = "fixed";
      host.style.zIndex = "2147483647";
      document.documentElement.appendChild(host);
      host.attachShadow({ mode: "open" });
    }
    return host;
  }

  function styles() {
    return `
      :host { all: initial; }
      *, *::before, *::after { box-sizing: border-box; }
      .xg-wrap { direction: rtl; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color:#10242d; }
      .xg-launcher { position: fixed; right: 18px; bottom: 18px; display:flex; align-items:center; gap:9px; border:0; border-radius:999px; padding:10px 13px 10px 16px; background:#10272e; color:white; box-shadow:0 14px 38px rgba(2,30,37,.24); cursor:pointer; font:700 13px/1.2 inherit; }
      .xg-launcher:hover { transform:translateY(-1px); }
      .xg-logo { width:30px; height:30px; display:grid; place-items:center; border-radius:10px; background:linear-gradient(135deg,#26c9c2,#0d8a91); color:white; font-weight:900; font-size:17px; }
      .xg-badge { min-width:20px; height:20px; padding:0 6px; display:grid; place-items:center; border-radius:999px; background:#ddfbf8; color:#08756f; font-size:11px; }
      .xg-panel { position:fixed; right:18px; bottom:72px; width:min(388px,calc(100vw - 28px)); max-height:min(680px,calc(100vh - 100px)); overflow:auto; border:1px solid #dce9e8; border-radius:24px; background:rgba(255,255,255,.985); box-shadow:0 24px 70px rgba(2,30,37,.24); }
      .xg-head { padding:17px 18px 14px; display:flex; gap:12px; align-items:center; border-bottom:1px solid #edf3f2; position:sticky; top:0; background:rgba(255,255,255,.98); z-index:2; }
      .xg-head h3 { margin:0; font-size:16px; }
      .xg-head p { margin:3px 0 0; color:#668087; font-size:11px; }
      .xg-close { margin-right:auto; width:30px; height:30px; border:0; border-radius:9px; background:#f0f5f4; cursor:pointer; color:#456066; }
      .xg-body { padding:14px; }
      .xg-current { padding:14px; border:1px solid #bfe9e5; background:#f1fffd; border-radius:17px; }
      .xg-eyebrow { color:#0a8c86; font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.04em; }
      .xg-merchant { margin-top:5px; font-size:13px; font-weight:750; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .xg-amount { margin-top:4px; font-size:24px; font-weight:850; letter-spacing:-.02em; }
      .xg-muted { color:#6b8287; font-size:11px; line-height:1.5; }
      .xg-fields { margin-top:10px; display:grid; grid-template-columns:1fr 92px; gap:8px; direction:ltr; }
      .xg-input, .xg-select { width:100%; border:1px solid #cfe0de; border-radius:11px; padding:9px 10px; background:white; color:#163039; font:600 12px inherit; outline:none; }
      .xg-primary { width:100%; margin-top:10px; border:0; border-radius:12px; padding:11px 13px; background:#0d918c; color:white; cursor:pointer; font:800 12px inherit; }
      .xg-primary:disabled { opacity:.45; cursor:not-allowed; }
      .xg-secondary { width:100%; margin-top:8px; border:1px solid #cfe0de; border-radius:12px; padding:10px 12px; background:white; color:#1e3d45; cursor:pointer; font:750 12px inherit; }
      .xg-section-title { display:flex; justify-content:space-between; align-items:center; margin:16px 2px 8px; font-size:12px; font-weight:850; }
      .xg-cart { display:grid; gap:7px; }
      .xg-item { display:grid; grid-template-columns:1fr auto; gap:10px; align-items:center; padding:10px 11px; border:1px solid #e6eeee; border-radius:13px; background:#fff; }
      .xg-item-title { font-size:11px; font-weight:750; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .xg-item-meta { margin-top:3px; color:#789096; font-size:9px; direction:ltr; text-align:right; }
      .xg-item-price { font-size:11px; font-weight:850; white-space:nowrap; }
      .xg-remove { border:0; background:transparent; color:#a04c4c; cursor:pointer; font-size:10px; padding:4px 0; }
      .xg-totals { margin-top:10px; padding:10px 11px; border-radius:13px; background:#f4f7f7; display:grid; gap:5px; }
      .xg-total-row { display:flex; justify-content:space-between; font-size:11px; font-weight:800; }
      .xg-session { margin-bottom:12px; padding:12px; border-radius:15px; background:#10272e; color:white; }
      .xg-session strong { display:block; font-size:12px; margin-bottom:3px; }
      .xg-session .xg-muted { color:#b9cece; }
      .xg-session-actions { display:grid; grid-template-columns:1fr 86px; gap:7px; margin-top:9px; }
      .xg-next { border:0; border-radius:10px; padding:9px; background:#24c9bd; color:#082d30; font:850 11px inherit; cursor:pointer; }
      .xg-stop { border:1px solid #496268; border-radius:10px; background:transparent; color:#d8e5e5; font:700 10px inherit; cursor:pointer; }
      .xg-empty { padding:18px 8px; text-align:center; color:#778e93; font-size:11px; }
      .xg-note { margin-top:10px; color:#789096; font-size:9px; line-height:1.5; }
      .xg-toast { position:fixed; right:18px; bottom:76px; max-width:330px; padding:11px 13px; border-radius:12px; background:#12333a; color:white; box-shadow:0 12px 34px rgba(0,0,0,.2); font:700 11px inherit; animation:xg-in .18s ease-out; }
      @keyframes xg-in { from { opacity:0; transform:translateY(7px); } }
    `;
  }

  function render() {
    const host = ensureHost();
    const shadow = host.shadowRoot;
    const shouldShow = detected.likely || state.cart.length > 0 || state.session?.status === "ACTIVE";
    if (!shouldShow) {
      shadow.innerHTML = "";
      return;
    }

    const totalRows = totalsByCurrency(state.cart)
      .map(([currency, amount]) => `<div class="xg-total-row"><span>${escapeHtml(currency)}</span><span>${escapeHtml(money(amount, currency))}</span></div>`)
      .join("");

    const cartRows = state.cart
      .map(
        (item) => `<div class="xg-item">
          <div>
            <div class="xg-item-title">${escapeHtml(item.title || item.merchant)}</div>
            <div class="xg-item-meta">${escapeHtml(item.merchant)}</div>
            <button class="xg-remove" data-remove="${escapeHtml(item.id)}">إزالة</button>
          </div>
          <div class="xg-item-price">${escapeHtml(money(item.amount, item.currency))}</div>
        </div>`,
      )
      .join("");

    const current = currentSessionItem();
    const sessionBlock = current
      ? `<div class="xg-session">
          <strong>Pay All · دفعة ${state.session.index + 1} من ${state.session.itemIds.length}</strong>
          <div class="xg-muted">أكمل الدفع المعتاد لدى ${escapeHtml(current.merchant)}. XGuard لا يقرأ أو يخزن بيانات البطاقة.</div>
          <div class="xg-session-actions">
            <button class="xg-next" id="xg-next">تم الدفع — التالي</button>
            <button class="xg-stop" id="xg-stop">إيقاف</button>
          </div>
        </div>`
      : "";

    const detectedAmount = detected.amount ? detected.amount.toFixed(2) : "";
    const launcherText = state.cart.length ? `XGuard · ${state.cart.length}` : "XGuard";

    shadow.innerHTML = `<style>${styles()}</style><div class="xg-wrap">
      <button class="xg-launcher" id="xg-launcher" aria-label="XGuard Pay All">
        <span class="xg-logo">X</span>
        <span>${escapeHtml(launcherText)}</span>
        ${state.cart.length ? `<span class="xg-badge">${state.cart.length}</span>` : ""}
      </button>
      ${
        open
          ? `<section class="xg-panel" aria-label="XGuard Pay All">
              <header class="xg-head">
                <span class="xg-logo">X</span>
                <div><h3>XGuard Pay All</h3><p>احجز دفعات من مواقع مختلفة وراجعها في مكان واحد</p></div>
                <button class="xg-close" id="xg-close">×</button>
              </header>
              <div class="xg-body">
                ${sessionBlock}
                ${
                  detected.likely
                    ? `<div class="xg-current">
                        <div class="xg-eyebrow">الدفعة الحالية</div>
                        <div class="xg-merchant">${escapeHtml(detected.title)}</div>
                        ${detected.amount ? `<div class="xg-amount">${escapeHtml(money(detected.amount, detected.currency))}</div>` : `<div class="xg-muted" style="margin-top:6px">لم أستطع قراءة المبلغ بثقة. أدخله يدويًا.</div>`}
                        <div class="xg-fields">
                          <input class="xg-input" id="xg-amount-input" inputmode="decimal" placeholder="المبلغ" value="${escapeHtml(detectedAmount)}" />
                          <select class="xg-select" id="xg-currency-input">
                            ${["JOD", "USD", "EUR", "GBP", "SAR", "AED", "EGP", "USDC"].map((currency) => `<option value="${currency}" ${currency === detected.currency ? "selected" : ""}>${currency}</option>`).join("")}
                          </select>
                        </div>
                        <button class="xg-primary" id="xg-add">احجز هذه الدفعة</button>
                        <div class="xg-note">تُحفظ السلة محليًا في المتصفح. لا يقرأ XGuard حقول أرقام البطاقات أو كلمات المرور.</div>
                      </div>`
                    : ""
                }
                <div class="xg-section-title"><span>الدفعات المحجوزة</span><span>${state.cart.length}</span></div>
                ${state.cart.length ? `<div class="xg-cart">${cartRows}</div><div class="xg-totals">${totalRows}</div>` : `<div class="xg-empty">لا توجد دفعات محفوظة بعد.</div>`}
                <button class="xg-primary" id="xg-pay-all" ${state.cart.length ? "" : "disabled"}>ادفع الكل</button>
                ${state.cart.length ? `<button class="xg-secondary" id="xg-clear">مسح السلة</button>` : ""}
                <div class="xg-note">في النسخة الحالية، «ادفع الكل» يبدأ جلسة واحدة ويقودك إلى الدفعات المحفوظة بالترتيب. تنفيذ خصم مصرفي واحد حقيقي لكل التجار يحتاج rail/issuer يدعم التفويض المجمع.</div>
              </div>
            </section>`
          : ""
      }
    </div>`;

    shadow.getElementById("xg-launcher")?.addEventListener("click", () => {
      open = !open;
      render();
    });
    shadow.getElementById("xg-close")?.addEventListener("click", () => {
      open = false;
      render();
    });
    shadow.getElementById("xg-add")?.addEventListener("click", addCurrentPayment);
    shadow.getElementById("xg-pay-all")?.addEventListener("click", startPayAll);
    shadow.getElementById("xg-clear")?.addEventListener("click", async () => {
      const result = await send("XG_CLEAR_CART");
      state = result;
      render();
    });
    shadow.getElementById("xg-next")?.addEventListener("click", async () => {
      const result = await send("XG_SESSION_NEXT", { outcome: "PAID" });
      if (result.done) showToast("اكتملت جلسة Pay All");
    });
    shadow.getElementById("xg-stop")?.addEventListener("click", async () => {
      state = await send("XG_SESSION_STOP");
      render();
    });
    shadow.querySelectorAll("[data-remove]").forEach((button) => {
      button.addEventListener("click", async () => {
        const result = await send("XG_REMOVE_PAYMENT", { id: button.dataset.remove });
        state = result;
        render();
      });
    });
  }

  async function addCurrentPayment() {
    const shadow = ensureHost().shadowRoot;
    const amount = parseNumericAmount(shadow.getElementById("xg-amount-input")?.value || "");
    const currency = shadow.getElementById("xg-currency-input")?.value || detected.currency || "USD";
    if (!amount) {
      showToast("أدخل مبلغًا صحيحًا أولًا");
      return;
    }

    const result = await send("XG_ADD_PAYMENT", {
      payment: {
        title: detected.title,
        url: location.href,
        amount,
        currency,
      },
    });
    state = { cart: result.cart, session: result.session };
    open = true;
    render();
    showToast("تمت إضافة الدفعة إلى XGuard");
  }

  async function startPayAll() {
    if (!state.cart.length) return;
    await send("XG_START_PAY_ALL");
  }

  function showToast(message) {
    const shadow = ensureHost().shadowRoot;
    const existing = shadow.getElementById("xg-toast");
    existing?.remove();
    const toast = document.createElement("div");
    toast.id = "xg-toast";
    toast.className = "xg-toast";
    toast.textContent = message;
    shadow.querySelector(".xg-wrap")?.appendChild(toast);
    window.setTimeout(() => toast.remove(), 2200);
  }

  function redetect() {
    const next = detectPayment();
    const changed =
      next.likely !== detected.likely ||
      next.amount !== detected.amount ||
      next.currency !== detected.currency ||
      next.url !== detected.url;
    detected = next;
    if (changed) render();
  }

  const observer = new MutationObserver(() => {
    window.clearTimeout(observer.timer);
    observer.timer = window.setTimeout(redetect, 350);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  window.setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      redetect();
    }
  }, 900);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.xguardCart || changes.xguardSession) refresh().catch(() => {});
  });

  refresh().catch(() => render());
})();
