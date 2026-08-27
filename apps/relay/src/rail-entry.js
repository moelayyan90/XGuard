import secure from "./secure-entry.js";
import rail from "./rail.js";

export { MerchantQuota, SettlementReceipt, AgentAuthority } from "./secure-entry.js";
export { RailKeyAuthority, RailPermitState, RailMeter } from "./rail.js";

export default {
  async fetch(request, env, ctx) {
    const railResponse = await rail.fetch(request, env, ctx);
    if (railResponse instanceof Response) return railResponse;
    return secure.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof secure.scheduled === "function") return secure.scheduled(controller, env, ctx);
  },
};
