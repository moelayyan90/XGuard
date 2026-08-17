import {
  createPublicClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { base } from "viem/chains";
import {
  activateZeroFrictionMerchant,
  normalizeZeroFrictionPayTo,
  type ZeroFrictionAccount,
} from "./zero-friction-billing.js";

const CLAIM_TTL_SECONDS = 5 * 60;
const CLAIM_DOMAIN = "xguardgate.com";

export interface ZeroFrictionClaimEnv {
  DB: D1Database;
  BASE_RPC_URL: string;
}

export interface ZeroFrictionClaimChallenge {
  payTo: string;
  nonce: string;
  message: string;
  expiresAt: string;
}

export async function createZeroFrictionClaimChallenge(
  env: ZeroFrictionClaimEnv,
  rawPayTo: string,
): Promise<ZeroFrictionClaimChallenge> {
  const payTo = normalizeZeroFrictionPayTo(rawPayTo);
  const now = new Date();
  const expires = new Date(now.getTime() + CLAIM_TTL_SECONDS * 1_000);
  const nonce = randomHex(32);
  const challengeHash = await sha256Hex(nonce);
  const message = buildClaimMessage(
    payTo,
    nonce,
    now.toISOString(),
    expires.toISOString(),
  );

  await env.DB.prepare(
    `INSERT INTO zero_friction_claim_challenges(
      challenge_hash,pay_to,expires_at_epoch,consumed_at,created_at
    ) VALUES(?,?,?,NULL,?)`,
  )
    .bind(
      challengeHash,
      payTo,
      Math.floor(expires.getTime() / 1_000),
      now.toISOString(),
    )
    .run();

  return {
    payTo,
    nonce,
    message,
    expiresAt: expires.toISOString(),
  };
}

export async function claimZeroFrictionMerchant(
  env: ZeroFrictionClaimEnv,
  input: { payTo: string; nonce: string; signature: string },
): Promise<ZeroFrictionAccount> {
  const payTo = normalizeZeroFrictionPayTo(input.payTo);
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.nonce))
    throw new Error("invalid_zero_friction_claim_nonce");
  if (!/^0x[0-9a-fA-F]+$/.test(input.signature))
    throw new Error("invalid_zero_friction_claim_signature");

  const challengeHash = await sha256Hex(input.nonce.toLowerCase());
  const challenge = await env.DB.prepare(
    `SELECT pay_to,expires_at_epoch,consumed_at,created_at
     FROM zero_friction_claim_challenges WHERE challenge_hash=?`,
  )
    .bind(challengeHash)
    .first<{
      pay_to: string;
      expires_at_epoch: number;
      consumed_at: string | null;
      created_at: string;
    }>();
  if (challenge === null) throw new Error("zero_friction_claim_not_found");
  if (challenge.pay_to !== payTo)
    throw new Error("zero_friction_claim_pay_to_mismatch");
  if (challenge.consumed_at !== null)
    throw new Error("zero_friction_claim_already_used");

  const nowEpoch = Math.floor(Date.now() / 1_000);
  if (challenge.expires_at_epoch < nowEpoch)
    throw new Error("zero_friction_claim_expired");

  const expiresAt = new Date(challenge.expires_at_epoch * 1_000).toISOString();
  const message = buildClaimMessage(
    payTo,
    input.nonce.toLowerCase(),
    challenge.created_at,
    expiresAt,
  );
  const client = createPublicClient({
    chain: base,
    transport: http(env.BASE_RPC_URL, { timeout: 8_000 }),
  });
  const valid = await client.verifyMessage({
    address: payTo as Address,
    message,
    signature: input.signature as Hex,
  });
  if (!valid) throw new Error("zero_friction_claim_signature_invalid");

  const consumedAt = new Date().toISOString();
  const consumed = await env.DB.prepare(
    `UPDATE zero_friction_claim_challenges
     SET consumed_at=?
     WHERE challenge_hash=? AND pay_to=? AND consumed_at IS NULL AND expires_at_epoch>=?`,
  )
    .bind(consumedAt, challengeHash, payTo, nowEpoch)
    .run();
  if (consumed.meta.changes !== 1)
    throw new Error("zero_friction_claim_raced_or_expired");

  return activateZeroFrictionMerchant(env.DB, payTo);
}

export async function pruneZeroFrictionClaimChallenges(
  db: D1Database,
  nowEpoch = Math.floor(Date.now() / 1_000),
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM zero_friction_claim_challenges
       WHERE expires_at_epoch<? OR consumed_at IS NOT NULL`,
    )
    .bind(nowEpoch)
    .run();
}

function buildClaimMessage(
  payTo: string,
  nonce: string,
  issuedAt: string,
  expiresAt: string,
): string {
  return [
    "XGuard merchant activation",
    "",
    `Domain: ${CLAIM_DOMAIN}`,
    "Network: Base (eip155:8453)",
    `PayTo: ${payTo}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    `Expires At: ${expiresAt}`,
    "",
    "Purpose: activate a postpaid XGuard facilitator URL for this payTo address.",
    "This signature does not authorize a token transfer or change payment recipients.",
  ].join("\n");
}

function randomHex(bytes: number): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return `0x${[...value]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
