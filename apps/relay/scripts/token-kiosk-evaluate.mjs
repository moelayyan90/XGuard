/**
 * Limited Token Kiosk evaluation. No production activation and no automatic topups.
 * A new, dedicated wallet is recommended. Never check in the wallet key or API key.
 * Dependencies: npm ci --prefix apps/relay
 */
import { randomBytes } from "node:crypto";
import { readFile, writeFile, rename, chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://api-token-kiosk.gaib.ai";
const KEYS = API + "/v1/auth/keys";
const MODEL = "gemini-2.5-flash";

export function prepareSiweMessage(address, at = new Date(), nonce = randomBytes(8).toString("hex")) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("EVM wallet address required.");
  if (!/^[a-zA-Z0-9]{8,}$/.test(nonce)) throw new Error("Invalid SIWE nonce.");
  return [
    "api-token-kiosk.gaib.ai wants you to sign in with your Ethereum account:",
    address, "", "Sign in to the AI Gateway", "",
    "URI: " + KEYS, "Version: 1", "Chain ID: 8453",
    "Nonce: " + nonce, "Issued At: " + at.toISOString(),
  ].join("\n");
}

export function xguardCredentialPolicy(key) {
  if (!/^sk-[A-Za-z0-9_-]+$/.test(key)) throw new Error("Invalid Token Kiosk API key.");
  return {
    provider: "custom", label: "Token Kiosk evaluation",
    value: key, header_name: "authorization", header_prefix: "Bearer ",
    allowed_hosts: ["api-token-kiosk.gaib.ai"],
    allowed_paths: ["/v1/chat/completions"], allowed_methods: ["POST"],
  };
}

async function post(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json", ...headers },
    body: JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, data };
}

async function savePrivate(file, record) {
  const temp = file + "." + randomBytes(6).toString("hex") + ".tmp";
  await writeFile(temp, JSON.stringify(record, null, 2), { mode: 0o600, flag: "wx" });
  await rename(temp, file);
  await chmod(file, 0o600);
}

export async function run(env = process.env) {
  const file = resolve(env.TOKEN_KIOSK_PRIVATE_FILE || "./token-kiosk-private.json");
  const report = { provider: "Token Kiosk", mode: "evaluation", production_active: false, topup_performed: false };
  let saved;
  try { saved = JSON.parse(await readFile(file, "utf8")); }
  catch (error) {
    if (error.code !== "ENOENT") throw new Error("Unable to inspect private state file.");
  }

  let key = saved?.key;
  if (!key) {
    if (saved?.status === "pending") throw new Error("A previous redemption might have succeeded. Reconcile the wallet before retrying.");
    const privateKey = env.TOKEN_KIOSK_WALLET_PRIVATE_KEY;
    const promoCode = env.TOKEN_KIOSK_REDEEM_CODE;
    if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey || ""))
      throw new Error("No authorized wallet signer configured. Nothing was redeemed.");
    if (!/^[A-Za-z0-9-]{6,100}$/.test(promoCode || ""))
      throw new Error("No promo code configured. Nothing was redeemed.");

    const { privateKeyToAccount } = await import("viem/accounts");
    const account = privateKeyToAccount(privateKey);
    const message = prepareSiweMessage(account.address);
    const signature = await account.signMessage({ message });
    // Write an exclusive pending marker BEFORE the only non-idempotent request.
    await writeFile(file, JSON.stringify({
      status: "pending", wallet: account.address, started_at: new Date().toISOString(),
    }, null, 2), { flag: "wx", mode: 0o600 });

    const minted = await post(KEYS, {
      message, signature, label: "xguard-secretless-egress-evaluation",
      redeem_code: promoCode, budget_usd: 5.0,
      allowed_models: [MODEL], expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    });
    if (!minted.ok || !/^sk-[A-Za-z0-9_-]+$/.test(minted.data?.key || "")) {
      // Never replay a one-time redeem operation without explicit reconciliation.
      throw new Error("Mint/redeem requires reconciliation; HTTP " + minted.status + ". Private pending marker retained.");
    }
    key = minted.data.key;
    await savePrivate(file, {
      status: "active", wallet: account.address, key, key_id: minted.data.id,
      created_at: new Date().toISOString(), budget_usd: 5,
    });
    report.key_minted = true;
    report.redeemed_credit_usdc = minted.data.redeemed_credit_usdc ?? null;
  } else {
    if (!/^sk-[A-Za-z0-9_-]+$/.test(key)) throw new Error("Stored key has an invalid format.");
    report.key_minted = false;
  }

  report.key_saved_privately = true;
  const started = performance.now();
  const test = await post(API + "/v1/chat/completions", {
    model: MODEL,
    messages: [{ role: "user", content: "Reply with the single word OK." }],
    max_tokens: 16, stream: false,
  }, { authorization: "Bearer " + key });
  report.http_status = test.status;
  report.latency_ms = Math.round(performance.now() - started);
  report.model = test.data?.model || MODEL;
  report.usage = test.data?.usage || null;
  report.inference_ok = Boolean(test.ok && Array.isArray(test.data?.choices));
  report.error_code = report.inference_ok ? null : String(test.data?.error || "UNEXPECTED_RESPONSE").slice(0, 80);

  if (report.inference_ok && env.XGUARD_EGRESS_OPERATOR_KEY) {
    const registration = await post("https://api.xguardgate.com/v1/egress/credentials",
      xguardCredentialPolicy(key), { "x-xguard-key": env.XGUARD_EGRESS_OPERATOR_KEY });
    report.xguard_credential_registered = registration.status === 201;
    report.xguard_registration_status = registration.status;
    report.xguard_credential_id = registration.status === 201 ? registration.data?.credential?.id || null : null;
  } else report.xguard_credential_registered = false;
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().then(report => console.log(JSON.stringify(report, null, 2))).catch(error => {
    console.error("Token Kiosk evaluation stopped: " + error.message);
    process.exitCode = 1;
  });
}
