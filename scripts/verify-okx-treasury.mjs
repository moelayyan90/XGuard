import { createHmac } from "node:crypto";

const REQUIRED_ENV = [
  "XGUARD_TREASURY_USDC_ADDRESS",
  "OKX_API_KEY",
  "OKX_API_SECRET",
  "OKX_API_PASSPHRASE",
];

for (const name of REQUIRED_ENV) {
  if (!process.env[name]?.trim()) {
    fail("missing_required_environment", { name });
  }
}

const treasury = process.env.XGUARD_TREASURY_USDC_ADDRESS.trim();
if (!/^0x[0-9a-fA-F]{40}$/.test(treasury)) {
  fail("invalid_treasury_address");
}

const baseUrl = resolveOkxBaseUrl(process.env.OKX_API_BASE_URL);
const depositAddresses = await okxGet("/api/v5/asset/deposit-address?ccy=USDC");
const baseAddresses = depositAddresses.filter(
  (row) =>
    row &&
    typeof row === "object" &&
    String(row.ccy ?? "").toUpperCase() === "USDC" &&
    isBaseChain(row.chain) &&
    typeof row.addr === "string",
);

if (baseAddresses.length === 0) {
  fail("okx_usdc_base_address_not_available");
}

const matchingAddress = baseAddresses.find(
  (row) => row.addr.toLowerCase() === treasury.toLowerCase(),
);
if (!matchingAddress) {
  fail("treasury_does_not_match_okx_usdc_base", {
    returnedBaseAddressCount: baseAddresses.length,
  });
}

const currencies = await okxGet("/api/v5/asset/currencies?ccy=USDC");
const baseCurrency = currencies.find(
  (row) =>
    row &&
    typeof row === "object" &&
    String(row.ccy ?? "").toUpperCase() === "USDC" &&
    isBaseChain(row.chain),
);

if (!baseCurrency) {
  fail("okx_usdc_base_currency_not_available");
}
if (baseCurrency.canDep !== true) {
  fail("okx_usdc_base_deposits_not_available", {
    estimatedOpenTime: String(baseCurrency.depEstOpenTime ?? ""),
  });
}

console.log(
  JSON.stringify({
    event: "okx_treasury_verification",
    verified: true,
    provider: "OKX",
    asset: "USDC",
    network: "Base",
    depositsAvailable: true,
    beneficiaryAccount: String(matchingAddress.to ?? ""),
    selectedInOkxUi: matchingAddress.selected === true,
    treasuryFingerprint: `${treasury.slice(0, 6)}...${treasury.slice(-6)}`,
    apiHost: new URL(baseUrl).hostname,
  }),
);

async function okxGet(requestPath) {
  const timestamp = new Date().toISOString();
  const signature = createHmac("sha256", process.env.OKX_API_SECRET)
    .update(`${timestamp}GET${requestPath}`)
    .digest("base64");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${baseUrl}${requestPath}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "OK-ACCESS-KEY": process.env.OKX_API_KEY,
        "OK-ACCESS-SIGN": signature,
        "OK-ACCESS-TIMESTAMP": timestamp,
        "OK-ACCESS-PASSPHRASE": process.env.OKX_API_PASSPHRASE,
      },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      fail("okx_http_error", { status: response.status });
    }
    const payload = await response.json();
    if (!payload || payload.code !== "0" || !Array.isArray(payload.data)) {
      fail("okx_api_error", {
        code: String(payload?.code ?? "unknown"),
        message: String(payload?.msg ?? "unknown"),
      });
    }
    return payload.data;
  } catch (error) {
    if (error?.name === "AbortError") fail("okx_request_timeout");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function isBaseChain(value) {
  const chain = String(value ?? "").trim().toLowerCase();
  return chain === "usdc-base" || chain.endsWith("-base");
}

function resolveOkxBaseUrl(value) {
  const raw = value?.trim() || "https://openapi.okx.com";
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail("invalid_okx_api_base_url");
  }
  const allowedHosts = new Set([
    "openapi.okx.com",
    "www.okx.com",
    "us.okx.com",
    "eea.okx.com",
    "tr.okx.com",
  ]);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !allowedHosts.has(url.hostname)
  ) {
    fail("untrusted_okx_api_base_url");
  }
  return url.origin;
}

function fail(code, details = {}) {
  console.error(
    JSON.stringify({
      event: "okx_treasury_verification",
      verified: false,
      code,
      ...details,
    }),
  );
  process.exit(1);
}
