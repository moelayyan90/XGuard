import { verifyFinalizedBaseUsdcDeposit } from "./base-usdc.js";
import {
  claimTopUp,
  createTopUpIntent,
  merchantBalance,
} from "./mainnet-billing.js";
import { BASE_MAINNET, BASE_USDC } from "./mainnet-protocol.js";

const PASS_PREFIX = "xg_pass_";
const PASS_TOKEN = /^xg_pass_[A-Za-z0-9_-]{40,64}$/;
const MAX_BODY_BYTES = 16 * 1024;
const MIN_TOP_UP_MICRO_USD = 10_000;
const MAX_TOP_UP_MICRO_USD = 1_000_000_000_000;

export interface BuyerPassEnv {
  DB: D1Database;
  BASE_RPC_URL: string;
  XGUARD_TREASURY_USDC_ADDRESS: string;
}

export interface BuyerPassPrincipal {
  passId: string;
  principalId: string;
  principalName: string;
  channel: "browser" | "agent" | "api";
}

interface BuyerPassRow {
  pass_id: string;
  merchant_id: string;
  label: string;
  channel: "browser" | "agent" | "api";
}

class BuyerPassError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function buyerPassResponse(
  request: Request,
  env: BuyerPassEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/v1/buyer-pass")) return null;

  if (request.method === "OPTIONS")
    return cors(new Response(null, { status: 204 }));

  try {
    if (url.pathname === "/v1/buyer-pass" && request.method === "POST") {
      const body = await optionalJsonObject(request);
      const channel = parseChannel(body?.channel);
      const label = parseLabel(body?.label, channel);
      const created = await createBuyerPass(env.DB, label, channel);
      return privateJson(
        {
          passId: created.passId,
          buyerPass: created.token,
          principalId: created.principalId,
          label: created.label,
          channel: created.channel,
          availableMicroUsd: 0,
          heldMicroUsd: 0,
          topUp: {
            endpoint: "/v1/buyer-pass/topups/intents",
            minimumUsd: "0.01",
            network: BASE_MAINNET,
            asset: BASE_USDC,
            treasuryAddress: env.XGUARD_TREASURY_USDC_ADDRESS,
          },
          warning:
            "Store this Buyer Pass securely. XGuard stores only its SHA-256 hash and cannot recover the token.",
        },
        201,
      );
    }

    const principal = await requireBuyerPass(request, env.DB);

    if (url.pathname === "/v1/buyer-pass" && request.method === "GET") {
      const balance = await merchantBalance(env.DB, principal.principalId);
      return privateJson({
        passId: principal.passId,
        principalId: principal.principalId,
        label: principal.principalName,
        channel: principal.channel,
        availableMicroUsd: balance.availableMicroUsd,
        heldMicroUsd: balance.heldMicroUsd,
        availableUsd: microUsdToUsd(balance.availableMicroUsd),
        heldUsd: microUsdToUsd(balance.heldMicroUsd),
      });
    }

    if (
      url.pathname === "/v1/buyer-pass/topups/intents" &&
      request.method === "POST"
    ) {
      const body = await jsonObject(request);
      const requestedMicroUsd = parseBuyerTopUpAmountUsd(body.amountUsd);
      const intent = await createTopUpIntent(
        env.DB,
        principal.principalId,
        requestedMicroUsd,
      );
      return privateJson(
        {
          intentId: intent.intentId,
          claimToken: intent.claimToken,
          requestedMicroUsd,
          requestedUsd: microUsdToUsd(requestedMicroUsd),
          exactDepositMicroUsd: intent.amountMicroUsd,
          exactDepositUsdc: microUsdToUsd(intent.amountMicroUsd),
          expiresAtEpoch: intent.expiresAtEpoch,
          network: BASE_MAINNET,
          asset: BASE_USDC,
          treasuryAddress: env.XGUARD_TREASURY_USDC_ADDRESS,
          instruction:
            "Send exactly exactDepositUsdc native USDC on Base to treasuryAddress, then claim using claimToken and the transaction hash.",
        },
        201,
      );
    }

    if (
      url.pathname === "/v1/buyer-pass/topups/claim" &&
      request.method === "POST"
    ) {
      const body = await jsonObject(request);
      const claimToken = requiredString(body.claimToken, "claimToken", 128);
      const transactionHash = requiredString(
        body.transactionHash,
        "transactionHash",
        80,
      );
      if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash))
        throw new BuyerPassError("invalid_transaction_hash", 400);

      const deposit = await verifyFinalizedBaseUsdcDeposit({
        rpcUrl: env.BASE_RPC_URL,
        transactionHash,
        treasuryAddress: env.XGUARD_TREASURY_USDC_ADDRESS,
        usdcContractAddress: BASE_USDC,
      });
      const balance = await claimTopUp(env.DB, {
        merchantId: principal.principalId,
        claimToken,
        deposit,
        network: BASE_MAINNET,
        asset: BASE_USDC,
      });
      return privateJson({
        credited: true,
        availableMicroUsd: balance.availableMicroUsd,
        heldMicroUsd: balance.heldMicroUsd,
        availableUsd: microUsdToUsd(balance.availableMicroUsd),
      });
    }

    if (url.pathname === "/v1/buyer-pass/rotate" && request.method === "POST") {
      const token = createBuyerPassToken();
      const tokenHash = await sha256Hex(token);
      const result = await env.DB.prepare(
        "UPDATE buyer_passes SET token_hash=?,last_used_at=? WHERE pass_id=? AND merchant_id=? AND active=1",
      )
        .bind(
          tokenHash,
          new Date().toISOString(),
          principal.passId,
          principal.principalId,
        )
        .run();
      if ((result.meta.changes ?? 0) !== 1)
        throw new BuyerPassError("buyer_pass_unavailable", 409);
      return privateJson({
        passId: principal.passId,
        buyerPass: token,
        warning:
          "The previous Buyer Pass is invalid now. Store this replacement securely.",
      });
    }

    return privateJson({ error: "method_or_path_not_allowed" }, 405, {
      Allow: "GET, POST, OPTIONS",
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function authenticateBuyerPass(
  request: Request,
  env: Pick<BuyerPassEnv, "DB">,
): Promise<BuyerPassPrincipal | null> {
  const authorization = request.headers.get("authorization");
  if (authorization === null || !authorization.startsWith("Bearer "))
    return null;
  const token = authorization.slice("Bearer ".length).trim();
  if (!isBuyerPassToken(token)) return null;
  return authenticateBuyerPassToken(env.DB, token);
}

export async function authenticateBuyerPassToken(
  db: D1Database,
  token: string,
): Promise<BuyerPassPrincipal | null> {
  if (!isBuyerPassToken(token)) return null;
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT bp.pass_id,bp.merchant_id,bp.label,bp.channel
         FROM buyer_passes bp
         JOIN merchants m ON m.merchant_id=bp.merchant_id
        WHERE bp.token_hash=? AND bp.active=1 AND m.active=1`,
    )
    .bind(tokenHash)
    .first<BuyerPassRow>();
  if (row === null) return null;

  db.prepare("UPDATE buyer_passes SET last_used_at=? WHERE pass_id=?")
    .bind(new Date().toISOString(), row.pass_id)
    .run()
    .catch(() => undefined);

  return {
    passId: row.pass_id,
    principalId: row.merchant_id,
    principalName: row.label,
    channel: row.channel,
  };
}

export function isBuyerPassToken(value: unknown): value is string {
  return typeof value === "string" && PASS_TOKEN.test(value);
}

export function parseBuyerTopUpAmountUsd(value: unknown): number {
  if (typeof value !== "string" && typeof value !== "number")
    throw new BuyerPassError("amountUsd_required", 400);
  const text = String(value).trim();
  const match = /^(0|[1-9][0-9]{0,6})(?:\.([0-9]{1,6}))?$/.exec(text);
  if (match === null) throw new BuyerPassError("invalid_amountUsd", 400);
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(6, "0"));
  const microUsd = whole * 1_000_000 + fraction;
  if (
    !Number.isSafeInteger(microUsd) ||
    microUsd < MIN_TOP_UP_MICRO_USD ||
    microUsd > MAX_TOP_UP_MICRO_USD
  )
    throw new BuyerPassError("invalid_amountUsd", 400);
  return microUsd;
}

async function createBuyerPass(
  db: D1Database,
  label: string,
  channel: BuyerPassPrincipal["channel"],
): Promise<{
  passId: string;
  principalId: string;
  label: string;
  channel: BuyerPassPrincipal["channel"];
  token: string;
}> {
  const passId = `bp_${randomHex(16)}`;
  const merchantId = crypto.randomUUID();
  const token = createBuyerPassToken();
  const tokenHash = await sha256Hex(token);
  const internalApiKeyHash = await sha256Hex(`internal:${randomToken(48)}`);
  const createdAt = new Date().toISOString();

  await db.batch([
    db
      .prepare(
        "INSERT INTO merchants(merchant_id,name,api_key_hash,created_at) VALUES(?,?,?,?)",
      )
      .bind(merchantId, `Buyer ${label}`, internalApiKeyHash, createdAt),
    db
      .prepare(
        "INSERT INTO buyer_passes(pass_id,merchant_id,token_hash,label,channel,active,created_at,last_used_at) VALUES(?,?,?,?,?,1,?,?)",
      )
      .bind(
        passId,
        merchantId,
        tokenHash,
        label,
        channel,
        createdAt,
        createdAt,
      ),
  ]);

  return { passId, principalId: merchantId, label, channel, token };
}

async function requireBuyerPass(
  request: Request,
  db: D1Database,
): Promise<BuyerPassPrincipal> {
  const principal = await authenticateBuyerPass(request, { DB: db });
  if (principal === null)
    throw new BuyerPassError("xguard_buyer_pass_required", 401);
  return principal;
}

function parseChannel(value: unknown): BuyerPassPrincipal["channel"] {
  if (value === undefined || value === null) return "browser";
  if (value === "browser" || value === "agent" || value === "api") return value;
  throw new BuyerPassError("invalid_channel", 400);
}

function parseLabel(
  value: unknown,
  channel: BuyerPassPrincipal["channel"],
): string {
  const fallback =
    channel === "agent" ? "Agent" : channel === "api" ? "API" : "Browser";
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string") throw new BuyerPassError("invalid_label", 400);
  const label = value.trim().replace(/\s+/g, " ");
  if (label.length < 2 || label.length > 60)
    throw new BuyerPassError("invalid_label", 400);
  return label;
}

async function optionalJsonObject(
  request: Request,
): Promise<Record<string, unknown> | null> {
  if (request.body === null) return null;
  const text = await request.text();
  if (text.length === 0) return null;
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES)
    throw new BuyerPassError("request_body_too_large", 413);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BuyerPassError("invalid_json", 400);
  }
  if (!isRecord(value)) throw new BuyerPassError("json_object_required", 400);
  return value;
}

async function jsonObject(request: Request): Promise<Record<string, unknown>> {
  return (await optionalJsonObject(request)) ?? {};
}

function requiredString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string")
    throw new BuyerPassError(`${field}_required`, 400);
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > max)
    throw new BuyerPassError(`invalid_${field}`, 400);
  return normalized;
}

function createBuyerPassToken(): string {
  return `${PASS_PREFIX}${randomToken(32)}`;
}

function randomToken(bytes: number): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomHex(bytes: number): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function microUsdToUsd(value: number): string {
  const whole = Math.floor(value / 1_000_000);
  const fraction = String(value % 1_000_000)
    .padStart(6, "0")
    .replace(/0+$/g, "");
  return fraction.length === 0 ? String(whole) : `${whole}.${fraction}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function privateJson(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return cors(
    new Response(JSON.stringify(body), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        ...headers,
      },
    }),
  );
}

function errorResponse(error: unknown): Response {
  if (error instanceof BuyerPassError)
    return privateJson({ error: error.message }, error.status);
  const code = error instanceof Error ? error.message : String(error);
  if (code === "invalid_top_up_amount")
    return privateJson({ error: code }, 400);
  if (
    code === "top_up_intent_unavailable" ||
    code === "top_up_intent_expired" ||
    code === "top_up_amount_mismatch" ||
    code === "top_up_predates_intent"
  )
    return privateJson({ error: code }, 409);
  return privateJson({ error: "buyer_pass_service_unavailable" }, 503);
}

function cors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  headers.set(
    "Access-Control-Expose-Headers",
    "X-XGuard-Decision, X-XGuard-Fee-Micro-USD",
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
