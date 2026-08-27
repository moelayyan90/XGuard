import { serve } from "@hono/node-server";
import gate from "xguard-edge-gate";

const port = Number.parseInt(process.env.PORT || "8080", 10);
const hostname = process.env.HOST || "0.0.0.0";

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

const server = serve({
  fetch: request => gate.fetch(request, process.env),
  port,
  hostname,
});

console.log(`XGuard Universal Gate 5.0.1 listening on http://${hostname}:${port}`);

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
