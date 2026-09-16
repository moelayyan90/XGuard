import test from "node:test";
import assert from "node:assert/strict";
import { encodeEventTopics, encodeAbiParameters, parseAbiItem } from "viem";
import { receiptConfirmsAuthorization } from "./settlement-proof.js";

const identity = { asset: "0x" + "1".repeat(40), from: "0x" + "2".repeat(40), payTo: "0x" + "3".repeat(40), nonce: "0x" + "4".repeat(64), amount: "1000" };
const used = parseAbiItem("event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)");
const transfer = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
function receipt() {
  return { status: "success", logs: [
    { address: identity.asset, topics: encodeEventTopics({ abi: [used], args: { authorizer: identity.from, nonce: identity.nonce } }), data: "0x" },
    { address: identity.asset, topics: encodeEventTopics({ abi: [transfer], args: { from: identity.from, to: identity.payTo } }), data: encodeAbiParameters([{ type: "uint256" }], [1000n]) },
  ] };
}

test("reconciliation requires the exact authorization and merchant transfer in one successful receipt", () => {
  assert.equal(receiptConfirmsAuthorization(receipt(), identity), true);
  for (const change of [
    x => { x.status = "reverted"; },
    x => { x.logs.splice(0, 1); },
    x => { x.logs.splice(1, 1); },
    x => { x.logs[1].data = encodeAbiParameters([{ type: "uint256" }], [999n]); },
    x => { x.logs[1].topics = encodeEventTopics({ abi: [transfer], args: { from: identity.from, to: "0x" + "5".repeat(40) } }); },
    x => { x.logs[0].topics = encodeEventTopics({ abi: [used], args: { authorizer: identity.from, nonce: "0x" + "6".repeat(64) } }); },
    x => { x.logs[1].address = "0x" + "7".repeat(40); },
    x => { x.logs[1].data = "0x"; },
  ]) {
    const value = receipt(); change(value);
    assert.equal(receiptConfirmsAuthorization(value, identity), false);
  }
});
