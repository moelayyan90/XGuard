/* global chrome, crypto */
const API_ORIGIN = "https://xguardgate.com";
const PASS_KEY = "xguardBuyerPass";
const CART_KEY = "xguardPayAllCart";
const SESSION_KEY = "xguardPayAllSession";
const PAYEES_KEY = "xguardSavedPayees";
const HISTORY_KEY = "xguardPaymentHistory";

chrome.runtime.onInstalled.addListener(async () => {
  const state = await getState();
  await updateBadge(state.cart);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "XGUARD_PAYMENT_DECISION":
        return { record: await runDecision(message.intent) };
      case "XGUARD_MEMORY_GET":
      case "XGUARD_PAY_ALL_GET":
        return getState();
      case "XGUARD_PAYMENT_DEFER":
      case "XGUARD_PAY_ALL_ADD":
        return addPayment(message.payment);
      case "XGUARD_PAY_SINGLE_START":
        return startSingle(message.payment);
      case "XGUARD_PAY_ALL_REMOVE":
        return removePayment(message.id);
      case "XGUARD_PAY_ALL_CLEAR":
        return clearPending();
      case "XGUARD_PAY_ALL_START":
        return startAll();
      case "XGUARD_PAY_ALL_NEXT":
        return advance(message.outcome || "PAID");
      case "XGUARD_PAY_ALL_STOP":
        return stopSession();
      case "XGUARD_SPLIT_CREATE":
        return createSplit(message.allocations, message.currency);
      default:
        throw new Error("Unsupported XGuard extension request");
    }
  })()
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: safeError(error) }));
  return true;
});

async function getState() {
  const stored = await chrome.storage.local.get([
    CART_KEY,
    SESSION_KEY,
    PAYEES_KEY,
    HISTORY_KEY,
  ]);
  return {
    cart: Array.isArray(stored[CART_KEY]) ? stored[CART_KEY] : [],
    session: stored[SESSION_KEY] ?? null,
    payees: Array.isArray(stored[PAYEES_KEY]) ? stored[PAYEES_KEY] : [],
    history: Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY] : [],
  };
}

async function saveState({ cart, session, payees, history }) {
  const payload = {};
  if (cart !== undefined) payload[CART_KEY] = cart;
  if (session !== undefined) payload[SESSION_KEY] = session;
  if (payees !== undefined) payload[PAYEES_KEY] = payees;
  if (history !== undefined) payload[HISTORY_KEY] = history;
  await chrome.storage.local.set(payload);
  if (cart !== undefined) await updateBadge(cart);
}

async function updateBadge(cart) {
  const count = Array.isArray(cart) ? cart.length : 0;
  await chrome.action.setBadgeText({ text: count ? String(count) : "" });
  if (count) await chrome.action.setBadgeBackgroundColor({ color: "#0d918c" });
}

function normalizePayment(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid payment");

  const url = new URL(String(value.url || ""));
  if (url.protocol !== "https:") throw new Error("XGuard requires an HTTPS payment URL");
  if (["xguardgate.com", "www.xguardgate.com"].includes(url.hostname))
    throw new Error("XGuard service pages cannot be saved as payments");

  const amount = Number(value.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000)
    throw new Error("Invalid payment amount");

  const currency = String(value.currency || "USD").trim().toUpperCase();
  if (!/^[A-Z0-9]{3,8}$/.test(currency)) throw new Error("Invalid currency");

  const provider = String(value.provider || "generic_http").slice(0, 60);
  const origin = url.origin;
  const payeeName = String(value.payeeName || url.hostname)
    .trim()
    .slice(0, 120);
  const paymentName = String(value.paymentName || value.title || "Payment")
    .trim()
    .slice(0, 140);

  return {
    id: crypto.randomUUID(),
    payeeId: stablePayeeId(origin, provider),
    payeeName,
    paymentName,
    merchant: url.hostname.replace(/^www\./, "").slice(0, 180),
    title: String(value.title || paymentName).trim().slice(0, 180),
    url: url.href,
    origin,
    provider,
    rail: String(value.rail || provider || "card").slice(0, 60),
    amount: amount.toFixed(2),
    currency,
    createdAt: new Date().toISOString(),
  };
}

function stablePayeeId(origin, provider) {
  return `payee:${String(provider).replace(/[^a-z0-9_-]/gi, "_")}:${String(origin)
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9._-]/gi, "_")}`.slice(0, 220);
}

function rememberPayee(payees, payment) {
  const now = new Date().toISOString();
  const index = payees.findIndex((payee) => payee.id === payment.payeeId);
  const memory = {
    id: payment.payeeId,
    displayName: payment.payeeName,
    origin: payment.origin,
    provider: payment.provider,
    rail: payment.rail,
    lastUrl: payment.url,
    lastPaymentName: payment.paymentName,
    lastAmount: payment.amount,
    lastCurrency: payment.currency,
    lastSeenAt: now,
    paymentCount: index >= 0 ? Number(payees[index].paymentCount || 0) : 0,
    lastPaidAt: index >= 0 ? payees[index].lastPaidAt || null : null,
  };
  if (index >= 0) payees[index] = { ...payees[index], ...memory };
  else payees.unshift(memory);
  return payees
    .sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)))
    .slice(0, 200);
}

async function addPayment(value) {
  const payment = normalizePayment(value);
  const state = await getState();
  const duplicate = state.cart.findIndex(
    (item) =>
      item.payeeId === payment.payeeId &&
      item.paymentName === payment.paymentName &&
      item.amount === payment.amount &&
      item.currency === payment.currency,
  );

  if (duplicate >= 0) {
    state.cart[duplicate] = {
      ...state.cart[duplicate],
      url: payment.url,
      title: payment.title,
      createdAt: payment.createdAt,
    };
  } else {
    state.cart.push(payment);
  }
  state.payees = rememberPayee(state.payees, payment);
  await saveState({ cart: state.cart, payees: state.payees });
  return {
    ...state,
    item: duplicate >= 0 ? state.cart[duplicate] : payment,
  };
}

async function startSingle(value) {
  const added = await addPayment(value);
  const item = added.item;
  const session = createSession([item]);
  await saveState({ session });
  return { ...added, session, nextUrl: item.url };
}

async function removePayment(id) {
  const state = await getState();
  state.cart = state.cart.filter((item) => item.id !== id);
  await saveState({ cart: state.cart });
  return state;
}

async function clearPending() {
  const state = await getState();
  state.cart = [];
  state.session = null;
  await saveState({ cart: [], session: null });
  return state;
}

function createSession(items) {
  const snapshot = {};
  for (const item of items) snapshot[item.id] = item;
  return {
    id: crypto.randomUUID(),
    status: "ACTIVE",
    itemIds: items.map((item) => item.id),
    index: 0,
    outcomes: {},
    snapshot,
    approvedAt: new Date().toISOString(),
  };
}

async function startAll() {
  const state = await getState();
  if (!state.cart.length) throw new Error("No deferred payments");
  state.session = createSession(state.cart);
  await saveState({ session: state.session });
  return { ...state, nextUrl: state.cart[0].url };
}

async function advance(outcome) {
  const state = await getState();
  const session = state.session;
  if (!session || session.status !== "ACTIVE") throw new Error("No active payment session");

  const currentId = session.itemIds[session.index];
  const current =
    state.cart.find((item) => item.id === currentId) || session.snapshot?.[currentId];
  if (!current) throw new Error("Current payment is missing");

  const status = String(outcome).slice(0, 24).toUpperCase();
  const now = new Date().toISOString();
  session.outcomes[currentId] = { status, at: now };

  if (status === "PAID") {
    state.history.unshift({
      id: crypto.randomUUID(),
      payeeId: current.payeeId,
      payeeName: current.payeeName,
      paymentName: current.paymentName,
      amount: current.amount,
      currency: current.currency,
      provider: current.provider,
      origin: current.origin,
      paidAt: now,
    });
    state.history = state.history.slice(0, 500);
    const payee = state.payees.find((entry) => entry.id === current.payeeId);
    if (payee) {
      payee.paymentCount = Number(payee.paymentCount || 0) + 1;
      payee.lastPaidAt = now;
      payee.lastAmount = current.amount;
      payee.lastCurrency = current.currency;
      payee.lastPaymentName = current.paymentName;
      payee.lastUrl = current.url;
    }
    state.cart = state.cart.filter((item) => item.id !== currentId);
  }

  const nextIndex = session.index + 1;
  if (nextIndex >= session.itemIds.length) {
    session.status = "COMPLETED";
    session.completedAt = now;
    state.session = session;
    await saveState({
      cart: state.cart,
      session,
      payees: state.payees,
      history: state.history,
    });
    return { ...state, done: true, nextUrl: null };
  }

  session.index = nextIndex;
  state.session = session;
  const nextId = session.itemIds[nextIndex];
  const next =
    state.cart.find((item) => item.id === nextId) || session.snapshot?.[nextId];
  if (!next) throw new Error("Next payment is missing");
  await saveState({
    cart: state.cart,
    session,
    payees: state.payees,
    history: state.history,
  });
  return { ...state, done: false, nextUrl: next.url };
}

async function stopSession() {
  const state = await getState();
  if (state.session) {
    state.session.status = "STOPPED";
    state.session.stoppedAt = new Date().toISOString();
    await saveState({ session: state.session });
  }
  return state;
}

async function createSplit(allocationsValue, currencyValue) {
  if (!Array.isArray(allocationsValue)) throw new Error("Invalid split");
  const state = await getState();
  const currency = String(currencyValue || "USD").trim().toUpperCase();
  const allocations = allocationsValue
    .map((entry) => ({
      payeeId: String(entry?.payeeId || ""),
      amount: Number(entry?.amount),
    }))
    .filter((entry) => entry.payeeId && Number.isFinite(entry.amount) && entry.amount > 0);
  if (allocations.length < 2) throw new Error("Split requires at least two payees");

  const groupId = crypto.randomUUID();
  for (const allocation of allocations) {
    const payee = state.payees.find((entry) => entry.id === allocation.payeeId);
    if (!payee?.lastUrl) throw new Error("A selected payee has no reusable payment destination");
    const payment = normalizePayment({
      title: `Split payment — ${payee.displayName}`,
      paymentName: `تقسيم دفعة · ${payee.displayName}`,
      payeeName: payee.displayName,
      url: payee.lastUrl,
      provider: payee.provider,
      rail: payee.rail,
      amount: allocation.amount,
      currency,
    });
    payment.splitGroupId = groupId;
    state.cart.push(payment);
    state.payees = rememberPayee(state.payees, payment);
  }
  await saveState({ cart: state.cart, payees: state.payees });
  return state;
}

async function runDecision(intent) {
  const buyerPass = await getOrCreateBuyerPass();
  const requestId = `browser:${crypto.randomUUID()}`;
  const response = await fetch(`${API_ORIGIN}/v1/payment/decision`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${buyerPass}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ requestId, channel: "browser", ...sanitizeIntent(intent) }),
  });

  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`XGuard returned HTTP ${response.status}`);
  }
  if (!response.ok) {
    if (response.status === 402) {
      await chrome.storage.local.set({ xguardNeedsTopUp: true });
      await chrome.runtime.openOptionsPage();
      throw new Error("XGuard service balance needs a top-up. The payment was not changed.");
    }
    if (response.status === 401) {
      await chrome.storage.local.remove(PASS_KEY);
      throw new Error("This Buyer Pass is no longer valid.");
    }
    throw new Error(typeof body?.error === "string" ? body.error : `XGuard returned HTTP ${response.status}`);
  }
  await chrome.storage.local.set({ xguardNeedsTopUp: false });
  return body;
}

async function getOrCreateBuyerPass() {
  const stored = await chrome.storage.local.get(PASS_KEY);
  if (isBuyerPass(stored[PASS_KEY])) return stored[PASS_KEY];

  const response = await fetch(`${API_ORIGIN}/v1/buyer-pass`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel: "browser", label: "Browser" }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !isBuyerPass(body?.buyerPass))
    throw new Error("XGuard could not create a Buyer Pass for this browser.");

  await chrome.storage.local.set({
    [PASS_KEY]: body.buyerPass,
    xguardBuyerPassId: body.passId,
  });
  return body.buyerPass;
}

function isBuyerPass(value) {
  return typeof value === "string" && /^xg_pass_[A-Za-z0-9_-]{40,64}$/.test(value);
}

function sanitizeIntent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid payment intent");
  const allowed = [
    "rail",
    "provider",
    "amount",
    "currency",
    "payee",
    "merchantOrigin",
    "network",
    "asset",
    "expectedAmount",
    "expectedPayee",
    "expiresAt",
    "paymentReference",
    "metadata",
  ];
  const out = {};
  for (const key of allowed) if (value[key] !== undefined) out[key] = value[key];
  return out;
}

function safeError(error) {
  return error instanceof Error && error.message
    ? error.message.slice(0, 240)
    : "XGuard request failed";
}
