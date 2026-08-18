/* global chrome, crypto */
const API_ORIGIN = "https://xguardgate.com";
const PASS_KEY = "xguardBuyerPass";
const CART_KEY = "xguardPayAllCart";
const SESSION_KEY = "xguardPayAllSession";

chrome.runtime.onInstalled.addListener(async () => {
  const { cart } = await getPayAllState();
  await updateBadge(cart);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "XGUARD_PAYMENT_DECISION":
        return { record: await runDecision(message.intent) };
      case "XGUARD_PAY_ALL_GET":
        return getPayAllState();
      case "XGUARD_PAY_ALL_ADD":
        return addPayAllItem(message.payment);
      case "XGUARD_PAY_ALL_REMOVE":
        return removePayAllItem(message.id);
      case "XGUARD_PAY_ALL_CLEAR":
        return clearPayAll();
      case "XGUARD_PAY_ALL_START":
        return startPayAll();
      case "XGUARD_PAY_ALL_NEXT":
        return advancePayAll(message.outcome || "PAID");
      case "XGUARD_PAY_ALL_STOP":
        return stopPayAll();
      default:
        throw new Error("Unsupported XGuard extension request");
    }
  })()
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: safeError(error) }));
  return true;
});

async function getPayAllState() {
  const stored = await chrome.storage.local.get([CART_KEY, SESSION_KEY]);
  return {
    cart: Array.isArray(stored[CART_KEY]) ? stored[CART_KEY] : [],
    session: stored[SESSION_KEY] ?? null,
  };
}

async function saveCart(cart) {
  await chrome.storage.local.set({ [CART_KEY]: cart });
  await updateBadge(cart);
}

async function saveSession(session) {
  if (session === null) await chrome.storage.local.remove(SESSION_KEY);
  else await chrome.storage.local.set({ [SESSION_KEY]: session });
}

async function updateBadge(cart) {
  const count = Array.isArray(cart) ? cart.length : 0;
  await chrome.action.setBadgeText({ text: count ? String(count) : "" });
  if (count) await chrome.action.setBadgeBackgroundColor({ color: "#0d918c" });
}

function normalizePayAllItem(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Pay All payment");

  const url = new URL(String(value.url || ""));
  if (url.protocol !== "https:") throw new Error("Pay All requires an HTTPS checkout URL");
  if (url.hostname === "xguardgate.com" || url.hostname === "www.xguardgate.com")
    throw new Error("XGuard service pages cannot be added as merchant payments");

  const amount = Number(value.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000)
    throw new Error("Invalid Pay All amount");

  const currency = String(value.currency || "USD").trim().toUpperCase();
  if (!/^[A-Z0-9]{3,8}$/.test(currency)) throw new Error("Invalid Pay All currency");

  return {
    id: crypto.randomUUID(),
    merchant: url.hostname.replace(/^www\./, "").slice(0, 180),
    title: String(value.title || url.hostname).trim().slice(0, 180),
    url: url.href,
    origin: url.origin,
    amount: amount.toFixed(2),
    currency,
    provider: String(value.provider || "generic_http").slice(0, 60),
    createdAt: new Date().toISOString(),
  };
}

async function addPayAllItem(value) {
  const item = normalizePayAllItem(value);
  const { cart, session } = await getPayAllState();
  const existing = cart.findIndex(
    (entry) =>
      entry.url === item.url &&
      entry.amount === item.amount &&
      entry.currency === item.currency,
  );

  if (existing >= 0) {
    cart[existing] = { ...cart[existing], title: item.title, createdAt: item.createdAt };
  } else {
    cart.push(item);
  }
  await saveCart(cart);
  return { cart, session, item: existing >= 0 ? cart[existing] : item };
}

async function removePayAllItem(id) {
  const { cart, session } = await getPayAllState();
  const next = cart.filter((item) => item.id !== id);
  await saveCart(next);
  return { cart: next, session };
}

async function clearPayAll() {
  await saveCart([]);
  await saveSession(null);
  return { cart: [], session: null };
}

async function startPayAll() {
  const { cart } = await getPayAllState();
  if (!cart.length) throw new Error("Pay All cart is empty");

  const session = {
    id: crypto.randomUUID(),
    status: "ACTIVE",
    itemIds: cart.map((item) => item.id),
    index: 0,
    outcomes: {},
    approvedAt: new Date().toISOString(),
  };
  await saveSession(session);
  return { cart, session, nextUrl: cart[0].url };
}

async function advancePayAll(outcome) {
  const { cart, session } = await getPayAllState();
  if (!session || session.status !== "ACTIVE") throw new Error("No active Pay All session");

  const currentId = session.itemIds[session.index];
  session.outcomes[currentId] = {
    status: String(outcome).slice(0, 24),
    at: new Date().toISOString(),
  };

  const nextIndex = session.index + 1;
  if (nextIndex >= session.itemIds.length) {
    session.status = "COMPLETED";
    session.completedAt = new Date().toISOString();
    await saveSession(session);
    return { cart, session, done: true, nextUrl: null };
  }

  session.index = nextIndex;
  const nextId = session.itemIds[nextIndex];
  const nextPayment = cart.find((item) => item.id === nextId);
  if (!nextPayment) throw new Error("Next Pay All payment is no longer in the cart");
  await saveSession(session);
  return { cart, session, done: false, nextUrl: nextPayment.url };
}

async function stopPayAll() {
  const { cart, session } = await getPayAllState();
  if (session) {
    session.status = "STOPPED";
    session.stoppedAt = new Date().toISOString();
    await saveSession(session);
  }
  return { cart, session };
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
    body: JSON.stringify({
      requestId,
      channel: "browser",
      ...sanitizeIntent(intent),
    }),
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
      throw new Error(
        "XGuard is connected, but its service balance needs a top-up. The underlying payment was not changed.",
      );
    }
    if (response.status === 401) {
      await chrome.storage.local.remove(PASS_KEY);
      throw new Error(
        "This Buyer Pass is no longer valid. Choose Use XGuard again to create a replacement.",
      );
    }
    throw new Error(
      typeof body?.error === "string"
        ? body.error
        : `XGuard returned HTTP ${response.status}`,
    );
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
  return (
    typeof value === "string" && /^xg_pass_[A-Za-z0-9_-]{40,64}$/.test(value)
  );
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
  for (const key of allowed)
    if (value[key] !== undefined) out[key] = value[key];
  return out;
}

function safeError(error) {
  return error instanceof Error && error.message
    ? error.message.slice(0, 240)
    : "XGuard request failed";
}
