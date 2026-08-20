import universalMainnet from "./universal-mainnet.js";
import { eudrNetworkResponse } from "./eudr-network.js";
import { eudrSmartEmployeeSite } from "./eudr-smart-employee-site.js";
import {
  operationsEmployeeResponse,
  operationsEmployeeScheduled,
} from "./operations-employee.js";

interface EudrMainnetEnv {
  DB: D1Database;
  XGUARD_ADMIN_TOKEN_SHA256?: string;
  [key: string]: unknown;
}

type FetchHandler = (
  request: Request,
  env: EudrMainnetEnv,
  ctx: ExecutionContext,
) => Promise<Response>;
type EmailHandler = (
  message: ForwardableEmailMessage,
  env: EudrMainnetEnv,
  ctx: ExecutionContext,
) => Promise<void>;
type ScheduledHandler = (
  controller: ScheduledController,
  env: EudrMainnetEnv,
  ctx: ExecutionContext,
) => Promise<void>;

const legacy = universalMainnet as unknown as {
  fetch: FetchHandler;
  email: EmailHandler;
  scheduled: ScheduledHandler;
};

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const smartEmployee = eudrSmartEmployeeSite(request);
    if (smartEmployee !== null) return smartEmployee;

    const operations = await operationsEmployeeResponse(request, env);
    if (operations !== null) return operations;

    const eudr = await eudrNetworkResponse(request, env);
    if (eudr !== null) return eudr;

    return legacy.fetch(request, env, ctx);
  },

  async email(message, env, ctx): Promise<void> {
    return legacy.email(message, env, ctx);
  },

  async scheduled(controller, env, ctx): Promise<void> {
    await operationsEmployeeScheduled(env);
    await legacy.scheduled(controller, env, ctx);
  },
} satisfies ExportedHandler<EudrMainnetEnv>;
