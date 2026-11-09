import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const bundle=await readFile(new URL('../.live-build/live-entry.js',import.meta.url),'utf8');
for(const marker of ['CREATE TABLE IF NOT EXISTS native_settlements','native_simulation_attempt','production_signing_disabled']) assert.equal(bundle.includes(marker),false,'Isolated native signing/ledger implementation entered the public Worker bundle: '+marker);
assert.ok(bundle.includes('isolated-simulation'),'Truthful disabled native status must remain visible');
const config=await readFile(new URL('../apps/relay/wrangler.jsonc',import.meta.url),'utf8');
assert.doesNotMatch(config,/"(?:NATIVE_SIGNER|NATIVE_SETTLEMENT|NATIVE_PRIVATE_KEY)"/);
console.log(JSON.stringify({native_production_boundary:'passed',native_signer_or_ledger_in_public_bundle:false,new_financial_bindings:false}));
