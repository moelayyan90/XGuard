/* global chrome, crypto */
const API_ORIGIN = "https://xguardgate.com";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "XGUARD_PAYMENT_DECISION") return false;
  runDecision(message.intent)
    .then((record) => sendResponse({ ok: true, record }))
    .catch((error) => sendResponse({ ok: false, error: safeError(error) }));
  return true;
});

async function runDecision(intent) {
  const { xguardAccessKey } = await chrome.storage.local.get("xguardAccessKey");
  if (
    typeof xguardAccessKey !== "string" ||
    xguardAccessKey.trim().length < 8
  ) {
    await chrome.runtime.openOptionsPage();
    throw new Error(
      "Connect XGuard once in the extension settings, then request the check again.",
    );
  }

  const requestId = `browser:${crypto.randomUUID()}`;
  const response = await fetch(`${API_ORIGIN}/v1/payment/decision`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${xguardAccessKey.trim()}`,
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
    if (response.status === 402)
      throw new Error(
        "Your XGuard service balance is insufficient. The underlying payment was not changed.",
      );
    throw new Error(
      typeof body?.error === "string"
        ? body.error
        : `XGuard returned HTTP ${response.status}`,
    );
  }
  return body;
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
