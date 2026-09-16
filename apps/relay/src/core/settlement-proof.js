import { decodeEventLog, parseAbiItem } from "viem";

const events = [
  parseAbiItem("event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)"),
  parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)"),
];
const lower = value => String(value || "").toLowerCase();

// Consumed nonce alone is not proof that this merchant received this amount.
export function receiptConfirmsAuthorization(receipt, identity) {
  if (receipt?.status !== "success" || !Array.isArray(receipt.logs)) return false;
  let authorized = false, transferred = false;
  for (const log of receipt.logs) {
    if (lower(log.address) !== lower(identity.asset)) continue;
    try {
      const event = decodeEventLog({ abi: events, data: log.data, topics: log.topics, strict: true });
      if (event.eventName === "AuthorizationUsed") authorized ||= lower(event.args.authorizer) === lower(identity.from) && lower(event.args.nonce) === lower(identity.nonce);
      if (event.eventName === "Transfer") transferred ||= lower(event.args.from) === lower(identity.from) && lower(event.args.to) === lower(identity.payTo) && event.args.value === BigInt(identity.amount);
    } catch { /* unrelated or malformed logs never establish payment */ }
  }
  return authorized && transferred;
}
