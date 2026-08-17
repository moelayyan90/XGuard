/* global chrome, crypto */
const API_ORIGIN = "https://xguardgate.com";
const PASS_KEY = "xguardBuyerPass";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "XGUARD_PAYMENT_DECISION") return false;
  runDecision(message.intent)
    .then((record) => sendResponse({ ok: true, record }))
    .catch((error) => sendResponse({ ok: false, error: safeError(error) }));
  return true;
});

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
