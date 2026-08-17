import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  hasLinkedProviderCredentials,
  revokeMerchantApiKey,
  rotateMerchantApiKey,
} from "../../apps/worker/src/mainnet-revenue-hardening.js";

describe("auto-invoke vault and merchant API key lifecycle", () => {
  it("blocks key rotation while provider credentials are linked", async () => {
    const merchantId = await merchantWithProviderCredential();

    expect(await hasLinkedProviderCredentials(env.DB, merchantId)).toBe(true);
    await expect(
      rotateMerchantApiKey(env.DB, merchantId, ["billing"]),
    ).rejects.toThrow("provider_vault_unlink_required_before_key_rotation");
  });

  it("deletes linked provider credentials when the merchant API key is revoked", async () => {
    const merchantId = await merchantWithProviderCredential();

    await revokeMerchantApiKey(env.DB, merchantId);

    expect(await hasLinkedProviderCredentials(env.DB, merchantId)).toBe(false);
    const row = await env.DB.prepare(
      "SELECT api_key_scopes FROM merchants WHERE merchant_id=?",
    )
      .bind(merchantId)
      .first<{ api_key_scopes: string }>();
    expect(row?.api_key_scopes).toBe("");
  });
});

async function merchantWithProviderCredential(): Promise<string> {
  const merchantId = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO merchants(
       merchant_id,name,api_key_hash,available_balance_micro_usd,
       held_balance_micro_usd,active,created_at
     ) VALUES(?,?,?,0,0,1,?)`,
  )
    .bind(merchantId, "Vault " + merchantId, "hash:" + merchantId, now)
    .run();
  await env.DB.prepare(
    `INSERT INTO gateway_provider_credentials(
       merchant_id,provider,ciphertext,iv,key_version,created_at,updated_at
     ) VALUES(?, 'openai', 'ciphertext', 'iv', 'v1', ?, ?)`,
  )
    .bind(merchantId, now, now)
    .run();
  return merchantId;
}
