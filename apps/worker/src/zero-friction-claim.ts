import { createPublicClient, http, type Address, type Hex } from "viem";
import { base } from "viem/chains";
import {
  activateZeroFrictionMerchant,
  normalizeZeroFrictionPayTo,
  validateZeroFrictionPricingTerms,
  type ZeroFrictionAccount,
  type ZeroFrictionPricingTerms,
} from "./zero-friction-billing.js";

const CLAIM_TTL_SECONDS = 5 * 60;
const CLAIM_DOMAIN = "xguardgate.com";

export interface ZeroFrictionClaimEnv {
  DB: D1Database;
  BASE_RPC_URL: string;
}

export interface ZeroFrictionClaimChallenge extends ZeroFrictionPricingTerms {
  payTo: string;
  nonce: string;
  message: string;
  expiresAt: string;
}

export async function createZeroFrictionClaimChallenge(
  env: ZeroFrictionClaimEnv,
  rawPayTo: string,
  rawTerms: ZeroFrictionPricingTerms,
): Promise<ZeroFrictionClaimChallenge> {
  const payTo = normalizeZeroFrictionPayTo(rawPayTo);
  const terms = validateZeroFrictionPricingTerms(rawTerms);
  const now = new Date();
  const expires = new Date(now.getTime() + CLAIM_TTL_SECONDS * 1_000);
  const nonce = randomHex(32);
  const challengeHash = await sha256Hex(nonce);
  const message = buildClaimMessage(
    payTo,
    nonce,
    now.toISOString(),
    expires.toISOString(),
    terms,
  );

  await env.DB.prepare(
    `INSERT INTO zero_friction_claim_challenges(
      challenge_hash,pay_to,pricing_version,fee_bps,fee_cap_micro_usd,
      postpaid_limit_micro_usd,expires_at_epoch,consumed_at,created_at
    ) VALUES(?,?,?,?,?,?,?,NULL,?)`,
  )
    .bind(
      challengeHash,
      payTo,
      terms.pricingVersion,
      terms.feeBps,
      terms.feeCapMicroUsd,
      terms.postpaidLimitMicroUsd,
      Math.floor(expires.getTime() / 1_000),
      now.toISOString(),
    )
    .run();

  return {
    payTo,
    nonce,
    message,
    expiresAt: expires.toISOString(),
    ...terms,
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
    `SELECT pay_to,pricing_version,fee_bps,fee_cap_micro_usd,
            postpaid_limit_micro_usd,expires_at_epoch,consumed_at,created_at
     FROM zero_friction_claim_challenges WHERE challenge_hash=?`,
  )
    .bind(challengeHash)
    .first<{
      pay_to: string;
      pricing_version: string;
      fee_bps: number;
      fee_cap_micro_usd: number;
      postpaid_limit_micro_usd: number;
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

  const terms = validateZeroFrictionPricingTerms({
    pricingVersion: challenge.pricing_version,
    feeBps: challenge.fee_bps,
    feeCapMicroUsd: challenge.fee_cap_micro_usd,
    postpaidLimitMicroUsd: challenge.postpaid_limit_micro_usd,
  });
  const expiresAt = new Date(challenge.expires_at_epoch * 1_000).toISOString();
  const message = buildClaimMessage(
    payTo,
    input.nonce.toLowerCase(),
    challenge.created_at,
    expiresAt,
    terms,
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

  return activateZeroFrictionMerchant(env.DB, payTo, terms);
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
  terms: ZeroFrictionPricingTerms,
): string {
  return [
    "XGuard merchant activation",
    "",
    `Domain: ${CLAIM_DOMAIN}`,
    "Network: Base (eip155:8453)",
    `PayTo: ${payTo}`,
    `Pricing Version: ${terms.pricingVersion}`,
    `Service Fee: ${terms.feeBps} basis points of each independently finalized settlement`,
    `Fee Cap: ${terms.feeCapMicroUsd} micro-USD per settlement`,
    `Postpaid Limit: ${terms.postpaidLimitMicroUsd} micro-USD`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    `Expires At: ${expiresAt}`,
    "",
    "Purpose: activate a postpaid XGuard facilitator URL for this payTo address.",
    "No fee is charged for verify, failed settlement, or idempotent retry.",
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
