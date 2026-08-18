/* global chrome, document, location, MutationObserver, HTMLInputElement, setTimeout, clearTimeout, setInterval */
(() => {
  const PAYMENT_WORDS = /\b(pay|payment|pay now|buy now|checkout|purchase|subscribe|transfer|send money|remit|beneficiary|recipient)\b|ادفع|الدفع|تحويل|حوّل|ارسل|أرسل|مستفيد|المستفيد|دفع الفاتورة|سداد/i;
  const PAYMENT_PATH = /(checkout|payment|pay|billing|purchase|subscribe|transfer|send|remit|beneficiary|invoice|bill)/i;
  const TOTAL_WORDS = /\b(total|amount due|amount|balance due|grand total)\b|الإجمالي|المجموع|المبلغ|المستحق/i;
  const PROVIDERS = [
    ["stripe", /stripe/i],
    ["paypal", /paypal/i],
    ["coinbase", /coinbase/i],
    ["shopify", /shopify|shop-pay/i],
    ["adyen", /adyen/i],
    ["checkout", /checkout\.com/i],
  ];
  const CURRENCIES = ["JOD", "USD", "EUR", "GBP", "SAR", "AED", "EGP", "USDC"];

  let host = null;
  let shadow = null;
  let open = false;
  let splitOpen = false;
  let signal = null;
  let state = { cart: [], session: null, payees: [], history: [] };
  let scanTimer = null;
  let lastUrl = location.href;

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 250);
  }

  async function scan() {
    if (document.visibilityState !== "visible") return;
    signal = detectPaymentSurface();
    try {
      state = await send({ type: "XGUARD_MEMORY_GET" });
    } catch {
      state = { cart: [], session: null, payees: [], history: [] };
    }
    render();
  }

  function detectPaymentSurface() {
    let confidence = PAYMENT_PATH.test(location.pathname) ? 2 : 0;
    const candidates = Array.from(
      document.querySelectorAll("button,[role='button'],input[type='submit'],a[href]"),
    ).slice(0, 350);
    let trigger = null;
    for (const element of candidates) {
      const label = visibleLabel(element);
      if (PAYMENT_WORDS.test(label)) {
        confidence += 2;
        trigger = element;
        break;
      }
    }

    const forms = Array.from(document.forms)
      .slice(0, 50)
      .map((form) => form.action)
      .filter(Boolean)
      .join(" ");
    const scripts = Array.from(document.scripts)
      .slice(0, 150)
      .map((script) => script.src)
      .filter(Boolean)
      .join(" ");
    const provider = detectProvider(`${location.href} ${forms} ${scripts}`);
    if (provider !== "generic_http") confidence += 1;

    const total = detectStructuredAmount() || detectVisibleAmount(trigger);
    if (total?.amount) confidence += 1;
    if (confidence < 3) return null;

    return {
      confidence,
      provider,
      rail: /transfer|send|remit|beneficiary/i.test(location.pathname)
        ? "transfer"
        : provider === "generic_http"
          ? "card"
          : provider,
      amount: total?.amount || null,
      currency: total?.currency || "USD",
      merchantOrigin: location.origin,
      payee: location.hostname.replace(/^www\./, ""),
      title: document.title || location.hostname,
      url: location.href,
    };
  }

  function detectStructuredAmount() {
    const priceNodes = Array.from(
      document.querySelectorAll(
        'meta[itemprop="price"],meta[property="product:price:amount"],meta[name="price"],[itemprop="price"]',
      ),
    ).slice(0, 20);
    const currencyNodes = Array.from(
      document.querySelectorAll(
        'meta[itemprop="priceCurrency"],meta[property="product:price:currency"],meta[name="currency"]',
      ),
    ).slice(0, 20);
    for (const node of priceNodes) {
      const amount = normalizeAmount(
        node.getAttribute("content") || node.getAttribute("value") || node.textContent || "",
      );
      if (!amount) continue;
      const currency =
        currencyNodes
          .map((item) => item.getAttribute("content") || item.textContent || "")
          .map((value) => value.trim().toUpperCase())
          .find(Boolean) || "USD";
      return { amount, currency };
    }
    return null;
  }

  function detectVisibleAmount(trigger) {
    const nodes = new Set();
    for (const selector of [
      '[data-testid*="total" i]',
      '[data-test*="total" i]',
      '[aria-label*="total" i]',
      '[class*="total" i]',
      '[id*="total" i]',
      '[class*="amount" i]',
      '[id*="amount" i]',
    ]) {
      try {
        document.querySelectorAll(selector).forEach((node) => nodes.add(node));
      } catch {
        // Ignore unsupported selectors.
      }
    }
    document.querySelectorAll("strong,b,dt,dd,th,td,[role='row']").forEach((node) => {
      const text = (node.textContent || "").trim();
      if (text.length < 240 && TOTAL_WORDS.test(text)) nodes.add(node);
    });
    if (trigger) {
      const context = trigger.closest("form,section,main,aside");
      if (context) nodes.add(context);
    }

    const found = [];
    for (const node of Array.from(nodes).slice(0, 200)) {
      const parsed = parseMoney((node.textContent || "").slice(0, 1400));
      if (parsed) found.push(parsed);
    }
    found.sort((a, b) => Number(b.amount) - Number(a.amount));
    return found[0] || null;
  }

  function parseMoney(text) {
    const value = normalizeDigits(text).replace(/\u00a0/g, " ");
    const currency = detectCurrency(value);
    const numbers = Array.from(value.matchAll(/[0-9][0-9.,]{0,18}/g))
      .map((match) => normalizeAmount(match[0]))
      .filter(Boolean)
      .map(Number)
      .filter((amount) => amount > 0 && amount < 1_000_000_000);
    if (!numbers.length) return null;
    return { amount: numbers[numbers.length - 1].toFixed(2), currency };
  }

  function visibleLabel(element) {
    if (element instanceof HTMLInputElement)
      return element.value || element.getAttribute("aria-label") || "";
    return `${element.textContent || ""} ${element.getAttribute("aria-label") || ""}`
      .trim()
      .slice(0, 200);
  }

  function detectProvider(haystack) {
    for (const [name, pattern] of PROVIDERS) if (pattern.test(haystack)) return name;
    return "generic_http";
  }

  function detectCurrency(text) {
    const value = String(text || "").toUpperCase();
    if (value.includes("د.أ") || value.includes("JOD")) return "JOD";
    if (value.includes("ر.س") || value.includes("SAR")) return "SAR";
    if (value.includes("د.إ") || value.includes("AED")) return "AED";
    if (value.includes("ج.م") || value.includes("EGP")) return "EGP";
    if (value.includes("USDC")) return "USDC";
    if (value.includes("EUR") || value.includes("€")) return "EUR";
    if (value.includes("GBP") || value.includes("£")) return "GBP";
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
      normalized = comma > dot
        ? normalized.replace(/\./g, "").replace(",", ".")
        : normalized.replace(/,/g, "");
    } else if (comma >= 0) {
      normalized = normalized.length - comma - 1 === 2
        ? normalized.replace(",", ".")
        : normalized.replace(/,/g, "");
    }
    const amount = Number(normalized);
    return Number.isFinite(amount) && amount > 0 ? amount.toFixed(2) : null;
  }

  function ensureHost() {
    if (host?.isConnected) return;
    host = document.createElement("div");
    host.id = "xguard-universal-payment-layer";
    host.style.cssText =
      "all:initial;position:fixed;right:18px;bottom:18px;z-index:2147483647";
    shadow = host.attachShadow({ mode: "closed" });
    document.documentElement.appendChild(host);
  }

  function shouldShow() {
    return Boolean(signal || state.cart.length || state.payees.length || state.session?.status === "ACTIVE");
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
    const currentAmount = signal?.amount || "";
    const currentCurrency = signal?.currency || "USD";
    const payeeRows = state.payees
      .slice(0, 6)
      .map(
        (payee) =>
          `<div class="memory"><div><b>${escapeHtml(payee.displayName)}</b><span>${escapeHtml(payee.lastPaymentName || payee.origin)}</span></div><button data-use-payee="${escapeHtml(payee.id)}">استخدم</button></div>`,
      )
      .join("");
    const cartRows = state.cart
      .map(
        (item) =>
          `<div class="bill"><div><b>${escapeHtml(item.paymentName)}</b><span>${escapeHtml(item.payeeName)}</span></div><strong>${escapeHtml(formatMoney(item.amount, item.currency))}</strong><button data-remove="${escapeHtml(item.id)}">×</button></div>`,
      )
      .join("");
    const historyRows = state.history
      .slice(0, 5)
      .map(
        (item) =>
          `<div class="history"><span>${escapeHtml(item.paymentName)} · ${escapeHtml(item.payeeName)}</span><b>${escapeHtml(formatMoney(item.amount, item.currency))}</b></div>`,
      )
      .join("");
    const splitRows = state.payees
      .slice(0, 8)
      .map(
        (payee) =>
          `<label class="split-row"><span>${escapeHtml(payee.displayName)}</span><input data-split-payee="${escapeHtml(payee.id)}" inputmode="decimal" placeholder="0.00"></label>`,
      )
      .join("");

    shadow.innerHTML = `<style>
      *{box-sizing:border-box}.xg{direction:rtl;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#102c32}.launch{border:0;border-radius:999px;background:#102f35;color:#fff;padding:10px 14px;display:flex;align-items:center;gap:8px;box-shadow:0 16px 48px #001b2340;cursor:pointer;font-weight:850}.logo{width:29px;height:29px;border-radius:9px;background:linear-gradient(135deg,#49d9cf,#0c8e88);display:grid;place-items:center;font-weight:950}.badge{min-width:20px;height:20px;border-radius:999px;background:#dffbf8;color:#08756f;display:grid;place-items:center;font-size:10px}.panel{position:absolute;right:0;bottom:55px;width:min(410px,calc(100vw - 28px));max-height:min(720px,calc(100vh - 90px));overflow:auto;background:#fff;border:1px solid #d9e7e5;border-radius:22px;box-shadow:0 26px 78px #001b2345}.head{position:sticky;top:0;z-index:2;padding:14px 15px;background:#fff;border-bottom:1px solid #edf2f1;display:flex;align-items:center;gap:9px}.head h3{margin:0;font-size:14px}.head p{margin:3px 0 0;color:#738a8f;font-size:9px}.close{margin-right:auto;border:0;background:#eef4f3;width:29px;height:29px;border-radius:9px;cursor:pointer}.body{padding:12px}.session{background:#102f35;color:#fff;border-radius:14px;padding:11px;margin-bottom:10px}.session p{margin:4px 0 8px;color:#c3d5d7;font-size:9px}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:7px}.btn{border:0;border-radius:10px;padding:10px 9px;font:800 10px inherit;cursor:pointer}.primary{background:#0d918c;color:#fff}.secondary{background:#eff6f5;color:#274b50;border:1px solid #d4e3e1}.danger{background:#fff1f1;color:#9b3737}.card{border:1px solid #c9e6e3;background:#f5fffd;border-radius:15px;padding:11px}.eyebrow{color:#0b8d87;font-size:8px;font-weight:900}.title{font-size:11px;font-weight:850;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.amount{font-size:21px;font-weight:950;margin:3px 0 8px}.fields{display:grid;gap:6px}.fields input,.fields select,.split-row input{width:100%;border:1px solid #cedfdd;border-radius:9px;background:#fff;padding:8px;font:700 10px inherit;color:#17363b}.money{display:grid;grid-template-columns:1fr 85px;gap:6px;direction:ltr}.section-title{display:flex;justify-content:space-between;align-items:center;margin:14px 2px 7px;font-size:10px;font-weight:900}.bill,.memory,.history{display:grid;align-items:center;gap:7px;border:1px solid #e3eceb;border-radius:11px;padding:8px 9px;margin-top:6px}.bill{grid-template-columns:1fr auto 22px}.memory{grid-template-columns:1fr auto}.history{grid-template-columns:1fr auto}.bill b,.memory b{font-size:9px;display:block}.bill span,.memory span{font-size:8px;color:#7b9195;display:block;margin-top:2px}.bill strong,.history b{font-size:9px}.bill button,.memory button{border:0;background:#edf6f5;color:#167d78;border-radius:8px;padding:5px 7px;font-size:8px;cursor:pointer}.note{color:#82979a;font-size:8px;line-height:1.55;margin-top:7px}.split{margin-top:8px;padding:9px;border-radius:12px;background:#f5f8f7}.split-row{display:grid;grid-template-columns:1fr 95px;gap:7px;align-items:center;margin-top:6px;font-size:9px}.error{margin-top:7px;color:#a3333b;font-size:9px}.decision{margin-top:7px;padding:8px;background:#edf5f4;border-radius:9px;font-size:9px}
    </style><div class="xg"><button class="launch" id="launch"><span class="logo">X</span><span>XGuard</span>${state.cart.length ? `<span class="badge">${state.cart.length}</span>` : ""}</button>${open ? `<section class="panel"><header class="head"><span class="logo">X</span><div><h3>XGuard</h3><p>طبقة الدفع والترحيل والذاكرة</p></div><button class="close" id="close">×</button></header><div class="body">${current ? `<div class="session"><b>جلسة دفع · ${state.session.index + 1} من ${state.session.itemIds.length}</b><p>أكمل الدفع المعتاد إلى ${escapeHtml(current.payeeName)} ثم أخبر XGuard.</p><div class="grid2"><button class="btn primary" id="next">تم الدفع — التالي</button><button class="btn danger" id="stop">إيقاف</button></div></div>` : ""}${signal ? `<div class="card"><div class="eyebrow">عملية دفع / تحويل مكتشفة</div><div class="title">${escapeHtml(signal.title)}</div>${signal.amount ? `<div class="amount">${escapeHtml(formatMoney(signal.amount, signal.currency))}</div>` : ""}<div class="fields"><input id="paymentName" placeholder="اسم الدفعة — مثال: فاتورة الكهرباء" value="${escapeHtml(suggestPaymentName())}"><input id="payeeName" placeholder="اسم المستفيد" value="${escapeHtml(suggestPayeeName())}"><div class="money"><input id="amountInput" inputmode="decimal" placeholder="المبلغ" value="${escapeHtml(currentAmount)}"><select id="currencyInput">${CURRENCIES.map((currency) => `<option ${currency === currentCurrency ? "selected" : ""}>${currency}</option>`).join("")}</select></div><div class="grid2"><button class="btn primary" id="defer">ترحيل لغايات الدفع</button><button class="btn secondary" id="single">دفع هذه فقط</button></div><button class="btn secondary" id="verify">تحقق من العملية عبر XGuard</button><div id="result"></div></div></div>` : ""}<div class="section-title"><span>الفواتير المرحّلة</span><span>${state.cart.length}</span></div>${cartRows || `<div class="note">لا توجد دفعات مرحّلة بعد.</div>`}<div class="grid2" style="margin-top:8px"><button class="btn primary" id="payAll" ${state.cart.length ? "" : "disabled"}>دفع كل الفواتير</button><button class="btn secondary" id="split">تقسيم الفواتير</button></div>${splitOpen ? `<div class="split"><b style="font-size:9px">قسّم مبلغًا على المستفيدين المحفوظين</b><div class="money" style="margin-top:7px"><input id="splitTotal" inputmode="decimal" placeholder="المبلغ الكلي"><select id="splitCurrency">${CURRENCIES.map((currency) => `<option>${currency}</option>`).join("")}</select></div>${splitRows || `<div class="note">ادفع أو رحّل لمستفيد مرة واحدة أولًا ليظهر هنا.</div>`}<button class="btn primary" id="createSplit" style="width:100%;margin-top:8px">إنشاء دفعات التقسيم</button></div>` : ""}<div class="section-title"><span>المستفيدون المحفوظون</span><span>${state.payees.length}</span></div>${payeeRows || `<div class="note">سيحفظ XGuard المستفيد تلقائيًا عند أول ترحيل أو دفع.</div>`}<div class="section-title"><span>آخر الدفعات</span><span>${state.history.length}</span></div>${historyRows || `<div class="note">لا يوجد سجل دفع بعد.</div>`}<div class="note">XGuard يحفظ أسماء الدفعات والمستفيدين محليًا لتجنب إعادة التسجيل. لا يقرأ أرقام البطاقات أو CVV أو كلمات المرور.</div></div></section>` : ""}</div>`;

    bind("launch", () => {
      open = !open;
      render();
    });
    bind("close", () => {
      open = false;
      render();
    });
    bind("defer", deferCurrent);
    bind("single", startSingle);
    bind("payAll", startAll);
    bind("split", () => {
      splitOpen = !splitOpen;
      render();
    });
    bind("createSplit", createSplit);
    bind("verify", verifyCurrent);
    bind("next", nextPayment);
    bind("stop", stopSession);
    shadow.querySelectorAll("[data-remove]").forEach((button) =>
      button.addEventListener("click", () => removeItem(button.dataset.remove)),
    );
    shadow.querySelectorAll("[data-use-payee]").forEach((button) =>
      button.addEventListener("click", () => usePayee(button.dataset.usePayee)),
    );
  }

  function bind(id, handler) {
    shadow.getElementById(id)?.addEventListener("click", handler);
  }

  function formPayment() {
    if (!signal) return null;
    const amount = normalizeAmount(shadow.getElementById("amountInput")?.value || signal.amount || "");
    const currency = shadow.getElementById("currencyInput")?.value || signal.currency || "USD";
    if (!amount) throw new Error("أدخل مبلغًا صحيحًا.");
    return {
      title: signal.title,
      paymentName: (shadow.getElementById("paymentName")?.value || suggestPaymentName()).trim(),
      payeeName: (shadow.getElementById("payeeName")?.value || suggestPayeeName()).trim(),
      url: location.href,
      origin: location.origin,
      provider: signal.provider,
      rail: signal.rail,
      amount,
      currency,
    };
  }

  async function deferCurrent() {
    try {
      const response = await send({ type: "XGUARD_PAYMENT_DEFER", payment: formPayment() });
      state = response;
      open = true;
      render();
    } catch (error) {
      showError(error);
    }
  }

  async function startSingle() {
    try {
      const response = await send({ type: "XGUARD_PAY_SINGLE_START", payment: formPayment() });
      state = response;
      open = true;
      render();
    } catch (error) {
      showError(error);
    }
  }

  async function startAll() {
    try {
      const response = await send({ type: "XGUARD_PAY_ALL_START" });
      state = response;
      if (response.nextUrl && response.nextUrl !== location.href) location.href = response.nextUrl;
      else render();
    } catch (error) {
      showError(error);
    }
  }

  async function nextPayment() {
    try {
      const response = await send({ type: "XGUARD_PAY_ALL_NEXT", outcome: "PAID" });
      state = response;
      if (response.done) {
        open = true;
        render();
      } else if (response.nextUrl) {
        location.href = response.nextUrl;
      }
    } catch (error) {
      showError(error);
    }
  }

  async function stopSession() {
    state = await send({ type: "XGUARD_PAY_ALL_STOP" });
    render();
  }

  async function removeItem(id) {
    state = await send({ type: "XGUARD_PAY_ALL_REMOVE", id });
    render();
  }

  function usePayee(id) {
    const payee = state.payees.find((entry) => entry.id === id);
    if (!payee || !signal) return;
    const payeeInput = shadow.getElementById("payeeName");
    const paymentInput = shadow.getElementById("paymentName");
    const amountInput = shadow.getElementById("amountInput");
    const currencyInput = shadow.getElementById("currencyInput");
    if (payeeInput) payeeInput.value = payee.displayName;
    if (paymentInput) paymentInput.value = payee.lastPaymentName || "دفعة";
    if (amountInput && payee.lastAmount) amountInput.value = payee.lastAmount;
    if (currencyInput && payee.lastCurrency) currencyInput.value = payee.lastCurrency;
  }

  async function createSplit() {
    try {
      const currency = shadow.getElementById("splitCurrency")?.value || "USD";
      const total = normalizeAmount(shadow.getElementById("splitTotal")?.value || "");
      const allocations = Array.from(shadow.querySelectorAll("[data-split-payee]"))
        .map((input) => ({
          payeeId: input.dataset.splitPayee,
          amount: normalizeAmount(input.value || ""),
        }))
        .filter((entry) => entry.amount);
      if (allocations.length < 2) throw new Error("أدخل مبلغًا لمستفيدين اثنين على الأقل.");
      const sum = allocations.reduce((acc, item) => acc + Number(item.amount), 0);
      if (total && Math.abs(sum - Number(total)) > 0.009)
        throw new Error("مجموع التقسيم لا يساوي المبلغ الكلي.");
      state = await send({ type: "XGUARD_SPLIT_CREATE", allocations, currency });
      splitOpen = false;
      render();
    } catch (error) {
      showError(error);
    }
  }

  async function verifyCurrent() {
    try {
      const payment = formPayment();
      const button = shadow.getElementById("verify");
      if (button) button.textContent = "جاري التحقق…";
      const response = await send({
        type: "XGUARD_PAYMENT_DECISION",
        intent: {
          rail: payment.rail,
          provider: payment.provider,
          amount: payment.amount,
          currency: payment.currency,
          payee: payment.payeeName,
          merchantOrigin: payment.origin,
          metadata: { detectionConfidence: signal.confidence },
        },
      });
      const record = response.record;
      const result = shadow.getElementById("result");
      if (result)
        result.innerHTML = `<div class="decision"><b>${escapeHtml(record.decision)}</b> · Risk ${Number(record.riskScore) || 0}/100</div>`;
      if (button) button.textContent = "تم التحقق";
    } catch (error) {
      showError(error);
    }
  }

  function currentSessionItem() {
    if (!state.session || state.session.status !== "ACTIVE") return null;
    const id = state.session.itemIds?.[state.session.index];
    return state.cart.find((item) => item.id === id) || state.session.snapshot?.[id] || null;
  }

  function suggestPayeeName() {
    const existing = state.payees.find((payee) => payee.origin === location.origin);
    return existing?.displayName || signal?.payee || "";
  }

  function suggestPaymentName() {
    const existing = state.payees.find((payee) => payee.origin === location.origin);
    return existing?.lastPaymentName || signal?.title?.slice(0, 80) || "دفعة";
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

  function showError(error) {
    const result = shadow?.getElementById("result");
    if (result)
      result.innerHTML = `<div class="error">${escapeHtml(error instanceof Error ? error.message : "تعذر تنفيذ العملية")}</div>`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async function send(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || "XGuard غير متاح");
    return response;
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      scheduleScan();
    }
  }, 800);
  scan();
})();
