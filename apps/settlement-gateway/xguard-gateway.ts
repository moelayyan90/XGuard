/**
 * XGuard settlement-truth gateway — Cloudflare Workers + SQLite Durable Objects.
 *
 * Install: npm ci; npm run check; npm test. See wrangler.jsonc and DEPLOY.md.
 * XGUARD_ORIGIN must be a PRIVATE, read-only service binding. The gateway
 * never forwards caller Authorization, Payment-Signature, cookies or Host.
 * Put BASE_RPC_URL and (optional) WEB2_TOKEN_SECRET in Wrangler secrets.
 * XPAY_AUTHORIZATION, if required by your xpay account, is a secret containing
 * the complete Authorization value. No wallet private key is used here.
 *
 * Web3: claim -> xpay verify -> prepare bounded GET privately -> journal intent
 * -> one xpay settle attempt -> independently confirm Base receipt -> deliver.
 * Web2: verify signed capability -> atomic credit hold -> prepare GET ->
 * atomically commit hold and result -> deliver. A failed read releases the hold.
 *
 * The atomic sections contain no await or external I/O. The bounded RAM cache
 * accelerates completed retries. SQLite, not RAM, is the durable authority.
 */
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import {
  decodeEventLog, http, createPublicClient, getAddress, parseAbiItem,
  recoverTypedDataAddress, type Address, type Hex,
} from "viem";
import { base } from "viem/chains";

export interface Env {
  XGUARD_STATE: DurableObjectNamespace<XGuardState>;
  XGUARD_ORIGIN: Fetcher;
  GATEWAY_ENABLED: string;
  PUBLIC_ORIGIN: string;
  MERCHANT_ID: string;
  PAY_TO: string;
  BASE_RPC_URL: string;
  BASE_CONFIRMATIONS?: string;
  XPAY_AUTHORIZATION?: string;
  WEB2_TOKEN_SECRET?: string;
  GATEWAY_TELEMETRY?: AnalyticsEngineDataset;
  GATEWAY_LIMIT?: { limit(input: { key: string }): Promise<{ success: boolean }> };
}

const NETWORK = "eip155:8453";
const USDC = getAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
const XPAY = "https://facilitator.xpay.sh";
const PRICE = 1000; // USDC atoms / USD microcredits; 0.001 per completed job.
const MAX_TIMEOUT = 300;
const BODY_LIMIT = 64 * 1024;
const LEASE_MS = 35_000;
const RETAIN_MS = 60 * 60 * 1000; // Exact recovery window, even across restarts.
const RECONCILE_MS = 5_000;
const MAX_BALANCE = 1_000_000_000_000;
const ZERO_ADDRESS = "0x" + "0".repeat(40);
const AUTH_USED = parseAbiItem("event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)");
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const EIP3009 = {
  TransferWithAuthorization: [
    { name: "from", type: "address" }, { name: "to", type: "address" },
    { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
  ],
} as const;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
const labels = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
const idemFormat = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,95}$/;
const nonces = /^0x[0-9a-fA-F]{64}$/;
const decimal = /^(0|[1-9][0-9]{0,12})$/;
const b64url = /^[A-Za-z0-9_-]+$/;

class GatewayError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
function reject(status: number, code: string): never { throw new GatewayError(status, code); }
function record(input: unknown): Record<string, unknown> {
  return input !== null && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown> : {};
}
function addr(v: unknown): Address {
  if (typeof v !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(v) || v.toLowerCase() === ZERO_ADDRESS) {
    reject(402, "invalid_address");
  }
  return getAddress(v.toLowerCase());
}
function hex32(v: unknown): Hex | undefined {
  return typeof v === "string" && nonces.test(v) ? v.toLowerCase() as Hex : undefined;
}
function config(env: Env) {
  if (env.GATEWAY_ENABLED !== "true") reject(503, "gateway_disabled");
  const origin = new URL(env.PUBLIC_ORIGIN);
  if (origin.protocol !== "https:" || origin.origin !== env.PUBLIC_ORIGIN ||
      typeof env.MERCHANT_ID !== "string" || !labels.test(env.MERCHANT_ID)) {
    reject(503, "invalid_gateway_config");
  }
  let payTo: Address;
  try { payTo = addr(env.PAY_TO); } catch { reject(503, "invalid_merchant_wallet"); }
  const confirmations = Number(env.BASE_CONFIRMATIONS ?? "12");
  if (!Number.isSafeInteger(confirmations) || confirmations < 2 || confirmations > 120) {
    reject(503, "invalid_confirmation_policy");
  }
  return { origin: origin.origin, merchant: env.MERCHANT_ID, payTo, confirmations };
}
type Config = ReturnType<typeof config>;

function encode64(bytes: Uint8Array): string {
  let result = "";
  for (let i = 0; i < bytes.length; i++) result += String.fromCharCode(bytes[i]!);
  return btoa(result);
}
function decode64(value: string, max: number): Uint8Array<ArrayBuffer> {
  if (!value.length || value.length > max || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    reject(402, "invalid_payment_encoding");
  }
  try { return Uint8Array.from(atob(value), (c) => c.charCodeAt(0)); }
  catch { reject(402, "invalid_payment_encoding"); }
}
function encodeUrl(bytes: Uint8Array): string {
  return encode64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function decodeUrl(s: string, max: number): Uint8Array<ArrayBuffer> {
  if (!b64url.test(s) || s.length > max) reject(402, "invalid_token_encoding");
  const bytes = decode64(s.replaceAll("-", "+").replaceAll("_", "/"), max);
  if (encodeUrl(bytes) !== s) reject(402, "noncanonical_token");
  return bytes;
}
async function sha(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(hash), (v) => v.toString(16).padStart(2, "0")).join("");
}
function b64JSON(value: unknown) { return encode64(encoder.encode(JSON.stringify(value))); }
async function readLimited(response: Response, max: number): Promise<string> {
  if (!response.body) reject(502, "empty_dependency_response");
  const reader = response.body.getReader();
  const data = new Uint8Array(max);
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (next.value.length + bytes > max) reject(502, "dependency_response_too_large");
      data.set(next.value, bytes);
      bytes += next.value.length;
    }
    return decoder.decode(data.subarray(0, bytes));
  } finally { void reader.cancel().catch(() => undefined); }
}
function json(body: unknown, status: number, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", ...headers,
  } });
}

type Rail = "base" | "credits";
type Phase = "working" | "settling" | "done" | "retry";
type Intent = {
  id: string; wallet: Address; merchant: string; account: string; rail: Rail;
  idem: string; binding: string; validBefore: number;
};
type Row = {
  id: string; wallet: string; merchant: string; account: string; rail: Rail;
  idem: string; binding: string; phase: Phase; owner: string;
  lease: number; expires: number; held: number; body: string | null;
  hash: string | null; startBlock: string | null;
};
type Completed = { kind: "done"; body: string; hash: string | null };
type Claim = Completed
  | { kind: "work"; owner: string }
  | { kind: "reconcile"; owner: string; hash: string | null; startBlock: string }
  | { kind: "busy" | "conflict" | "expired" | "insufficient" };
type Credit = {
  wallet: Address; merchant: string; account: string;
  provider: "stripe" | "lemon_squeezy"; paymentId: string; amount: number;
};

/** All calls are RPC via trusted bindings. No HTTP method or public DO route. */
export class XGuardState extends DurableObject<Env> {
  private readonly hot = new Map<string, { binding: string; expires: number; value: Completed }>();
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS jobs(
        id TEXT PRIMARY KEY, wallet TEXT NOT NULL, merchant TEXT NOT NULL,
        account TEXT NOT NULL, rail TEXT NOT NULL, idem TEXT NOT NULL,
        binding TEXT NOT NULL, phase TEXT NOT NULL, owner TEXT NOT NULL,
        lease INTEGER NOT NULL, expires INTEGER NOT NULL, held INTEGER NOT NULL,
        body TEXT, hash TEXT, startBlock TEXT,
        UNIQUE(merchant,rail,account,idem)
      );
      CREATE INDEX IF NOT EXISTS jobs_wallet_merchant ON jobs(wallet,merchant);
      CREATE INDEX IF NOT EXISTS jobs_expiry ON jobs(expires);
      CREATE TABLE IF NOT EXISTS balances(
        merchant TEXT NOT NULL, account TEXT NOT NULL,
        available INTEGER NOT NULL CHECK(available>=0),
        held INTEGER NOT NULL CHECK(held>=0), PRIMARY KEY(merchant,account)
      );
      CREATE TABLE IF NOT EXISTS grants(
        id TEXT PRIMARY KEY, binding TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS journal(
        id TEXT PRIMARY KEY, wallet TEXT NOT NULL, merchant TEXT NOT NULL,
        account TEXT NOT NULL, rail TEXT NOT NULL, idem TEXT NOT NULL,
        binding TEXT NOT NULL, amount INTEGER NOT NULL, phase TEXT NOT NULL,
        started INTEGER NOT NULL, startBlock TEXT, hash TEXT,
        UNIQUE(merchant,rail,account,idem)
      );
    `);
  }

  private row(id: string): Row | undefined {
    return this.ctx.storage.sql.exec<Row>("SELECT * FROM jobs WHERE id=?", id).toArray()[0];
  }

  // A bounded indexed sweep on fresh traffic; no perpetual alarm, table scan,
  // or cross-wallet coordinator. Dormant shards retain expired rows until
  // their next request. Never call deleteAll() on a financial namespace.
  private prune(now: number) {
    const sql = this.ctx.storage.sql;
    const expired = sql.exec<Pick<Row, "id" | "merchant" | "account" | "held">>(
      "SELECT id,merchant,account,held FROM jobs WHERE expires<=? ORDER BY expires LIMIT 8", now,
    ).toArray();
    for (const job of expired) {
      if (job.held) sql.exec("UPDATE balances SET available=available+?,held=held-? WHERE merchant=? AND account=?",
        job.held, job.held, job.merchant, job.account);
      sql.exec("DELETE FROM jobs WHERE id=?", job.id);
      this.hot.delete(job.id);
    }
  }

  claim(i: Intent): Claim {
    const now = Date.now();
    const cached = this.hot.get(i.id);
    if (cached && cached.expires > now && cached.binding === i.binding) return cached.value;
    return this.ctx.storage.transactionSync((): Claim => {
      const sql = this.ctx.storage.sql;
      const existing = this.row(i.id);
      if (existing && (existing.binding !== i.binding || existing.wallet !== i.wallet ||
          existing.merchant !== i.merchant || existing.account !== i.account)) return { kind: "conflict" };
      if (existing && existing.expires <= now) {
        this.prune(now);
        return { kind: "expired" };
      }
      if (existing?.phase === "done" && existing.body !== null) {
        const value: Completed = { kind: "done", body: existing.body, hash: existing.hash };
        if (this.hot.size >= 12) {
          const oldest = this.hot.keys().next().value;
          if (oldest !== undefined) this.hot.delete(oldest);
        }
        this.hot.set(i.id, { binding: i.binding, expires: existing.expires, value });
        return value;
      }
      if (existing && existing.lease > now) return { kind: "busy" };
      const owner = crypto.randomUUID();
      if (existing?.phase === "settling" && existing.startBlock !== null) {
        sql.exec("UPDATE jobs SET owner=?,lease=? WHERE id=?", owner, now + LEASE_MS, i.id);
        return { kind: "reconcile", owner, hash: existing.hash, startBlock: existing.startBlock };
      }
      if (i.rail === "base" && i.validBefore * 1000 <= now + 4000) return { kind: "expired" };
      this.prune(now);
      // Financial tombstones outlive the short-lived response cache.
      const prior = !existing && sql.exec<{ binding: string }>(
        "SELECT binding FROM journal WHERE id=? OR (merchant=? AND rail=? AND account=? AND idem=?) LIMIT 1",
        i.id, i.merchant, i.rail, i.account, i.idem,
      ).toArray()[0];
      if (prior) return { kind: prior.binding === i.binding ? "expired" : "conflict" };
      const other = sql.exec<{ id: string }>(
        "SELECT id FROM jobs WHERE merchant=? AND rail=? AND account=? AND idem=?",
        i.merchant, i.rail, i.account, i.idem,
      ).toArray()[0];
      if (other && other.id !== i.id) return { kind: "conflict" };
      let held = existing?.held ?? 0;
      if (i.rail === "credits" && held === 0) {
        const changed = sql.exec<{ available: number }>(
          "UPDATE balances SET available=available-?, held=held+? WHERE merchant=? AND account=? AND available>=? RETURNING available",
          PRICE, PRICE, i.merchant, i.account, PRICE,
        ).toArray();
        if (!changed.length) return { kind: "insufficient" };
        held = PRICE;
      }
      if (existing) {
        sql.exec("UPDATE jobs SET phase='working',owner=?,lease=?,held=? WHERE id=?",
          owner, now + LEASE_MS, held, i.id);
      } else {
        sql.exec(`INSERT INTO jobs(id,wallet,merchant,account,rail,idem,binding,phase,owner,lease,expires,held)
                  VALUES(?,?,?,?,?,?,?,'working',?,?,?,?)`,
          i.id, i.wallet, i.merchant, i.account, i.rail, i.idem, i.binding, owner,
          now + LEASE_MS, now + RETAIN_MS, held);
      }
      return { kind: "work", owner };
    });
  }

  release(id: string, owner: string): void {
    this.ctx.storage.transactionSync(() => {
      const job = this.row(id);
      if (!job || job.owner !== owner || job.phase !== "working") return;
      const sql = this.ctx.storage.sql;
      if (job.held) sql.exec("UPDATE balances SET available=available+?,held=held-? WHERE merchant=? AND account=?",
        job.held, job.held, job.merchant, job.account);
      sql.exec("UPDATE jobs SET phase='retry',held=0,lease=0 WHERE id=?", id);
    });
  }

  /** The only transition that grants permission to call /settle. */
  startSettlement(id: string, owner: string, body: string, startBlock: string): boolean {
    return this.ctx.storage.transactionSync(() => {
      const now = Date.now();
      const sql = this.ctx.storage.sql;
      const updated = sql.exec<{ id: string }>(
        "UPDATE jobs SET phase='settling',body=?,startBlock=?,lease=? WHERE id=? AND owner=? AND rail='base' AND phase='working' AND lease>? AND expires>? RETURNING id",
        body, startBlock, now + LEASE_MS, id, owner, now, now,
      ).toArray();
      if (!updated.length) return false;
      sql.exec("INSERT INTO journal SELECT id,wallet,merchant,account,rail,idem,binding,?,'settling',?,startBlock,NULL FROM jobs WHERE id=?",
        PRICE, now, id);
      return true;
    });
  }

  /** Persist a facilitator hint, never classify it as a receipt. */
  deferSettlement(id: string, owner: string, hash: string | null): void {
    this.ctx.storage.transactionSync(() => {
      const now = Date.now(), sql = this.ctx.storage.sql;
      const updated = sql.exec<{ id: string }>(
        "UPDATE jobs SET hash=COALESCE(?,hash),lease=? WHERE id=? AND owner=? AND phase='settling' AND expires>? RETURNING id",
        hash, now + RECONCILE_MS, id, owner, now,
      ).toArray();
      if (hash && updated.length) sql.exec("UPDATE journal SET hash=? WHERE id=? AND hash IS NULL", hash, id);
    });
  }

  finishChain(id: string, owner: string, hash: string): Completed | null {
    return this.ctx.storage.transactionSync(() => {
      const now = Date.now();
      const rows = this.ctx.storage.sql.exec<{ body: string | null }>(
        "UPDATE jobs SET phase='done',hash=?,lease=0 WHERE id=? AND owner=? AND phase='settling' AND rail='base' AND lease>? AND expires>? RETURNING body",
        hash, id, owner, now, now,
      ).toArray();
      const row = rows[0];
      if (!row) return null;
      if (row.body === null) throw new Error("missing_prepared_result");
      this.ctx.storage.sql.exec("UPDATE journal SET phase='done',hash=? WHERE id=?", hash, id);
      return { kind: "done", body: row.body, hash };
    });
  }

  finishCredits(id: string, owner: string, body: string): Completed | null {
    return this.ctx.storage.transactionSync(() => {
      const job = this.row(id);
      const now = Date.now();
      if (!job || job.owner !== owner || job.phase !== "working" || job.rail !== "credits" ||
          job.held !== PRICE || job.lease <= now || job.expires <= now) return null;
      const sql = this.ctx.storage.sql;
      const updated = sql.exec<{ held: number }>(
        "UPDATE balances SET held=held-? WHERE merchant=? AND account=? AND held>=? RETURNING held",
        PRICE, job.merchant, job.account, PRICE,
      ).toArray();
      if (!updated.length) throw new Error("credit_invariant");
      sql.exec("UPDATE jobs SET phase='done',held=0,lease=0,body=? WHERE id=?", body, id);
      sql.exec("INSERT INTO journal SELECT id,wallet,merchant,account,rail,idem,binding,?,'done',?,NULL,NULL FROM jobs WHERE id=?",
        PRICE, now, id);
      return { kind: "done", body, hash: null };
    });
  }

  // Funding is first bound on the canonical provider-ID shard, then applied
  // idempotently on the wallet shard. A retry after either commit is safe.
  bindFunding(id: string, binding: string): boolean {
    return this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      const existing = sql.exec<{ binding: string }>("SELECT binding FROM grants WHERE id=?", id).toArray()[0];
      if (existing) return existing.binding === binding;
      sql.exec("INSERT INTO grants VALUES(?,?)", id, binding);
      return true;
    });
  }

  addCredit(id: string, binding: string, credit: Credit): "credited" | "duplicate" | "conflict" | "cap" {
    return this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      const prior = sql.exec<{ binding: string }>("SELECT binding FROM grants WHERE id=?", id).toArray()[0];
      if (prior) return prior.binding === binding ? "duplicate" : "conflict";
      const balance = sql.exec<{ available: number; held: number }>(
        "SELECT available,held FROM balances WHERE merchant=? AND account=?", credit.merchant, credit.account,
      ).toArray()[0];
      if ((balance?.available ?? 0) + (balance?.held ?? 0) + credit.amount > MAX_BALANCE) return "cap";
      sql.exec(`INSERT INTO balances(merchant,account,available,held) VALUES(?,?,?,0)
                ON CONFLICT(merchant,account) DO UPDATE SET available=available+excluded.available`,
        credit.merchant, credit.account, credit.amount);
      sql.exec("INSERT INTO grants VALUES(?,?)", id, binding);
      return "credited";
    });
  }
}

function walletState(env: Env, wallet: Address) {
  return env.XGUARD_STATE.getByName("wallet:base-usdc:v1:" + wallet.toLowerCase());
}

type Identity = { wallet: Address; merchant: string; account: string };
type Claims = Identity & { aud: string; iat: number; exp: number };

function identity(v: unknown, cfg: Config): Identity {
  const p = record(v);
  if (p.merchant !== cfg.merchant || typeof p.account !== "string" || !labels.test(p.account)) {
    reject(402, "invalid_credit_identity");
  }
  return { wallet: addr(p.wallet), merchant: cfg.merchant, account: p.account };
}
async function tokenKey(env: Env) {
  if (!env.WEB2_TOKEN_SECRET) reject(402, "credit_rail_disabled");
  const key = decodeUrl(env.WEB2_TOKEN_SECRET, 86);
  if (key.byteLength < 32) reject(503, "invalid_credit_key_configuration");
  return crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function authenticate(token: string, env: Env, cfg: Config): Promise<Identity> {
  const [version, payload, signature, ...rest] = token.split(".");
  if (version !== "xg1" || !payload || !signature || rest.length) reject(402, "invalid_credit_token");
  const bytes = decodeUrl(payload, 2048);
  const sig = decodeUrl(signature, 43);
  if (sig.byteLength !== 32 ||
      !await crypto.subtle.verify("HMAC", await tokenKey(env), sig, encoder.encode("xg1." + payload))) {
    reject(402, "invalid_credit_token");
  }
  let p: Record<string, unknown>;
  try { p = record(JSON.parse(decoder.decode(bytes))); } catch { reject(402, "invalid_credit_token"); }
  const now = Math.floor(Date.now() / 1000);
  if (p.aud !== cfg.origin || typeof p.iat !== "number" || typeof p.exp !== "number" ||
      !Number.isSafeInteger(p.iat) || !Number.isSafeInteger(p.exp) ||
      p.iat > now + 5 || p.exp <= now || p.exp <= p.iat || p.exp - p.iat > 900) {
    reject(402, "expired_or_wrong_audience");
  }
  return identity(p, cfg);
}

/**
 * Bind ONLY a trusted billing Worker to this named RPC entrypoint.
 * Stripe/Lemon Squeezy adapter must verify the provider's webhook signature,
 * confirm actual paid USD funds and resolve account/wallet server-side.
 * Use canonical PaymentIntent/order ID, not event-delivery ID. No public
 * credit or token endpoint is exposed here. Refund/chargeback policy belongs
 * in that billing Worker before it enables funding.
 */
export class XGuardCredits extends WorkerEntrypoint<Env> {
  async credit(input: Credit) {
    const cfg = config(this.env);
    const who = identity(input, cfg);
    if (!this.env.WEB2_TOKEN_SECRET || !["stripe", "lemon_squeezy"].includes(input.provider) ||
        typeof input.paymentId !== "string" || !labels.test(input.paymentId) || !Number.isSafeInteger(input.amount) ||
        input.amount < PRICE || input.amount > MAX_BALANCE) reject(400, "invalid_funding");
    const grant: Credit = { ...who, provider: input.provider, paymentId: input.paymentId, amount: input.amount };
    const id = await sha(input.provider + ":" + input.paymentId);
    const binding = await sha(JSON.stringify(grant));
    const funding = this.env.XGUARD_STATE.getByName("funding:v1:" + id.slice(0, 3));
    if (!await funding.bindFunding(id, binding)) return "conflict";
    return walletState(this.env, who.wallet).addCredit(id, binding, grant);
  }

  async issueToken(input: Identity): Promise<string> {
    const cfg = config(this.env);
    const iat = Math.floor(Date.now() / 1000);
    const claims: Claims = { ...identity(input, cfg), aud: cfg.origin, iat, exp: iat + 900 };
    const payload = "xg1." + encodeUrl(encoder.encode(JSON.stringify(claims)));
    const sig = await crypto.subtle.sign("HMAC", await tokenKey(this.env), encoder.encode(payload));
    return payload + "." + encodeUrl(new Uint8Array(sig));
  }
}

type Requirement = {
  scheme: "exact"; network: typeof NETWORK; asset: Address; amount: string; payTo: Address;
  maxTimeoutSeconds: number; extra: { name: "USD Coin"; version: "2" };
};
type Auth = { from: Address; to: Address; value: string; validAfter: string; validBefore: string; nonce: Hex };
type Payment = { x402Version: 2; resource: { url: string; description: string; mimeType: string };
  accepted: Requirement; payload: { authorization: Auth; signature: Hex } };
function challenge(cfg: Config, resource: string) {
  const requirement: Requirement = {
    scheme: "exact", network: NETWORK, asset: USDC, amount: String(PRICE), payTo: cfg.payTo,
    maxTimeoutSeconds: MAX_TIMEOUT, extra: { name: "USD Coin", version: "2" },
  };
  return { x402Version: 2 as const,
    resource: { url: resource, description: "XGuard verified fact read", mimeType: "application/json" },
    accepts: [requirement] as [Requirement] };
}

async function parsePayment(raw: string, offer: ReturnType<typeof challenge>): Promise<Payment> {
  let p: Record<string, unknown>;
  try { p = record(JSON.parse(decoder.decode(decode64(raw, 12_000)))); }
  catch { reject(402, "malformed_payment"); }
  const expected = offer.accepts[0];
  const a = record(p.accepted);
  const extra = record(a.extra);
  const resource = record(p.resource);
  if (p.x402Version !== 2 || a.scheme !== "exact" || a.network !== NETWORK ||
      addr(a.asset) !== USDC || addr(a.payTo) !== expected.payTo ||
      a.amount !== expected.amount || a.maxTimeoutSeconds !== MAX_TIMEOUT ||
      extra.name !== "USD Coin" || extra.version !== "2" ||
      (extra.assetTransferMethod !== undefined && extra.assetTransferMethod !== "eip3009") ||
      (p.resource !== undefined && resource.url !== offer.resource.url)) reject(402, "wrong_payment_requirements");
  const payload = record(p.payload);
  const b = record(payload.authorization);
  const nonce = hex32(b.nonce);
  if (!nonce || typeof b.validAfter !== "string" || !decimal.test(b.validAfter) ||
      typeof b.validBefore !== "string" || !decimal.test(b.validBefore) ||
      b.value !== expected.amount || typeof payload.signature !== "string" ||
      !/^0x[0-9a-fA-F]{128}(1b|1c|00|01)$/i.test(payload.signature)) reject(402, "malformed_authorization");
  const from = addr(b.from), to = addr(b.to);
  const now = Math.floor(Date.now() / 1000);
  if (from === to || to !== expected.payTo || Number(b.validAfter) > now ||
      Number(b.validBefore) <= Number(b.validAfter) ||
      Number(b.validBefore) > now + MAX_TIMEOUT + 30) reject(402, "invalid_authorization_scope");
  const authorization: Auth = { from, to, value: String(PRICE), validAfter: b.validAfter, validBefore: b.validBefore, nonce };
  const signature = payload.signature as Hex;
  let recovered: Address;
  try {
    recovered = await recoverTypedDataAddress({
      domain: { name: "USD Coin", version: "2", chainId: base.id, verifyingContract: USDC },
      types: EIP3009, primaryType: "TransferWithAuthorization",
      message: { ...authorization, value: BigInt(PRICE),
        validAfter: BigInt(b.validAfter), validBefore: BigInt(b.validBefore) },
      signature,
    });
  } catch { reject(402, "invalid_authorization_signature"); }
  if (recovered !== from) reject(402, "signer_does_not_match_wallet");
  return { x402Version: 2, resource: offer.resource, accepted: expected, payload: { authorization, signature } };
}

async function xpay(env: Env, step: "verify" | "settle", payment: Payment) {
  const headers = new Headers({ "Content-Type": "application/json", "Accept": "application/json" });
  if (env.XPAY_AUTHORIZATION) headers.set("Authorization", env.XPAY_AUTHORIZATION);
  const result = await fetch(XPAY + "/" + step, {
    method: "POST", headers, redirect: "manual", signal: AbortSignal.timeout(7_000),
    body: JSON.stringify({ x402Version: 2, paymentPayload: payment, paymentRequirements: payment.accepted }),
  });
  // Provider errors must not be passed to callers or used as settlement proof.
  if (!result.ok) {
    if (step === "verify" && [400, 402, 422].includes(result.status)) reject(402, "payment_not_verified");
    reject(503, "facilitator_unavailable");
  }
  return record(JSON.parse(await readLimited(result, 16 * 1024)));
}

function baseClient(env: Env) {
  const url = new URL(env.BASE_RPC_URL);
  if (url.protocol !== "https:" || url.username || url.password) reject(503, "invalid_base_rpc");
  return createPublicClient({ chain: base, transport: http(url.href, {
    retryCount: 0, timeout: 5_000, fetchOptions: { redirect: "manual" },
  }), cacheTime: 0 });
}
type BaseClient = ReturnType<typeof baseClient>;

async function receiptTruth(client: BaseClient, cfg: Config, auth: Auth, hash: Hex, startBlock: bigint): Promise<boolean> {
  const [receipt, latest] = await Promise.all([
    client.getTransactionReceipt({ hash }), client.getBlockNumber({ cacheTime: 0 }),
  ]);
  if (receipt.status !== "success" || receipt.transactionHash.toLowerCase() !== hash ||
      receipt.blockNumber < startBlock || latest < receipt.blockNumber ||
      latest - receipt.blockNumber + 1n < BigInt(cfg.confirmations)) return false;
  const canonical = await client.getBlock({ blockNumber: receipt.blockNumber, includeTransactions: false });
  if (canonical.hash !== receipt.blockHash) return false;
  // Circle's EIP-3009 implementation emits AuthorizationUsed immediately before
  // the transfer. Pair adjacent USDC logs: matching unrelated events elsewhere
  // in a multi-transfer receipt are NOT acceptable evidence.
  for (let i = 0; i + 1 < receipt.logs.length; i++) {
    const used = receipt.logs[i]!, transfer = receipt.logs[i + 1]!;
    if (used.address.toLowerCase() !== USDC.toLowerCase() || transfer.address.toLowerCase() !== USDC.toLowerCase() ||
        used.logIndex === null || transfer.logIndex !== used.logIndex + 1 || used.removed || transfer.removed) continue;
    try {
      const u = decodeEventLog({ abi: [AUTH_USED], data: used.data, topics: used.topics });
      const t = decodeEventLog({ abi: [TRANSFER], data: transfer.data, topics: transfer.topics });
      if (u.args.authorizer.toLowerCase() === auth.from.toLowerCase() && u.args.nonce.toLowerCase() === auth.nonce &&
          t.args.from.toLowerCase() === auth.from.toLowerCase() && t.args.to.toLowerCase() === auth.to.toLowerCase() &&
          t.args.value === BigInt(PRICE)) return true;
    } catch { /* Different token log. Continue without exposing provider data. */ }
  }
  return false;
}

async function reconcile(client: BaseClient, cfg: Config, auth: Auth, hint: string | null, start: string): Promise<Hex | null> {
  const fromBlock = BigInt(start);
  const hinted = hex32(hint);
  if (hinted) {
    try { if (await receiptTruth(client, cfg, auth, hinted, fromBlock)) return hinted; } catch { /* Recover by nonce. */ }
  }
  const latest = await client.getBlockNumber({ cacheTime: 0 });
  const toBlock = latest < fromBlock + 1023n ? latest : fromBlock + 1023n;
  if (toBlock < fromBlock) return null;
  const logs = await client.getLogs({ address: USDC, event: AUTH_USED,
    args: { authorizer: auth.from, nonce: auth.nonce }, fromBlock, toBlock, strict: true });
  for (const event of logs.slice(0, 4)) {
    const hash = hex32(event.transactionHash);
    if (hash && !event.removed && await receiptTruth(client, cfg, auth, hash, fromBlock)) return hash;
  }
  return null;
}

type Route = { resource: string; upstream: string; group: "fact" | "status" | "index" };
function route(request: Request, cfg: Config): Route {
  const url = new URL(request.url);
  if (url.origin !== cfg.origin) reject(404, "unknown_host");
  if (request.method !== "GET" || request.body !== null) reject(405, "get_required");
  // URL normalization is intentionally narrow. No proxy URL, traversal,
  // arbitrary headers, alternate formats, or unrecognized query parameters.
  if (url.pathname.length > 512 || (url.search && url.search !== "?format=json")) reject(400, "unsupported_url");
  const fact = /^\/(?:fact|live|history|changes|evidence)\/[A-Za-z0-9][A-Za-z0-9_.-]{0,95}(?:\/[@A-Za-z0-9][A-Za-z0-9_.-]{0,95}){1,8}$/.test(url.pathname);
  const status = ["/healthz", "/status"].includes(url.pathname);
  const index = ["/topics", "/changes"].includes(url.pathname) ||
    /^\/topics\/[a-z0-9-]{1,64}(?:\/page\/[1-9][0-9]{0,4})?$/.test(url.pathname);
  if (!fact && !status && !index) reject(404, "route_not_allowed");
  return { resource: cfg.origin + url.pathname + url.search,
    upstream: url.pathname + (url.pathname === "/healthz" ? "" : "?format=json"),
    group: fact ? "fact" : status ? "status" : "index" };
}

async function prepareFacts(env: Env, r: Route): Promise<string> {
  // The authority here is only the service binding, never public DNS.
  const origin = await env.XGUARD_ORIGIN.fetch(new Request("https://xguard-origin.internal" + r.upstream, {
    method: "GET", headers: { Accept: "application/json" }, redirect: "manual",
    signal: AbortSignal.timeout(8_000),
  }));
  if (origin.status !== 200 || !/^application\/(?:json|[a-z0-9.+-]+\+json)(?:;|$)/i.test(origin.headers.get("Content-Type") ?? "")) {
    void origin.body?.cancel().catch(() => undefined);
    reject(502, "origin_result_unavailable");
  }
  const body = await readLimited(origin, BODY_LIMIT);
  try { JSON.parse(body); } catch { reject(502, "origin_invalid_json"); }
  return body;
}

function deliver(value: Completed, rail: Rail, wallet: Address, requestId: string, replay = false) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff", "X-XGuard-Request": requestId,
    "X-XGuard-Billing-Rail": rail, "X-XGuard-Amount-Atomic": String(PRICE),
    "X-XGuard-Replayed": replay ? "1" : "0",
  });
  if (value.hash) headers.set("Payment-Response", b64JSON({
    success: true, network: NETWORK, transaction: value.hash, payer: wallet,
  }));
  return new Response(value.body, { status: 200, headers });
}

async function paidRead(request: Request, env: Env, cfg: Config, r: Route, id: string): Promise<Response> {
  const offer = challenge(cfg, r.resource);
  try {
    const key = request.headers.get("Idempotency-Key") ?? "";
    const proof = request.headers.get("Payment-Signature");
    const bearer = request.headers.get("Authorization");
    if (!!proof === !!bearer) reject(402, "exactly_one_payment_credential_required");
    if (!idemFormat.test(key)) reject(402, "valid_idempotency_key_required");
    let who: Identity, payment: Payment | undefined;
    if (proof) {
      payment = await parsePayment(proof, offer);
      who = { wallet: payment.payload.authorization.from, merchant: cfg.merchant, account: "base" };
    } else {
      if (!bearer?.startsWith("Bearer ") || bearer.length > 2500) reject(402, "invalid_credit_token");
      who = await authenticate(bearer.slice(7), env, cfg);
    }
    const rail: Rail = payment ? "base" : "credits";
    const auth = payment?.payload.authorization;
    const intent: Intent = { ...who, rail, idem: key,
      id: auth ? "base:" + auth.nonce : "credits:" + await sha(cfg.merchant + "\n" + who.account + "\n" + key),
      validBefore: auth ? Number(auth.validBefore) : 0,
      binding: await sha(JSON.stringify({ ...who, rail, price: PRICE, resource: r.resource, key, auth })),
    };
    const state = walletState(env, who.wallet);
    const claim = await state.claim(intent);
    if (claim.kind === "done") return deliver(claim, rail, who.wallet, id, true);
    if (claim.kind === "conflict") reject(409, "payment_binding_conflict");
    if (claim.kind === "expired" || claim.kind === "insufficient") reject(402, claim.kind);
    if (claim.kind === "busy") reject(503, "same_request_in_progress");
    if (claim.kind === "reconcile") {
      if (!auth) reject(503, "settlement_state_inconsistent");
      let resolved: Completed | null = null;
      try {
        const client = baseClient(env);
        if (await client.getChainId() !== base.id) reject(503, "wrong_rpc_chain");
        const hash = await reconcile(client, cfg, auth, claim.hash, claim.startBlock);
        if (hash) resolved = await state.finishChain(intent.id, claim.owner, hash);
      } catch { /* Keep the prior intent; never submit twice after uncertainty. */ }
      if (resolved) return deliver(resolved, rail, who.wallet, id);
      await state.deferSettlement(intent.id, claim.owner, null);
      reject(503, "settlement_unconfirmed_retry_original");
    }
    if (claim.kind !== "work") reject(503, "unexpected_payment_state");

    let journaled = false;
    try {
      if (!payment || !auth) {
        const body = await prepareFacts(env, r);
        const result = await state.finishCredits(intent.id, claim.owner, body);
        if (!result) reject(503, "credit_commit_not_confirmed");
        return deliver(result, rail, who.wallet, id);
      }
      const client = baseClient(env);
      if (await client.getChainId() !== base.id) reject(503, "wrong_rpc_chain");
      const checked = await xpay(env, "verify", payment);
      const verified = (checked.isValid === true || checked.valid === true) &&
        checked.isValid !== false && checked.valid !== false;
      if (!verified || (checked.payer !== undefined && addr(checked.payer) !== who.wallet)) {
        reject(402, "payment_not_verified");
      }
      const body = await prepareFacts(env, r);
      if (Number(auth.validBefore) * 1000 <= Date.now() + 4_000) reject(402, "authorization_expiring");
      const height = await client.getBlockNumber({ cacheTime: 0 });
      const start = (height >= 2n ? height - 2n : 0n).toString();
      if (!await state.startSettlement(intent.id, claim.owner, body, start)) reject(503, "settlement_reservation_lost");
      journaled = true;
      let hint: Hex | undefined;
      try {
        const settlement = await xpay(env, "settle", payment);
        const tx = hex32(settlement.transaction), alias = hex32(settlement.txHash);
        hint = tx && alias && tx !== alias ? undefined : tx ?? alias;
        if (hint && await receiptTruth(client, cfg, auth, hint, BigInt(start))) {
          const result = await state.finishChain(intent.id, claim.owner, hint);
          if (result) return deliver(result, rail, who.wallet, id);
        }
      } catch { /* Uncertain response. Leave durable reconciliation state. */ }
      await state.deferSettlement(intent.id, claim.owner, hint ?? null);
      reject(503, "settlement_unconfirmed_retry_original");
    } catch (error) {
      if (!journaled) await state.release(intent.id, claim.owner).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    if (error instanceof GatewayError && error.status === 402) {
      const body = { ...offer, error: error.code };
      return json(body, 402, { "Payment-Required": b64JSON(body) });
    }
    throw error;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const start = Date.now(), id = crypto.randomUUID();
    let result: Response;
    let group = "rejected";
    try {
      const cfg = config(env);
      const r = route(request, cfg);
      group = r.group;
      if (env.GATEWAY_LIMIT) {
        const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
        if (!(await env.GATEWAY_LIMIT.limit({ key: ip })).success) reject(429, "rate_limited");
      }
      result = await paidRead(request, env, cfg, r, id);
    } catch (error) {
      const problem = error instanceof GatewayError ? error : new GatewayError(503, "gateway_dependency_unavailable");
      result = json({ error: problem.code, request_id: id }, problem.status,
        problem.status === 503 ? { "Retry-After": "5" } : {});
    }
    // Operational telemetry only: no IP, URL, signatures, wallets or API keys.
    // Analytics counts HTTP deliveries (including retries), not unique sales.
    try {
      env.GATEWAY_TELEMETRY?.writeDataPoint({ indexes: ["xguard-gateway"],
        blobs: [group, result.headers.get("X-XGuard-Billing-Rail") ?? "none",
          result.headers.get("X-XGuard-Replayed") ?? "none"],
        doubles: [result.status, Date.now() - start] });
    } catch { /* Telemetry is never an authorization input. */ }
    return result;
  },
} satisfies ExportedHandler<Env>;
