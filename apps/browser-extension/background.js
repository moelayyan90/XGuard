const STORAGE_KEYS = ["xguardCart", "xguardSession"];

async function getState() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS);
  return {
    cart: Array.isArray(stored.xguardCart) ? stored.xguardCart : [],
    session: stored.xguardSession ?? null,
  };
}

async function saveCart(cart) {
  await chrome.storage.local.set({ xguardCart: cart });
  await updateBadge(cart);
}

async function saveSession(session) {
  await chrome.storage.local.set({ xguardSession: session });
}

function normalizePayment(payment) {
  const url = new URL(String(payment.url));
  const amount = Number(payment.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid payment amount");
  }

  const currency = String(payment.currency || "USD").toUpperCase().slice(0, 8);
  const title = String(payment.title || url.hostname).trim().slice(0, 160);

  return {
    id: crypto.randomUUID(),
    merchant: url.hostname.replace(/^www\./, ""),
    title,
    url: url.href,
    origin: url.origin,
    amount: amount.toFixed(2),
    currency,
    createdAt: new Date().toISOString(),
    source: "browser-extension",
  };
}

async function updateBadge(cart) {
  const count = cart.length;
  await chrome.action.setBadgeText({ text: count ? String(count) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#0f8f8d" });
}

async function addPayment(payment) {
  const normalized = normalizePayment(payment);
  const { cart } = await getState();

  const duplicateIndex = cart.findIndex(
    (item) =>
      item.url === normalized.url &&
      item.amount === normalized.amount &&
      item.currency === normalized.currency,
  );

  if (duplicateIndex >= 0) {
    cart[duplicateIndex] = {
      ...cart[duplicateIndex],
      title: normalized.title,
      createdAt: normalized.createdAt,
    };
    await saveCart(cart);
    return cart[duplicateIndex];
  }

  cart.push(normalized);
  await saveCart(cart);
  return normalized;
}

async function removePayment(id) {
  const { cart } = await getState();
  const next = cart.filter((item) => item.id !== id);
  await saveCart(next);
  return next;
}

async function clearCart() {
  await saveCart([]);
  await saveSession(null);
}

async function startPayAll(sender) {
  const { cart } = await getState();
  if (!cart.length) {
    throw new Error("XGuard Pay All cart is empty");
  }

  const session = {
    id: crypto.randomUUID(),
    status: "ACTIVE",
    itemIds: cart.map((item) => item.id),
    index: 0,
    outcomes: {},
    approvedAt: new Date().toISOString(),
  };
  await saveSession(session);

  const first = cart[0];
  if (sender?.tab?.id) {
    await chrome.tabs.update(sender.tab.id, { url: first.url, active: true });
  } else {
    await chrome.tabs.create({ url: first.url, active: true });
  }

  return session;
}

async function advanceSession(sender, outcome = "PAID") {
  const { cart, session } = await getState();
  if (!session || session.status !== "ACTIVE") {
    throw new Error("No active XGuard Pay All session");
  }

  const currentId = session.itemIds[session.index];
  session.outcomes[currentId] = {
    status: outcome,
    at: new Date().toISOString(),
  };

  const nextIndex = session.index + 1;
  if (nextIndex >= session.itemIds.length) {
    session.status = "COMPLETED";
    session.completedAt = new Date().toISOString();
    await saveSession(session);
    return { session, done: true };
  }

  session.index = nextIndex;
  await saveSession(session);

  const nextId = session.itemIds[nextIndex];
  const nextPayment = cart.find((item) => item.id === nextId);
  if (!nextPayment) {
    throw new Error("Next payment is missing from the XGuard cart");
  }

  if (sender?.tab?.id) {
    await chrome.tabs.update(sender.tab.id, { url: nextPayment.url, active: true });
  } else {
    await chrome.tabs.create({ url: nextPayment.url, active: true });
  }

  return { session, done: false, nextPayment };
}

chrome.runtime.onInstalled.addListener(async () => {
  const { cart } = await getState();
  await updateBadge(cart);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "XG_GET_STATE":
        return getState();
      case "XG_ADD_PAYMENT":
        return { payment: await addPayment(message.payment), ...(await getState()) };
      case "XG_REMOVE_PAYMENT":
        return { cart: await removePayment(message.id), session: (await getState()).session };
      case "XG_CLEAR_CART":
        await clearCart();
        return getState();
      case "XG_START_PAY_ALL":
        return { session: await startPayAll(sender) };
      case "XG_SESSION_NEXT":
        return advanceSession(sender, message.outcome || "PAID");
      case "XG_SESSION_STOP": {
        const { session } = await getState();
        if (session) {
          session.status = "STOPPED";
          session.stoppedAt = new Date().toISOString();
          await saveSession(session);
        }
        return getState();
      }
      default:
        throw new Error("Unsupported XGuard extension message");
    }
  })()
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});
