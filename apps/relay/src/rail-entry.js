import secure from "./secure-entry.js";
import rail from "./rail.js";
import market from "./x402-market.js";

export { MerchantQuota, SettlementReceipt, AgentAuthority } from "./secure-entry.js";
export { RailKeyAuthority, RailPermitState, RailMeter } from "./rail.js";

export default {
  async fetch(request, env, ctx) {
    const marketResponse = await market.fetch(request, env, ctx);
    if (marketResponse instanceof Response) return marketResponse;

    const railResponse = await rail.fetch(request, env, ctx);
    if (railResponse instanceof Response) return railResponse;

    return secure.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof secure.scheduled === "function") return secure.scheduled(controller, env, ctx);
  },
};
