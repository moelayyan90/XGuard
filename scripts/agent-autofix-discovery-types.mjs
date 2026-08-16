import fs from "node:fs";

const bazaarPath = "apps/worker/src/mainnet-bazaar.ts";
let bazaar = fs.readFileSync(bazaarPath, "utf8");
bazaar = bazaar.replace(
  'import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";',
  'import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";',
);
for (const field of ["type", "payTo", "scheme", "network", "extensions"]) {
  bazaar = bazaar.replace(`  ${field}?: string;`, `  ${field}?: string | undefined;`);
}
bazaar = bazaar.replace("  limit?: number;", "  limit?: number | undefined;");
bazaar = bazaar.replace("  offset?: number;", "  offset?: number | undefined;");
bazaar = bazaar.replace("  cursor?: string;", "  cursor?: string | undefined;");
fs.writeFileSync(bazaarPath, bazaar);

const edgePath = "apps/worker/src/mainnet-edge.ts";
let edge = fs.readFileSync(edgePath, "utf8");
edge = edge.replace(
  "parsed = await parseMainnetFacilitatorRequest(request.clone());",
  "parsed = await parseMainnetFacilitatorRequest(request.clone() as unknown as Request);",
);
fs.writeFileSync(edgePath, edge);
