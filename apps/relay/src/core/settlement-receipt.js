// Internal durable settlement state. Never trust client headers to reserve it.
const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });

export function settlementIdentity(body) {
  const requirements = body?.paymentRequirements || body?.requirements || null;
  const payload = body?.paymentPayload || body?.payment || body?.payload || null;
  const accepted = payload?.accepted || requirements || null;
  const authorization = payload?.payload?.authorization || payload?.authorization || null;
  return {
    network: requirements?.network || accepted?.network || "",
    asset: requirements?.asset || accepted?.asset || "",
    payTo: requirements?.payTo || accepted?.payTo || "",
    amount: requirements?.amount || accepted?.amount || "",
    from: authorization?.from || "", nonce: authorization?.nonce || "",
  };
}

export async function settlementReceiptId(identity, legacy = false) {
  if (!identity.network || !identity.from || !identity.nonce) return "";
  const evm = identity.network.startsWith("eip155:") || identity.network === "base";
  const network = !legacy && identity.network === "base" ? "eip155:8453" : identity.network;
  const asset = !legacy && evm ? identity.asset.toLowerCase() : identity.asset;
  const payer = legacy || evm ? identity.from.toLowerCase() : identity.from;
  const nonce = legacy || evm ? identity.nonce.toLowerCase() : identity.nonce;
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${network}|${asset}|${payer}|${nonce}`));
  return `xgr_${[...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, "0")).join("").slice(0, 40)}`;
}

export async function receiptOperation(env, id, path, body) {
  if (!env.RECEIPTS) throw new Error("settlement_state_unavailable");
  const stub = env.RECEIPTS.get(env.RECEIPTS.idFromName(id));
  const response = await stub.fetch(`https://receipt${path}`, body ? {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  } : undefined);
  const value = await response.json();
  if (response.status >= 500) throw new Error("settlement_state_unavailable");
  return { status: response.status, value };
}

export async function getSettlementReceipt(env, id) {
  if (!id) return null;
  const result = await receiptOperation(env, id, "/get");
  if (result.status === 404) return null;
  if (result.status !== 200) throw new Error("settlement_state_unavailable");
  return result.value;
}

export async function putSettlementReceipt(env, id, record) {
  if (!id) return null;
  const result = await receiptOperation(env, id, "/record", record);
  if (result.status !== 200 && result.status !== 201) throw new Error("settlement_receipt_conflict");
  return result.value;
}

export function settlementPendingResponse(record) {
  return json({ success: false, errorReason: "settlement_in_progress", receiptId: record.receipt_id,
    message: "This authorization already has an unconfirmed settlement. Do not submit a new payment. Inspect the receipt; stale Base authorizations are reconciled when the identical request is retried.",
    next: { method: "GET", path: `/v1/receipts/${record.receipt_id}`, action: "inspect_settlement_receipt", payment_required: false },
  }, 409, { "x-xguard-receipt-id": record.receipt_id, "x-xguard-payment-context": "durable_reservation" });
}

export function settlementSuccessResponse(record, replayed = false) {
  return json({ success: true, payer: record.payer, transaction: record.transaction, network: record.network,
    receiptId: record.receipt_id, idempotent: replayed }, 200, {
    "x-xguard-receipt-id": record.receipt_id, "x-xguard-recovered": record.recovered ? "1" : "0",
    "x-xguard-resolution": record.resolution || "confirmed",
    "x-xguard-payment-context": replayed ? "durable_receipt" : "verified_per_request",
    ...(replayed ? { "x-xguard-idempotent-replay": "1" } : {}),
  });
}
