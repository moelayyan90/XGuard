import test from "node:test";
import assert from "node:assert/strict";
import { inspectMirror } from "./mcpcentral-contract.mjs";

const manifest = { name: "io.github.moelayyan90/xguard-control-plane", version: "6.0.0",
  remotes: [{ type: "streamable-http", url: "https://api.xguardgate.com/mcp" }] };
const current = { ...manifest, id: manifest.name };

test("catalog confirmation requires this exact version and canonical transport endpoint", () => {
  assert.equal(inspectMirror(manifest, current).mirror_verified, true);
  for (const stale of [
    { ...current, version: "5.0.2" },
    { ...current, id: "other/server", name: "other/server" },
    { ...current, remotes: [{ type: "streamable-http", url: "https://different.example/mcp" }] },
    { ...current, remotes: [{ type: "sse", url: manifest.remotes[0].url }] },
    { ...current, remotes: [] },
    { ...current, remotes: {} },
  ]) assert.equal(inspectMirror(manifest, stale).mirror_verified, false);
  const delayed = inspectMirror(manifest, { ...current, version: "5.0.2" });
  assert.equal(delayed.observed_version, "5.0.2");
  assert.equal(delayed.name_matches, true); assert.equal(delayed.endpoint_matches, true);
});

test("wrapped catalog records use the same strict check", () => {
  for (const value of [{ server: current }, { data: { server: current } }, { data: current }]) {
    assert.equal(inspectMirror(manifest, value).mirror_verified, true);
  }
});
