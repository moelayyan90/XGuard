/* global chrome, document, location, MutationObserver, HTMLInputElement, setTimeout, clearTimeout */
(() => {
  const PAYMENT_WORDS =
    /\b(pay|payment|pay now|buy now|checkout|purchase|subscribe|transfer|send money|remit|beneficiary|recipient|confirm transfer|confirm payment)\b|ادفع|الدفع|تحويل|حوّل|ارسل|أرسل|مستفيد|المستفيد|سداد|تأكيد التحويل|تأكيد الدفع/i;
  const TRANSFER_WORDS =
    /\b(transfer|send money|remit|beneficiary|recipient)\b|تحويل|حوّل|ارسل|أرسل|مستفيد|المستفيد/i;
  const TOTAL_WORDS =
    /\b(total|amount due|amount|balance due|grand total)\b|الإجمالي|المجموع|المبلغ|المستحق/i;
  const CURRENCIES = ["JOD", "USD", "EUR", "GBP", "SAR", "AED", "EGP", "USDC"];

  let host = null;
  let shadow = null;
  let trigger = null;
  let signal = null;
  let state = { cart: [], session: null, payees: [], history: [] };
  let panelOpen = false;
  let splitOpen = false;
  let scanTimer = null;

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 250);
  }

  async function scan() {
    if (document.visibilityState !== "visible") return;
    trigger = findPaymentTrigger();
    try {
      state = await send({ type: "XGUARD_MEMORY_GET" });
    } catch {
      state = { cart: [], session: null, payees: [], history: [] };
    }
    if (!trigger) {
      removeHost();
      return;
    }
    signal = buildSignal(trigger);
    render();
  }

  function findPaymentTrigger() {
    const candidates = Array.from(
      document.querySelectorAll(
        "button,[role='button'],input[type='submit'],a[href]",
      ),
    ).slice(0, 450);
    for (const element of candidates) {
      if (element.closest?.("#xguard-inline-payment-rail")) continue;
      const label = visibleLabel(element);
      if (PAYMENT_WORDS.test(label)) return element;
    }
    return null;
  }

  function buildSignal(element) {
    const label = visibleLabel(element);
    const money = detectMoneyNear(element);
    const transfer =
      TRANSFER_WORDS.test(label) ||
      /(transfer|send|remit|beneficiary)/i.test(location.pathname);
    return {
      title: document.title || location.hostname,
      paymentName: document.title?.slice(0, 100) || "دفعة",
      payeeName: location.hostname.replace(/^www\./, ""),
      url: location.href,
      origin: location.origin,
      provider: detectProvider(),
      rail: transfer ? "transfer" : "card",
      amount: money?.amount || null,
      currency: money?.currency || "USD",
    };
  }

  function visibleLabel(element) {
    if (element instanceof HTMLInputElement)
      return element.value || element.getAttribute("aria-label") || "";
    return `${element.textContent || ""} ${element.getAttribute("aria-label") || ""}`
      .trim()
      .slice(0, 220);
  }

  function detectProvider() {
    const haystack = `${location.href} ${Array.from(document.scripts)
      .slice(0, 120)
      .map((item) => item.src)
      .filter(Boolean)
      .join(" ")}`;
    if (/stripe/i.test(haystack)) return "stripe";
    if (/paypal/i.test(haystack)) return "paypal";
    if (/adyen/i.test(haystack)) return "adyen";
    if (/coinbase/i.test(haystack)) return "coinbase";
    if (/shopify|shop-pay/i.test(haystack)) return "shopify";
    if (/checkout\.com/i.test(haystack)) return "checkout";
    return "generic_http";
  }

  function detectMoneyNear(element) {
    const scopes = [
      element.closest?.("form"),
      element.closest?.("section"),
      element.closest?.("main"),
      element.parentElement,
    ].filter(Boolean);
    const candidates = [];
    for (const scope of scopes) {
      const text = (scope.textContent || "").trim().slice(0, 2400);
      if (!text) continue;
      const parsed = parseMoney(text);
      if (parsed)
        candidates.push({
          ...parsed,
          score: TOTAL_WORDS.test(text) ? 2 : 1,
        });
    }
    candidates.sort(
      (a, b) => b.score - a.score || Number(b.amount) - Number(a.amount),
    );
    return candidates[0] || null;
  }

  function parseMoney(text) {
    const value = normalizeDigits(text).replace(/\u00a0/g, " ");
    const numbers = Array.from(value.matchAll(/[0-9][0-9.,]{0,18}/g))
      .map((match) => normalizeAmount(match[0]))
      .filter(Boolean)
      .map(Number)
      .filter((amount) => amount > 0 && amount < 1_000_000_000);
    if (!numbers.length) return null;
    return {
      amount: numbers[numbers.length - 1].toFixed(2),
      currency: detectCurrency(value),
    };
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
      normalized =
        comma > dot
          ? normalized.replace(/\./g, "").replace(",", ".")
          : normalized.replace(/,/g, "");
    } else if (comma >= 0) {
      normalized =
        normalized.length - comma - 1 === 2
          ? normalized.replace(",", ".")
          : normalized.replace(/,/g, "");
    }
    const amount = Number(normalized);
    return Number.isFinite(amount) && amount > 0 ? amount.toFixed(2) : null;
  }

  function ensureHost() {
    if (host?.isConnected && host.previousElementSibling === trigger) return;
    removeHost();
    host = document.createElement("span");
    host.id = "xguard-inline-payment-rail";
    host.style.cssText =
      "all:initial;display:inline-block;position:relative;margin:8px 4px;vertical-align:middle;z-index:2147483646";
    shadow = host.attachShadow({ mode: "closed" });
    trigger.insertAdjacentElement("afterend", host);
  }

  function removeHost() {
    host?.remove();
    host = null;
    shadow = null;
  }

  function render() {
    if (!trigger?.isConnected || !signal) {
      removeHost();
      return;
    }
    ensureHost();

    const pending = state.cart.slice(0, 5);
    const payees = state.payees.slice(0, 6);
    const amount = signal.amount ? formatMoney(signal.amount, signal.currency) : "";
    const pendingRows = pending
      .map(
        (item) =>
          `<div class="row"><div><b>${escapeHtml(item.paymentName)}</b><span>${escapeHtml(item.payeeName)}</span></div><strong>${escapeHtml(formatMoney(item.amount, item.currency))}</strong></div>`,
      )
      .join("");
    const payeeRows = payees
      .map(
        (payee) =>
          `<div class="row payee"><div><b>${escapeHtml(payee.displayName)}</b><span>${escapeHtml(payee.lastPaymentName || payee.origin)}</span></div><div class="mini-actions"><button data-requeue="${escapeHtml(payee.id)}">رحّل</button><button data-pay="${escapeHtml(payee.id)}">ادفع</button></div></div>`,
      )
      .join("");
    const splitRows = payees
      .map(
        (payee) =>
          `<label class="split-row"><span>${escapeHtml(payee.displayName)}</span><input data-split="${escapeHtml(payee.id)}" inputmode="decimal" placeholder="0.00"></label>`,
      )
      .join("");

    shadow.innerHTML = `<style>
      *{box-sizing:border-box}.rail{direction:rtl;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#133139;position:relative}.bar{display:flex;align-items:center;gap:5px;padding:5px;background:#f5fbfa;border:1px solid #cfe6e3;border-radius:12px;box-shadow:0 8px 24px #00333b1f}.xg,.action{border:0;border-radius:8px;cursor:pointer;font:800 9px inherit;padding:8px 9px}.xg{background:#102f35;color:#fff}.defer{background:#0d918c;color:#fff}.all{background:#e8f6f4;color:#166d69}.action:disabled{opacity:.45;cursor:not-allowed}.amount{font-size:8px;color:#607b80;padding:0 3px;white-space:nowrap}.panel{position:absolute;left:0;top:calc(100% + 7px);width:min(360px,calc(100vw - 30px));max-height:500px;overflow:auto;background:#fff;border:1px solid #d9e8e6;border-radius:15px;box-shadow:0 18px 54px #001b2338;padding:10px;z-index:2147483647}.head{display:flex;align-items:center;justify-content:space-between;gap:8px}.head b{font-size:11px}.close{border:0;background:#eef4f3;border-radius:8px;width:25px;height:25px;cursor:pointer}.fields{display:grid;gap:5px;margin-top:8px}.fields input,.fields select,.split-row input{width:100%;border:1px solid #d1e1df;border-radius:8px;background:#fff;padding:7px;font:700 9px inherit;color:#17363b}.money{display:grid;grid-template-columns:1fr 78px;gap:5px;direction:ltr}.section{margin-top:10px;font-size:8px;font-weight:900;color:#617b80}.row{display:grid;grid-template-columns:1fr auto;gap:7px;align-items:center;border-top:1px solid #edf2f1;padding:7px 1px}.row:first-of-type{border-top:0}.row b{display:block;font-size:8px}.row span{display:block;color:#82969a;font-size:7px;margin-top:2px}.row strong{font-size:8px}.mini-actions{display:flex;gap:4px}.mini-actions button,.split-button{border:0;border-radius:7px;background:#edf7f5;color:#14756f;padding:5px 7px;font:800 7px inherit;cursor:pointer}.split-toggle{width:100%;margin-top:7px;border:1px solid #d5e3e1;border-radius:8px;background:#fff;color:#34575d;padding:7px;font:800 8px inherit;cursor:pointer}.split-box{margin-top:7px;padding:7px;background:#f5f9f8;border-radius:9px}.split-row{display:grid;grid-template-columns:1fr 85px;gap:6px;align-items:center;margin-top:5px;font-size:8px}.split-button{width:100%;margin-top:7px;background:#0d918c;color:#fff}.note{font-size:7px;line-height:1.45;color:#83979a;margin-top:6px}.error{font-size:8px;color:#a2383d;margin-top:6px}
    </style><div class="rail"><div class="bar"><button class="xg" id="memory">XGuard${state.cart.length ? ` · ${state.cart.length}` : ""}</button><button class="action defer" id="defer">ترحيل لغايات الدفع</button><button class="action all" id="payAll" ${state.cart.length ? "" : "disabled"}>دفع كل الفواتير</button>${amount ? `<span class="amount">${escapeHtml(amount)}</span>` : ""}</div>${panelOpen ? `<div class="panel"><div class="head"><b>قائمة XGuard</b><button class="close" id="close">×</button></div><div class="fields"><input id="paymentName" value="${escapeHtml(signal.paymentName)}" placeholder="اسم الدفعة"><input id="payeeName" value="${escapeHtml(signal.payeeName)}" placeholder="اسم المستفيد"><div class="money"><input id="amountInput" inputmode="decimal" value="${escapeHtml(signal.amount || "")}" placeholder="المبلغ"><select id="currencyInput">${CURRENCIES.map((currency) => `<option ${currency === signal.currency ? "selected" : ""}>${currency}</option>`).join("")}</select></div></div><div id="result"></div><div class="section">الفواتير المرحّلة · ${state.cart.length}</div>${pendingRows || `<div class="note">لا توجد دفعات مرحّلة.</div>`}<div class="section">المستفيدون المحفوظون · ${state.payees.length}</div>${payeeRows || `<div class="note">سيظهر المستفيد هنا بعد أول دفع أو ترحيل.</div>`}<button class="split-toggle" id="splitToggle" ${state.payees.length >= 2 ? "" : "disabled"}>تقسيم الفواتير</button>${splitOpen ? `<div class="split-box">${splitRows}<button class="split-button" id="createSplit">إنشاء دفعات التقسيم</button></div>` : ""}<div class="note">هذه الطبقة تستخدم وجهات الدفع المحفوظة فقط ولا تقرأ بيانات البطاقة أو كلمات المرور.</div></div>` : ""}</div>`;

    bind("memory", () => {
      panelOpen = !panelOpen;
      render();
    });
    bind("close", () => {
      panelOpen = false;
      splitOpen = false;
      render();
    });
    bind("defer", deferCurrent);
    bind("payAll", payAll);
    bind("splitToggle", () => {
      splitOpen = !splitOpen;
      render();
    });
    bind("createSplit", createSplit);
    shadow
      .querySelectorAll("[data-requeue]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          reusePayee(button.dataset.requeue, false),
        ),
      );
    shadow
      .querySelectorAll("[data-pay]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          reusePayee(button.dataset.pay, true),
        ),
      );
  }

  function bind(id, handler) {
    shadow.getElementById(id)?.addEventListener("click", handler);
  }

  function currentPayment() {
    const amount = normalizeAmount(
      shadow?.getElementById("amountInput")?.value || signal?.amount || "",
    );
    if (!amount) throw new Error("أدخل المبلغ في قائمة XGuard أولًا.");
    return {
      ...signal,
      paymentName: (
        shadow?.getElementById("paymentName")?.value || signal.paymentName
      ).trim(),
      payeeName: (
        shadow?.getElementById("payeeName")?.value || signal.payeeName
      ).trim(),
      amount,
      currency:
        shadow?.getElementById("currencyInput")?.value || signal.currency,
    };
  }

  async function deferCurrent() {
    try {
      if (!signal.amount && !panelOpen) {
        panelOpen = true;
        render();
        return;
      }
      state = await send({
        type: "XGUARD_PAYMENT_DEFER",
        payment: currentPayment(),
      });
      panelOpen = true;
      render();
    } catch (error) {
      showError(error);
    }
  }

  async function payAll() {
    try {
      const response = await send({ type: "XGUARD_PAY_ALL_START" });
      state = response;
      if (response.nextUrl) location.href = response.nextUrl;
    } catch (error) {
      showError(error);
    }
  }

  function reusablePayment(payee) {
    if (!payee?.lastUrl || !payee?.lastAmount)
      throw new Error("لا توجد وجهة دفع محفوظة لهذا المستفيد.");
    return {
      title: payee.lastPaymentName || payee.displayName,
      paymentName: payee.lastPaymentName || "دفعة",
      payeeName: payee.displayName,
      url: payee.lastUrl,
      origin: payee.origin,
      provider: payee.provider,
      rail: payee.rail,
      amount: payee.lastAmount,
      currency: payee.lastCurrency || "USD",
    };
  }

  async function reusePayee(id, payNow) {
    try {
      const payee = state.payees.find((entry) => entry.id === id);
      const payment = reusablePayment(payee);
      const response = await send({
        type: payNow ? "XGUARD_PAY_SINGLE_START" : "XGUARD_PAYMENT_DEFER",
        payment,
      });
      state = response;
      if (payNow && response.nextUrl) location.href = response.nextUrl;
      else render();
    } catch (error) {
      showError(error);
    }
  }

  async function createSplit() {
    try {
      const allocations = Array.from(shadow.querySelectorAll("[data-split]"))
        .map((input) => ({
          payeeId: input.dataset.split,
          amount: normalizeAmount(input.value || ""),
        }))
        .filter((entry) => entry.amount);
      if (allocations.length < 2)
        throw new Error("أدخل مبلغًا لمستفيدين اثنين على الأقل.");
      state = await send({
        type: "XGUARD_SPLIT_CREATE",
        allocations,
        currency: signal.currency || "USD",
      });
      splitOpen = false;
      render();
    } catch (error) {
      showError(error);
    }
  }

  function showError(error) {
    panelOpen = true;
    render();
    const result = shadow?.getElementById("result");
    if (result)
      result.innerHTML = `<div class="error">${escapeHtml(error instanceof Error ? error.message : "تعذر تنفيذ العملية")}</div>`;
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
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  scheduleScan();
})();
