import { OPERATIONS, ROUTE_PAGES } from './catalog.ts';
import { escape } from '../live/util.ts';
import { DESIGN_CSS } from '../live/design.ts';
import { pageShell } from './frame.ts';

export const NETWORK_CSS = DESIGN_CSS;
const prices = (amount: string) => (Number(amount) / 1e6).toFixed(3) + ' USDC';
const friendly: Record<string, { name: string; description: string }> = {
  'route-resolve': { name: 'Resolve a task', description: 'Turn an intent into candidate routes, requirements and a clear next action.' },
  'route-compare': { name: 'Compare routes', description: 'Compare route strategies and see which costs or provider details are still unknown.' },
  discover: { name: 'Discover a service', description: 'Find matching capabilities and check current official documentation.' },
  'platform-discovery': { name: 'Inspect a platform', description: 'Inspect public agent cards, API metadata and machine-readable documentation.' },
  crawl: { name: 'Crawl a public page', description: 'Extract text, metadata and links with robots-aware public-web access.' },
  fact: { name: 'Get a live fact', description: 'Retrieve a current npm version directly from the primary registry.' },
  task: { name: 'Run a persistent task', description: 'Execute bounded public-web steps with checkpoints, retries and an explicit fallback.' },
  schedule: { name: 'Schedule a task', description: 'Run a bounded public-web task later, with its state durably stored.' },
  verify: { name: 'Verify a URL', description: 'Check a public HTTPS response against your expected HTTP status.' },
};
const heading = (label: string, title: string, description: string) => '<div class="page-heading"><p class="eyebrow"><span class="signal-dot"></span>' + label + '</p><h1>' + title + '</h1><p class="lead">' + description + '</p></div>';
const serviceRows = (limit: number = OPERATIONS.length) => OPERATIONS.slice(0, limit).map((d,i) => '<a class="service-row" href="/network?service=' + d.route + '"><span class="row-index">' + String(i+1).padStart(2,'0') + '</span><div><h3>' + friendly[d.route].name + '</h3><p>' + friendly[d.route].description + '</p></div><span class="row-price">' + prices(d.amount) + '</span><span class="row-arrow" aria-hidden="true">↗</span></a>').join('');

export function networkHome(data: any): string {
  const stats = data.stats || {};
  return `<section class="home-hero" aria-labelledby="home-title"><div class="hero-inner"><div class="hero-copy">
    <p class="eyebrow"><span class="signal-dot"></span>AI routing & execution infrastructure</p>
    <h1 id="home-title">From intent<br>to <span>execution.</span></h1>
    <p class="lead">Find the tools. Understand the cost. Keep your task moving with durable execution and source-backed evidence.</p>
    <form class="intent-form" action="/network" method="get"><label for="task-intent">What should your agent do next?</label><input id="task-intent" name="intent" placeholder="Describe a task to find its route…" maxlength="2000" required><button type="submit">Find a route <span aria-hidden="true">→</span></button></form>
    <div class="hero-examples"><span>Try:</span><a href="/network?service=crawl">Extract a webpage</a><a href="/network?service=fact">Check a live fact</a><a href="/network?service=verify">Verify a URL</a></div>
    <p class="hero-price">Route resolution: 0.005 USDC · Execution quoted separately</p>
  </div><section class="route-console" aria-label="Illustrative execution path">
    <div class="console-title">xguard.route <span>ILLUSTRATIVE WORKFLOW</span></div><div class="console-body">
    <p class="console-caption">OBJECTIVE / PUBLIC WEB EVIDENCE</p><h2>A clear path to the next action.</h2>
    <div class="path-step"><span class="step-number">01</span><div><h3>Resolve the intent</h3><p>Match the task to a supported capability.</p></div><span class="step-kind">ROUTE</span></div>
    <div class="path-step"><span class="step-number">02</span><div><h3>Review cost & execute</h3><p>Approve the quote. Preserve execution state.</p></div><span class="step-kind">EXECUTE</span></div>
    <div class="path-step"><span class="step-number">03</span><div><h3>Return verifiable evidence</h3><p>Inspect source digests and explicit checks.</p></div><span class="step-kind">VERIFY</span></div></div>
    <pre class="console-code"><span class="code-blue">POST</span> /v1/routes/resolve
{
  "intent": "Extract evidence from a public webpage",
  "max_amount_atomic": "5000"
}</pre><div class="console-footer"><span>MACHINE-READABLE BY DESIGN</span><span>HTTP + JSON</span></div>
  </section></div></section>
  <div class="protocol-strip"><div class="protocol-inner"><p>Built for agents. Accessible through HTTP.</p><div class="protocol-tags"><span>MCP</span><span>A2A</span><span>x402</span><span>OpenAPI</span></div></div></div>
  <div class="wrap home-content"><section class="home-section"><div class="section-head"><div><p class="eyebrow">01 / An operating layer for AI</p><h2>Less orchestration.<br>More forward progress.</h2></div><p>Routing, discovery and public-web execution in one place. Each operation has a defined scope and an explicit price.</p></div>
  <div class="capability-list"><article class="capability-item"><span class="capability-index">01 / ROUTE INTELLIGENCE</span><h3>Know where to go.</h3><p>Find candidate services, compare routes and see the permissions or integrations a task still needs.</p><a class="text-link" href="/routes">Explore routes <span aria-hidden="true">→</span></a></article><article class="capability-item"><span class="capability-index">02 / EXECUTION CONTINUITY</span><h3>Keep the state.</h3><p>Run bounded public-web workflows with durable task IDs, checkpoints and controlled provider fallback.</p><a class="text-link" href="/network?service=task">Open execution <span aria-hidden="true">→</span></a></article><article class="capability-item"><span class="capability-index">03 / SOURCE EVIDENCE</span><h3>Inspect the result.</h3><p>Retrieve current primary-source facts and check public responses with timestamps and source digests.</p><a class="text-link" href="/network?service=verify">Verify a URL <span aria-hidden="true">→</span></a></article></div></section>
  <section class="home-section"><div class="section-head"><div><p class="eyebrow">02 / Pay per operation</p><h2>Clear scope. Clear price.</h2></div><a class="text-link" href="/network">All operations <span aria-hidden="true">↗</span></a></div><div class="service-list">${serviceRows(3)}</div><div class="section-summary"><span>USDC on Base · No monthly subscription required</span><span>Review the exact quote before authorizing payment.</span></div></section>
  <section class="home-section connect-panel"><div><p class="eyebrow">03 / Connect your agent</p><h2>One interface.<br>Your existing workflow.</h2><p>Use the API directly or connect through MCP and A2A.</p></div><div class="actions"><a class="button" href="/install">Connect agent <span aria-hidden="true">↗</span></a><a class="button secondary" href="/network/docs">Read the docs</a></div></section>
  <section class="home-section"><div class="section-head"><div><p class="eyebrow">04 / Primary-source intelligence</p><h2>Evidence behind the answer.</h2></div><a class="text-link" href="/topics">Browse the source index <span aria-hidden="true">↗</span></a></div>
  <div class="source-overview">${[[stats.facts,'Published facts'],[stats.sources,'Monitored sources'],[stats.verified,'Fresh verified facts'],[stats.changes_today,'Changes observed today']].map(([n,label])=>'<div><strong>'+Number(n||0).toLocaleString('en-US')+'</strong><span>'+label+'</span></div>').join('')}</div><p class="home-meta">The live facts layer for AI. Verification describes the cited source at retrieval; it is not an independent audit of a publisher's claims.</p></section></div>`;
}

function workspace(service: string, intent: string) {
  const d = OPERATIONS.find(o=>o.route === service) || OPERATIONS[0];
  return heading('Execution workspace', 'Your next action starts here.', 'Choose an operation, define the input, and review its payment quote before anything runs.') + `
  <div class="workspace-layout"><section class="workspace-editor"><div class="panel-heading"><h2>Configure your request</h2><span>PAY PER OPERATION</span></div><form id="network-form" class="panel-content">
  <div class="field"><label for="service">Operation</label><select id="service">${OPERATIONS.map(o=>'<option value="'+o.route+'"'+(o.route===d.route?' selected':'')+'>'+friendly[o.route].name+' — '+prices(o.amount)+'</option>').join('')}</select><p class="field-hint" id="service-description">${escape(friendly[d.route].description)}</p></div>
  <div class="field service-field" data-services="route-resolve route-compare"><label for="intent">What do you want to accomplish?</label><textarea id="intent" maxlength="2000" placeholder="e.g. Extract text and links from a public website with source evidence.">${escape(intent)}</textarea></div>
  <div class="field service-field" data-services="discover"><label for="query">Required capability</label><input id="query" maxlength="200" placeholder="e.g. hosting, web extraction, email"></div>
  <div class="field service-field" data-services="platform-discovery crawl verify task schedule"><label for="target-url">Public HTTPS URL</label><input id="target-url" type="url" placeholder="https://example.com/"></div>
  <div class="field service-field" data-services="fact"><label for="package">npm package</label><input id="package" maxlength="180" placeholder="e.g. react or @scope/package"></div>
  <div class="inline-fields"><div class="field service-field" data-services="verify task schedule"><label for="expected-status">Expected HTTP status</label><input id="expected-status" type="number" min="200" max="599" value="200"></div><div class="field service-field" data-services="task schedule"><label for="task-kind">Execution step</label><select id="task-kind"><option value="http">Verify HTTP response</option><option value="extract">Extract page content</option></select></div></div>
  <div class="field service-field" data-services="schedule"><label for="run-at">Run at (your local time)</label><input id="run-at" type="datetime-local"></div>
  <div class="field"><label for="budget">Maximum authorized cost (USDC)</label><input id="budget" type="text" inputmode="decimal" value="${(Number(d.amount)/1e6).toFixed(3)}" pattern="[0-9]+([.][0-9]{1,6})?"><p class="field-hint">The cap must cover the quoted operation. No additional spending is authorized.</p></div>
  <div class="cost-summary"><span>XGuard operation fee</span><strong id="operation-price">${prices(d.amount)}</strong></div>
  <button class="wide" id="quote-button" type="submit">Get payment quote <span aria-hidden="true">→</span></button><p class="submit-note">Requesting a quote does not charge your wallet.</p>
  <details><summary>Developer request</summary><label><input id="advanced-mode" type="checkbox"> Edit the raw JSON instead</label><label for="payload" class="sr-only">JSON request body</label><textarea id="payload" spellcheck="false">${escape(JSON.stringify(d.example,null,2))}</textarea><p class="request-endpoint" id="request-endpoint">POST /api/paid/v1/${d.route}</p></details>
  </form></section>
  <section class="workspace-output" aria-label="Quote and result"><div class="panel-heading"><h2>Quote & result</h2><span id="request-status" class="status-indicator">AWAITING INPUT</span></div><div id="result-summary" class="empty-result" aria-live="polite"><div class="output-label">REQUEST / QUOTE / EXECUTE</div><h3>Ready when you are.</h3><p>Your exact payment offer and response will appear here. An x402-compatible agent can authorize the quoted operation.</p><div class="output-facts"><div><span>PAYMENT</span><strong>USDC · Base</strong></div><div><span>EXECUTION</span><strong>After authorization</strong></div></div></div><details id="response-details"><summary>Inspect machine response</summary><pre id="output">No request has been sent.</pre></details></section></div>
  <div class="workspace-notes"><span>SCOPED SPENDING</span><span>IDEMPOTENT REQUESTS</span><span>SIGNED DELIVERY</span></div><p class="scope-note">Current execution supports bounded public-web reads, extraction and HTTP checks. External provider actions may require separate credentials or integrations. Payment coverage is limited to the rails shown in <a href="/v1/payments/coverage">current coverage</a>.</p>
  <section class="home-section"><div class="section-head"><div><p class="eyebrow">Operation catalog</p><h2>Choose the capability you need.</h2></div></div><div class="service-list">${serviceRows()}</div></section>`;
}
function directory(path: string) {
  const slug = path.slice('/routes/'.length);
  const chosen = ROUTE_PAGES[slug];
  if (chosen) return heading('Route directory',escape(chosen),'Resolve this task against the capability catalog. See candidate services, requirements, pricing unknowns and executable coverage before choosing a route.') + '<div class="connect-panel"><div><p class="eyebrow">Task route resolution</p><h2>Plan the next action.</h2><p>0.005 USDC per routing operation. Provider execution fees are separate.</p></div><a class="button" href="/network?service=route-resolve&amp;intent='+encodeURIComponent(chosen)+'">Resolve this task <span aria-hidden="true">→</span></a></div><div class="capability-list"><article class="capability-item"><span class="capability-index">01 / REQUIREMENTS</span><h3>See what the task needs.</h3><p>Discover candidate capabilities and the authentication or integrations required.</p></article><article class="capability-item"><span class="capability-index">02 / TRADE-OFFS</span><h3>Compare the route.</h3><p>Review price, availability and execution coverage. Unknowns remain explicit.</p></article><article class="capability-item"><span class="capability-index">03 / CONTROL</span><h3>Decide when to execute.</h3><p>A route is a plan. Execution requires its own supported operation and spending authorization.</p></article></div><p class="scope-note">Some task categories require external provider adapters. A directory entry does not mean XGuard can execute every step on your behalf.</p>';
  return heading('Task route directory','Find your next route.','Start with the outcome. Review candidate capabilities, constraints and costs before execution.') + '<div class="route-directory">'+Object.entries(ROUTE_PAGES).map(([key,name],i)=>'<a class="directory-row" href="/routes/'+key+'"><span class="directory-label">'+String(i+1).padStart(2,'0')+' / TASK ROUTE</span><h2>'+escape(name)+'</h2><p>Resolve capabilities, requirements and available execution paths for this task.</p><span class="directory-action">Explore task route ↗</span></a>').join('')+'</div><p class="scope-note">Route resolution is a paid operation. Provider costs and eligibility are separate and may require verification.</p>';
}
function documentation() {
  return heading('Developer documentation','One interface.<br>Built for machine use.','Connect through HTTP, MCP or A2A. Use explicit spending limits and recover uncertain results without a second purchase.') + `
  <div class="doc-grid"><article class="doc-content"><h2 id="quickstart">Resolve a task</h2><p>Send an unsigned request first. XGuard returns an x402 payment offer for the exact operation. Sign only if it fits your budget, then retry the same request with the original quote and idempotency key.</p><pre>POST https://api.xguardgate.com/v1/routes/resolve
Content-Type: application/json
Idempotency-Key: a-unique-stable-key

{
  "intent": "Extract text from a public webpage",
  "max_amount_atomic": "5000"
}</pre><p>USDC uses 6 decimal places. <code>5000</code> atomic units is 0.005 USDC. Route resolution is separate from execution.</p>
  <h2 id="payment">Payment and recovery</h2><p>A 402 response includes <code>Payment-Required</code> and <code>X-XGuard-Quote</code>. Retry the identical body with <code>Payment-Signature</code>, the original quote and the same idempotency key. After an uncertain response, recover the original payment identifier with its original quote. Do not create a replacement purchase.</p><pre>GET /api/paid/v1/results/{payment_identifier}
X-XGuard-Quote: &lt;original signed quote&gt;</pre>
  <h2 id="tasks">Persistent tasks</h2><p>A task purchase returns a task ID and a scoped task token. Up to 3 public read-only steps can be checkpointed and retried within the bounded contract. Keep the token private.</p><pre>POST /v1/tasks
{
  "steps": [{
    "kind": "http",
    "url": "https://example.com/",
    "expected_status": 200
  }],
  "budget_atomic": "30000",
  "max_amount_atomic": "30000"
}

GET /v1/tasks/{id}
POST /v1/tasks/{id}/resume
POST /v1/tasks/{id}/verify
POST /v1/tasks/{id}/cancel
Authorization: Bearer &lt;task_token&gt;</pre>
  <h2 id="schedules">Scheduled execution</h2><p><code>POST /v1/schedules</code> accepts the same steps with <code>run_at</code>, or a bounded interval and run count. The limit is 3 total step executions and up to 30 days ahead. Unlimited monitoring, price triggers and arbitrary webhook triggers are outside the current scope.</p>
  <h2 id="scope">Execution scope</h2><p>Current internal operations cover routing, catalog discovery, public metadata inspection, robots-aware page extraction, current npm versions, HTTP verification and durable public-read tasks. External deployments, stores, email or paid model actions may require additional provider adapters. No connected bank-card checkout, approved Payoneer consumer checkout, FX, deferred compute or funded completion protection is claimed.</p><p><a href="/openapi.json">OpenAPI schema</a> · <a href="/install">MCP and A2A setup</a> · <a href="/v1/payments/coverage">Current payment coverage</a></p></article>
  <aside class="doc-aside"><p>ON THIS PAGE</p><a href="#quickstart">Resolve a task</a><a href="#payment">Payment & recovery</a><a href="#tasks">Persistent tasks</a><a href="#schedules">Scheduled execution</a><a href="#scope">Execution scope</a><a href="/openapi.json">OpenAPI ↗</a><a href="/install">Connect agent ↗</a></aside></div>`;
}
export function networkHtml(path: string, params = new URLSearchParams()) {
  const service = OPERATIONS.some(d=>d.route===params.get('service')) ? params.get('service')! : 'route-resolve';
  const intent = (params.get('intent') || '').slice(0,2000);
  const docs = path === '/network/docs';
  const route = path === '/routes' || path.startsWith('/routes/');
  const title = docs ? 'Developer documentation' : route ? ROUTE_PAGES[path.slice(8)] || 'Task routes' : 'Execution workspace';
  return pageShell(path,title,'AI task routing, discovery and durable public-web execution with explicit pricing.',docs ? documentation() : route ? directory(path) : workspace(service,intent),!docs && !route);
}
export const NETWORK_JS = `
const definitions = ${JSON.stringify(OPERATIONS.map(d=>({ ...d, ...friendly[d.route] })))};
const form = document.querySelector('#network-form');
if (form) {
  const select = document.querySelector('#service'), payload = document.querySelector('#payload'), status = document.querySelector('#request-status'), output = document.querySelector('#output'), summary = document.querySelector('#result-summary'), button = document.querySelector('#quote-button'), budget = document.querySelector('#budget'), advanced = document.querySelector('#advanced-mode');
  let lastBody = '', idempotency = '';
  const value = id => document.getElementById(id).value.trim();
  const atomic = text => { if (!/^[0-9]+(?:[.][0-9]{1,6})?$/.test(text)) throw Error('Enter a USDC amount with at most 6 decimal places.'); const [a,b=''] = text.split('.'); const n = BigInt(a)*1000000n+BigInt(b.padEnd(6,'0')); if(n>999999999999n)throw Error('The spending cap is too large.'); return n.toString(); };
  function input() {
    const route = select.value, max = atomic(budget.value.trim()), base = {max_amount_atomic:max};
    if(['route-resolve','route-compare'].includes(route))return {intent:value('intent'),...base};
    if(route==='discover')return {query:value('query'),...base};
    if(route==='fact')return {kind:'npm-version',identifier:value('package'),...base};
    if(['task','schedule'].includes(route)) {
      const result={steps:[{kind:value('task-kind'),url:value('target-url'),expected_status:Number(value('expected-status'))}],budget_atomic:max,...base};
      if(route==='schedule') { const date=new Date(value('run-at')); if(!Number.isFinite(date.getTime()))throw Error('Choose a valid scheduled time.'); result.run_at=date.toISOString(); }
      return result;
    }
    return {url:value('target-url'),...(route==='verify'?{expected_status:Number(value('expected-status'))}:{}),...base};
  }
  function sync() {
    const d=definitions.find(d=>d.route===select.value);
    document.querySelector('#service-description').textContent=d.description;
    document.querySelector('#operation-price').textContent=(Number(d.amount)/1e6).toFixed(3)+' USDC';
    document.querySelector('#request-endpoint').textContent='POST /api/paid/v1/'+d.route;
    document.querySelectorAll('.service-field').forEach(group=>{const active=group.dataset.services.split(' ').includes(d.route);group.hidden=!active;group.querySelectorAll('input,textarea,select').forEach(field=>{field.disabled=!active;field.required=active;});});
    if(!advanced.checked){ try {payload.value=JSON.stringify(input(),null,2);}catch{} }
  }
  select.addEventListener('change',()=>{budget.value=(Number(definitions.find(d=>d.route===select.value).amount)/1e6).toFixed(3);advanced.checked=false;sync();});
  form.addEventListener('input',e=>{if(e.target!==payload)sync();});
  advanced.addEventListener('change',()=>{document.querySelectorAll('.service-field input,.service-field textarea,.service-field select').forEach(field=>{if(advanced.checked)field.required=false;});if(!advanced.checked)sync();});
  function notice(title,text,error=false) {summary.className='response-summary'; summary.replaceChildren();const strong=document.createElement('strong');strong.textContent=title;const p=document.createElement('p');p.textContent=text;summary.append(strong,p);status.dataset.state=error?'error':'ready';}
  form.addEventListener('submit',async e=>{
    e.preventDefault();button.disabled=true;status.textContent='REQUESTING QUOTE';status.dataset.state='';
    try{
      const data=advanced.checked?JSON.parse(payload.value):input(),body=JSON.stringify(data);
      if(body!==lastBody){lastBody=body;idempotency='web_'+(typeof crypto.randomUUID==='function'?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join(''));}
      const response=await fetch('/api/paid/v1/'+select.value,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':idempotency},body});
      const result=await response.json();
      output.textContent=JSON.stringify({http_status:response.status,idempotency_key:idempotency,payment_required:response.headers.get('Payment-Required'),quote:response.headers.get('X-XGuard-Quote'),...result},null,2);
      if(response.status===402&&response.headers.has('Payment-Required')){status.textContent='QUOTE READY';notice('Your payment quote is ready.','Nothing has been charged. Use an x402-compatible agent to authorize this exact offer, then retry the same request with its original quote and idempotency key.');}
      else if(response.ok){status.textContent='RESPONSE RECEIVED';notice('The operation returned a result.','Inspect the machine response, source evidence and explicit verification state below.');document.querySelector('#response-details').open=true;}
      else{status.textContent='REQUEST NOT COMPLETED';notice('The request could not be completed.',({paid_service_not_ready:'This operation is temporarily unavailable. Nothing has been charged. Try again shortly.',buyer_budget_too_small:'Your spending cap is below the operation price. Increase the cap and request a new quote.',rate_limited:'Too many requests. Wait briefly before trying again.'}[result.error]||'The request was rejected. Check your input or inspect the response for details.'),true);document.querySelector('#response-details').open=true;}
    }catch(error){status.textContent='INPUT OR NETWORK ERROR';notice('Check your request.',error.message,true);output.textContent=error.message;}
    finally{button.disabled=false;}
  });
  sync();
}
`;
