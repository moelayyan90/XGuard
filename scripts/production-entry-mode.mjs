import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
const path='apps/relay/wrangler.jsonc';
let config;
if (process.argv[2]==='--source') config=readFileSync(path,'utf8');
else if (process.argv[2]==='--deployed') {
  const r=await fetch('https://api.xguardgate.com/api/intelligence/v1/catalog',{
    headers:{'cache-control':'no-cache','x-xguard-traffic-class':'synthetic'},redirect:'error',signal:AbortSignal.timeout(10000),
  });
  const tag=r.headers.get('x-xguard-worker-version-tag');
  assert.match(tag||'',/^git-[0-9a-f]{12,40}$/,'Deployed source tag is required');
  config=execFileSync('git',['show',tag.slice(4)+':'+path],{encoding:'utf8'});
} else throw Error('Choose the source or the deployed production entry.');
const main=/^\s*"main":\s*"(src\/(?:live|paid-only)-entry\.js)",/m.exec(config)?.[1];
assert.ok(main,'Unknown production entry');
if(process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,'main='+main+'\n');
console.log(main);
