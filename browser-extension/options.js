/* global chrome, document, Headers */
const API_ORIGIN = "https://xguardgate.com";
const PASS_KEY = "xguardBuyerPass";

const connection = document.querySelector("#connection");
const balance = document.querySelector("#balance");
const refreshButton = document.querySelector("#refresh");
const amountInput = document.querySelector("#amount");
const topUpButton = document.querySelector("#topup");
const topUpResult = document.querySelector("#topup-result");
const txInput = document.querySelector("#transaction");
const claimButton = document.querySelector("#claim");
const claimStatus = document.querySelector("#claim-status");

let buyerPass = null;
let claimToken = null;

void initialize();

refreshButton.addEventListener("click", () => void refreshBalance());
topUpButton.addEventListener("click", () => void createTopUp());
claimButton.addEventListener("click", () => void claimTopUp());

async function initialize() {
  try {
    buyerPass = await ensureBuyerPass();
    connection.textContent = "Connected with a local XGuard Buyer Pass.";
    const stored = await chrome.storage.local.get("xguardNeedsTopUp");
    if (stored.xguardNeedsTopUp === true)
      connection.textContent += " Add balance below to run a paid decision.";
    await refreshBalance();
  } catch (error) {
    connection.textContent = safeError(error);
  }
}

async function ensureBuyerPass() {
  const stored = await chrome.storage.local.get(PASS_KEY);
  if (isBuyerPass(stored[PASS_KEY])) return stored[PASS_KEY];
  const response = await fetch(`${API_ORIGIN}/v1/buyer-pass`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel: "browser", label: "Browser" }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !isBuyerPass(body?.buyerPass))
    throw new Error("Could not create an XGuard Buyer Pass.");
  await chrome.storage.local.set({
    [PASS_KEY]: body.buyerPass,
    xguardBuyerPassId: body.passId,
  });
  return body.buyerPass;
}

async function refreshBalance() {
  if (!buyerPass) buyerPass = await ensureBuyerPass();
  balance.textContent = "Checking…";
  const response = await authorizedFetch("/v1/buyer-pass", { method: "GET" });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ?? "Could not read XGuard balance.");
  balance.textContent = `$${body.availableUsd ?? "0"} available`;
}

async function createTopUp() {
  try {
    topUpButton.disabled = true;
    topUpResult.textContent = "Creating top-up instructions…";
    const amountUsd = amountInput.value.trim();
    const response = await authorizedFetch("/v1/buyer-pass/topups/intents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amountUsd }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error ?? "Top-up intent failed.");
    claimToken = body.claimToken;
    topUpResult.textContent =
      `Send exactly ${body.exactDepositUsdc} USDC on Base to ${body.treasuryAddress}. ` +
      `Then paste the Base transaction hash below. The exact amount identifies this top-up.`;
  } catch (error) {
    topUpResult.textContent = safeError(error);
  } finally {
    topUpButton.disabled = false;
  }
}

async function claimTopUp() {
  try {
    if (!claimToken) throw new Error("Create a top-up instruction first.");
    const transactionHash = txInput.value.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash))
      throw new Error("Enter a valid Base transaction hash.");
    claimButton.disabled = true;
    claimStatus.textContent = "Verifying the finalized USDC transfer…";
    const response = await authorizedFetch("/v1/buyer-pass/topups/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimToken, transactionHash }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error ?? "Top-up claim failed.");
    await chrome.storage.local.set({ xguardNeedsTopUp: false });
    claimStatus.textContent = `Balance credited. $${body.availableUsd ?? "0"} is available.`;
    claimToken = null;
    txInput.value = "";
    await refreshBalance();
  } catch (error) {
    claimStatus.textContent = safeError(error);
  } finally {
    claimButton.disabled = false;
  }
}

async function authorizedFetch(path, options) {
  if (!buyerPass) buyerPass = await ensureBuyerPass();
  const headers = new Headers(options?.headers ?? {});
  headers.set("Authorization", `Bearer ${buyerPass}`);
  return fetch(`${API_ORIGIN}${path}`, { ...options, headers });
}

function isBuyerPass(value) {
  return typeof value === "string" && /^xg_pass_[A-Za-z0-9_-]{40,64}$/.test(value);
}

function safeError(error) {
  return error instanceof Error && error.message
    ? error.message.slice(0, 300)
    : "XGuard request failed";
}
