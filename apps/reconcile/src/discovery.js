import { declareDiscoveryExtension } from "@x402/extensions/bazaar";

// Shared by the Worker and the build-time validator generator. Keep the public
// declaration unchanged; x402 enriches its method to GET for the paid route.
export default declareDiscoveryExtension({
  input: {
    from: "0x1111111111111111111111111111111111111111",
    nonce: "0x1111111111111111111111111111111111111111111111111111111111111111"
  },
  inputSchema: {
    properties: {
      from: { type: "string", description: "EVM authorizer address", pattern: "^0x[0-9a-fA-F]{40}$" },
      nonce: { type: "string", description: "EIP-3009 bytes32 authorization nonce", pattern: "^0x[0-9a-fA-F]{64}$" }
    },
    required: ["from", "nonce"]
  },
  output: {
    example: {
      network: "eip155:8453",
      authorization_used: true,
      settlement: "observed",
      transaction: "0x…",
      safe_to_retry_same_authorization: false
    }
  }
});
