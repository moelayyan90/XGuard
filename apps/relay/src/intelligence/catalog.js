export const BASE = 'https://api.xguardgate.com/api/intelligence/v1';
export const UNIT_ATOMIC = 1000n;
export const BATCH_LIMIT = 100;
const text = (maxLength = 180) => ({ type: 'string', minLength: 1, maxLength });
const choice = (...values) => ({ type: 'string', enum: values });
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
const fact = text(300);
const page = { type:'integer',minimum:1,maximum:10000 };
const timeRange = { fact, from:text(24), to:text(24) };
const cursor = object({observed_at:text(24), id:text(100)});
const ecosystem = choice('npm','PyPI','Go','crates.io','Maven','NuGet');
const pkg = { ecosystem, name: text(180), version: text(100) };
const providers = choice('github','cloudflare','anthropic','openai','npm');
const service = (route, name, description, schema, example) => ({
  id: 'intel-' + route, route, name, description, schema, example, amount: '1000',
});
const definitions = [
  service('facts','Live Facts 2.0','Read one recorded primary-source fact, its verification time, age, confidence and recent observations.',
    object({ fact }), { fact: 'npm/react/latest-version' }),
  service('dependencies','Dependency Intelligence','Check an exact release against OSV. For npm and PyPI, include publisher evidence, withdrawal or deprecation, and the linked GitHub repository’s archive state when available.',
    object(pkg), { ecosystem: 'npm', name: 'react', version: '19.0.0' }),
  service('breaking-changes','API Breaking Changes','Compare two supplied OpenAPI 3 documents for route, parameter, authentication and JSON contract changes. Unsupported constructs are reported explicitly.',
    object({ before: { type: 'object' }, after: { type: 'object' } }), {}),
  service('models','AI Model Intelligence','Read a published OpenAI model card, one observed price field, or compare the documented text-token costs of two models for a bounded workload.',
    {oneOf:[object({fact}),object({model:text(80)}),object({models:{type:'array',minItems:2,maxItems:2,items:text(80)},input_tokens:{type:'integer',minimum:0,maximum:10000000},output_tokens:{type:'integer',minimum:0,maximum:1000000}})]}, {model:'gpt-4o'}),
  service('compatibility','Code Compatibility','Check an exact runtime or peer version against an exact npm release’s published Node.js engine or peer dependency range.',
    object({ name: text(), version: text(100), target: text(), target_version: text(100) }),
    { name: 'vite', version: '6.0.0', target: 'node', target_version: '22.0.0' }),
  service('failures','Production Failure Intelligence','Look up a supported Cloudflare Workers error in the official error reference and return the documented diagnostic steps.',
    object({ provider: choice('cloudflare-workers'), code: choice('1101','1102','1019','1021','1022','1024','1027','1042') }),
    { provider: 'cloudflare-workers', code: '1102' }),
  service('infrastructure','Infrastructure Intelligence','Return a provider’s recorded service status, cited evidence and a deployment or incident-response action.',
    object({ provider: providers }), { provider: 'cloudflare' }),
  service('tools','AI Agent Tool Intelligence','Resolve a technical task to a tool, input contract, payment method and supported transports in the XGuard registry.',
    object({ task: choice('fact','dependency','api-diff','model-price','compatibility','diagnosis','cloud-status','advisory','decision') }), { task: 'api-diff' }),
  service('security','Software Security Intelligence','Look up published OSV advisories for one exact package release; returns affected-package evidence and published fix boundaries.',
    object(pkg), { ecosystem: 'PyPI', name: 'urllib3', version: '2.0.0' }),
  service('decisions','Machine Decision API','Return an evidence-scoped deployment, upgrade or dependency-security decision for one question.',
    { oneOf: [
      object({ question: choice('provider-available'), provider: providers }),
      object({ question: choice('known-vulnerabilities'), ...pkg }),
      object({ question: choice('npm-compatibility'), name: text(), version: text(100), target: text(), target_version: text(100) }),
    ] }, { question: 'provider-available', provider: 'cloudflare' }),
  service('batch','Fact batch','Return all requested fact units in order. One unavailable item aborts the entire batch before settlement.',
    object({ facts: { type: 'array', minItems: 1, maxItems: BATCH_LIMIT, items: fact } }), { facts: ['npm/react/latest-version'] }),
  service('history','Fact history','Read a bounded page of observations for one fact.',
    {oneOf:[object({fact,page},['fact']),object({...timeRange,limit:{type:'integer',minimum:1,maximum:300},cursor},['fact','from','to'])]}, { fact:'npm/react/latest-version' }),
  service('compare','Historical value comparison','Compare recorded observations for one fact at two UTC timestamps.',
    object(timeRange),{fact:'npm/react/latest-version',from:'2026-10-01T00:00:00Z',to:'2026-11-01T00:00:00Z'}),
  service('changes','Fact changes','Read adjacent observations for a fact or one page of recorded changes to a source.',
    {oneOf:[object({fact}),object({entity:text(220),change:text(100),page},['entity'])]}, {fact:'npm/react/latest-version'}),
  service('evidence','Observation evidence','Retrieve one primary-source evidence record by canonical source and observation ID.',
    object({ entity: text(220), observation: text(100) }), {}),
];
export const SERVICES = Object.freeze(definitions);
const byId = new Map(definitions.map(d => [d.id, d]));
const byRoute = new Map(definitions.map(d => [d.route, d]));
export const definitionFor = id => byId.get(id);
export const routeFor = route => byRoute.get(route);
export function amountFor(input) {
  const units = input.capability === 'intel-batch' ? input.query.facts.length : 1;
  if (!Number.isSafeInteger(units) || units < 1 || units > BATCH_LIMIT) throw new Error('invalid_unit_count');
  return (UNIT_ATOMIC * BigInt(units)).toString();
}
export function fits(schema, value) {
  if (schema.oneOf) return schema.oneOf.filter(s => fits(s, value)).length === 1;
  if (schema.enum) return schema.enum.includes(value);
  if (schema.type === 'string') return typeof value === 'string' && value.length >= (schema.minLength || 0) && value.length <= schema.maxLength && !/[\u0000-\u001f\u007f]/.test(value);
  if (schema.type === 'integer') return Number.isSafeInteger(value) && value >= schema.minimum && value <= schema.maximum;
  if (schema.type === 'array') return Array.isArray(value) && value.length >= schema.minItems && value.length <= schema.maxItems && value.every(item => fits(schema.items, item));
  if (schema.type !== 'object' || !value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!schema.properties) return true;
  return schema.required.every(k => Object.hasOwn(value,k)) && Object.keys(value).every(k => Object.hasOwn(schema.properties,k) && fits(schema.properties[k],value[k]));
}
export function price() {
  return { currency: 'USD', unit_price: '0.001', settlement_asset: 'USDC', network: 'eip155:8453', unit_amount_atomic: '1000', additional_xguard_fees: '0', batch_limit: BATCH_LIMIT };
}
