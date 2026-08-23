const token = String(process.env.APIFY_TOKEN || '').trim();
if (!token) throw new Error('APIFY_TOKEN is required');

const api = 'https://api.apify.com/v2';
const headers = {
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
  accept: 'application/json',
};

async function request(path, options = {}) {
  const response = await fetch(`${api}${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || text || `HTTP ${response.status}`;
    throw new Error(`${options.method || 'GET'} ${path} failed (${response.status}): ${message}`);
  }
  return payload?.data ?? payload;
}

const list = await request('/actors?limit=1000&offset=0');
const items = Array.isArray(list?.items) ? list.items : [];
const actor = items.find((item) => item?.name === 'xguard-web-extractor');
if (!actor?.id) throw new Error('xguard-web-extractor was not found after push');

const current = await request(`/actors/${actor.id}`);
const alreadyPriced = Array.isArray(current?.pricingInfos) && current.pricingInfos.some((info) => {
  if (info?.pricingModel !== 'PAY_PER_EVENT') return false;
  const event = info?.pricingPerEvent?.actorChargeEvents?.['page-result'];
  return Number(event?.eventPriceUsd) === 0.004;
});

// Establish monetization while the Actor is still private. This avoids exposing
// a public Store listing before its intended pay-per-event price is active.
if (!alreadyPriced) {
  const now = new Date().toISOString();
  const pricingInfos = [{
    pricingModel: 'PAY_PER_EVENT',
    apifyMarginPercentage: 0.2,
    createdAt: now,
    startedAt: now,
    notifiedAboutFutureChangeAt: null,
    notifiedAboutChangeAt: null,
    reasonForChange: 'Initial XGuard pay-per-result launch pricing',
    isPriceChangeNotificationSuppressed: false,
    forceContainsSignificantPriceChange: false,
    pricingPerEvent: {
      actorChargeEvents: {
        'page-result': {
          eventTitle: 'Successfully extracted page',
          eventDescription: 'Charged only after a page is successfully extracted and written to the default dataset.',
          eventPriceUsd: 0.004,
          isPrimaryEvent: true,
          isOneTimeEvent: false,
        },
      },
    },
    minimalMaxTotalChargeUsd: 0.004,
  }];
  await request(`/actors/${actor.id}`, { method: 'PUT', body: JSON.stringify({ pricingInfos }) });
}

const priced = await request(`/actors/${actor.id}`);
const activePricing = Array.isArray(priced?.pricingInfos)
  ? priced.pricingInfos.find((info) => info?.pricingModel === 'PAY_PER_EVENT' && Number(info?.pricingPerEvent?.actorChargeEvents?.['page-result']?.eventPriceUsd) === 0.004)
  : null;
if (!activePricing) throw new Error('Pay-per-event pricing was not established before publication');

const metadata = {
  title: 'XGuard Web Extractor for AI & RAG',
  description: 'Fast website extraction to clean Markdown, text, metadata, and normalized links for AI agents, RAG pipelines, and research automation.',
  seoTitle: 'XGuard Web Extractor for AI and RAG',
  seoDescription: 'Extract public websites into clean Markdown, text, metadata, and links for AI agents, RAG pipelines, research, and data ingestion.',
  isPublic: true,
  categories: ['AI'],
  actorPermissionLevel: 'LIMITED_PERMISSIONS',
  exampleRunInput: {
    body: JSON.stringify({ startUrls: [{ url: 'https://example.com' }], maxPages: 10, followLinks: true, sameDomain: true, includeLinks: true }),
    contentType: 'application/json; charset=utf-8',
  },
  defaultRunOptions: {
    build: 'latest',
    timeoutSecs: 900,
    memoryMbytes: 256,
    restartOnError: false,
    maxItems: 100,
  },
};

await request(`/actors/${actor.id}`, { method: 'PUT', body: JSON.stringify(metadata) });

const verified = await request(`/actors/${actor.id}`);
if (verified?.isPublic !== true) throw new Error('Actor is not public after publication update');
const pricing = Array.isArray(verified?.pricingInfos)
  ? verified.pricingInfos.find((x) => x?.pricingModel === 'PAY_PER_EVENT')
  : null;
const pageEvent = pricing?.pricingPerEvent?.actorChargeEvents?.['page-result'];
if (Number(pageEvent?.eventPriceUsd) !== 0.004) throw new Error('Pay-per-event pricing is not active at $0.004/page-result');

console.log(JSON.stringify({
  actorId: actor.id,
  name: verified.name,
  username: verified.username,
  public: verified.isPublic,
  pricingModel: pricing.pricingModel,
  event: 'page-result',
  eventPriceUsd: pageEvent.eventPriceUsd,
}, null, 2));
