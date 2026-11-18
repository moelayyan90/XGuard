import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Actual release routing, storage, alarms and collection; only the ephemeral
// source allowances are seeded. Quota/proration tests use the unmodified Store.
export async function collectorFixture(bundle) {
  const directory = await mkdtemp(join(tmpdir(), 'xguard-collector-fixture-'));
  const path = join(directory, 'entry.js');
  try {
    await build({ stdin: { resolveDir: resolve(bundle, '..'), contents: `
      import worker, { LiveShard as ReleaseLiveShard } from ${JSON.stringify(bundle)};
      export * from ${JSON.stringify(bundle)};
      export default worker;
      export class LiveShard extends ReleaseLiveShard {
        constructor(state, env) {
          super(state, env);
          this.store.set('source-write-budget-v1', {day:new Date().toISOString().slice(0,10),rows_written:0,paused:false,allocation:1600,limit:1600});
          this.store.set('source-read-budget-v1', {day:new Date().toISOString().slice(0,10),rows_read:0,paused:false,allocation:100000,limit:100000});
        }
      }
    ` }, bundle: true, format: 'esm', platform: 'browser', external: ['url', 'node:*', 'cloudflare:*'], target: 'es2022', outfile: path });
    return { path, dispose: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}
