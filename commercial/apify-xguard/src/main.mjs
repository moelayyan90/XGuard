import { Actor, log } from 'apify';
import { CheerioCrawler } from 'crawlee';
import TurndownService from 'turndown';

const DEFAULT_MAX_PAGES = 100;
const DEFAULT_MAX_CONTENT_CHARS = 200_000;
const MAX_LINKS_PER_RESULT = 200;

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function assertPublicUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only HTTP and HTTPS URLs are allowed');
  if (parsed.username || parsed.password) throw new Error('URLs containing credentials are not allowed');

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    hostname === 'localhost' ||
    hostname === 'localhost.localdomain' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === '::1' ||
    hostname.startsWith('fe80:') ||
    hostname.startsWith('fc') ||
    hostname.startsWith('fd') ||
    isPrivateIpv4(hostname)
  ) {
    throw new Error('Private, loopback, link-local, and internal destinations are blocked');
  }
  return parsed;
}

function normalizeText(value) {
  return String(value ?? '')
    .replace(/\r/g, '')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function absoluteUrl(value, base) {
  try {
    const resolved = new URL(value, base);
    return ['http:', 'https:'].includes(resolved.protocol) ? resolved.href : null;
  } catch {
    return null;
  }
}

function extractPage($, url, statusCode, input) {
  const title = normalizeText($('title').first().text());
  const description = normalizeText(
    $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '',
  );
  const lang = normalizeText($('html').attr('lang') || '');
  const canonical = absoluteUrl($('link[rel="canonical"]').attr('href') || '', url);

  const root = ($('main').first().length ? $('main').first() : $('article').first().length ? $('article').first() : $('body').first()).clone();
  root
    .find(
      'script,style,noscript,template,svg,canvas,iframe,nav,footer,form,button,input,select,textarea,[aria-hidden="true"],.advertisement,.advert,.ads,.cookie-banner,.cookie-consent',
    )
    .remove();

  const html = root.html() || '';
  const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '_',
  });
  turndown.remove(['script', 'style', 'noscript', 'iframe', 'svg', 'canvas']);

  const limit = clampInteger(input.maxContentChars, DEFAULT_MAX_CONTENT_CHARS, 1_000, 1_000_000);
  const markdown = normalizeText(turndown.turndown(html)).slice(0, limit);
  const text = normalizeText(root.text()).slice(0, limit);

  const links = [];
  if (input.includeLinks !== false) {
    const seen = new Set();
    $('a[href]').each((_, element) => {
      if (links.length >= MAX_LINKS_PER_RESULT) return;
      const href = absoluteUrl($(element).attr('href'), url);
      if (!href || seen.has(href)) return;
      try {
        assertPublicUrl(href);
      } catch {
        return;
      }
      seen.add(href);
      links.push({ url: href, text: normalizeText($(element).text()).slice(0, 300) });
    });
  }

  return {
    url,
    statusCode,
    title,
    description,
    lang: lang || null,
    canonical,
    markdown,
    text,
    links,
    contentLength: markdown.length,
    extractedAt: new Date().toISOString(),
    product: 'XGuard Web Extractor',
    schemaVersion: 1,
  };
}

await Actor.init();

try {
  const input = (await Actor.getInput()) || {};
  const maxPages = clampInteger(input.maxPages, DEFAULT_MAX_PAGES, 1, 10_000);
  const sources = Array.isArray(input.startUrls) ? input.startUrls : [];
  const startUrls = sources
    .map((source) => (typeof source === 'string' ? source : source?.url))
    .filter(Boolean)
    .map((url) => assertPublicUrl(url).href);

  if (startUrls.length === 0) throw new Error('At least one valid start URL is required');

  let chargeLimitReached = false;

  const crawler = new CheerioCrawler({
    maxRequestsPerCrawl: maxPages,
    requestHandlerTimeoutSecs: 45,
    maxRequestRetries: 2,
    preNavigationHooks: [
      async ({ request }) => {
        assertPublicUrl(request.url);
      },
    ],
    async requestHandler({ request, $, response, enqueueLinks }) {
      if (chargeLimitReached) return;

      const loadedUrl = request.loadedUrl || request.url;
      assertPublicUrl(loadedUrl);
      const contentType = String(response?.headers?.['content-type'] || response?.headers?.get?.('content-type') || '');
      if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
        log.info(`Skipping non-HTML response: ${loadedUrl}`);
        return;
      }

      const result = extractPage($, loadedUrl, response?.statusCode || 200, input);
      if (!result.markdown && !result.text) {
        log.info(`Skipping empty page: ${loadedUrl}`);
        return;
      }

      // Apify stores the result first and then charges the custom event. Failed or
      // empty pages never reach this line, so they are not charged.
      const charge = await Actor.pushData(result, 'page-result');
      chargeLimitReached = Boolean(charge?.eventChargeLimitReached);

      if (!chargeLimitReached && input.followLinks !== false) {
        await enqueueLinks({
          strategy: input.sameDomain === false ? 'all' : 'same-domain',
          selector: 'a[href]',
        });
      }
    },
    failedRequestHandler({ request, error }) {
      log.warning(`Page failed and was not charged: ${request.url}`, { error: error?.message });
    },
  });

  await crawler.run(startUrls);
  log.info('XGuard extraction run finished', { maxPages, chargeLimitReached });
} finally {
  await Actor.exit();
}
