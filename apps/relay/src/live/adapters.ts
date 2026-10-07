import { parseHTML } from 'linkedom';
import type { Adapter, ParsedFact, ParsedSource, SourceSpec } from './types.ts';

const STATUS: Record<string, [string, string]> = {
  github: ['GitHub', 'https://www.githubstatus.com/api/v2/summary.json'],
  cloudflare: ['Cloudflare', 'https://www.cloudflarestatus.com/api/v2/summary.json'],
  anthropic: ['Anthropic', 'https://status.claude.com/api/v2/summary.json'],
  openai: ['OpenAI', 'https://status.openai.com/api/v2/summary.json'],
  npm: ['npm', 'https://status.npmjs.org/api/v2/summary.json'],
};
const PRICING: Record<string, [string, string, string]> = {
  openai: ['OpenAI API pricing', 'https://developers.openai.com/api/docs/pricing/', 'ai-model-pricing'],
  anthropic: ['Anthropic API pricing', 'https://platform.claude.com/docs/en/about-claude/pricing', 'ai-model-pricing'],
};
export function sourceSpec(adapter: Adapter, input: string): SourceSpec {
  let identifier = input.trim(), url = '', title = identifier, topic = '', interval = 86400, maxAge = 172800, sourceType = 'official-registry';
  if (adapter === 'npm') {
    if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(identifier) || identifier.length > 214) throw new Error('invalid_npm_package');
    url = `https://registry.npmjs.org/${encodeURIComponent(identifier)}/latest`; topic = 'javascript-packages'; title = `${identifier} · npm`;
  } else if (adapter === 'pypi') {
    identifier = identifier.toLowerCase().replace(/[-_.]+/g, '-');
    if (!/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(identifier)) throw new Error('invalid_pypi_package');
    url = `https://pypi.org/pypi/${identifier}/json`; topic = 'python-packages'; title = `${identifier} · PyPI`;
  } else if (adapter === 'github') {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]{1,100}$/.test(identifier) || identifier.includes('..')) throw new Error('invalid_repository');
    identifier = identifier.toLowerCase(); url = `https://api.github.com/repos/${identifier}/releases/latest`; topic = 'software-releases'; sourceType = 'official-api';
  } else if (adapter === 'nodejs') {
    if (!['current', 'lts'].includes(identifier)) throw new Error('invalid_node_channel');
    url = 'https://nodejs.org/dist/index.json'; title = `Node.js · ${identifier}`; topic = 'runtimes'; interval = 21600; maxAge = 86400;
  } else if (adapter === 'python') {
    if (identifier !== 'stable') throw new Error('invalid_python_channel');
    url = 'https://www.python.org/ftp/python/'; title = 'Python · stable release directory'; topic = 'runtimes'; sourceType = 'official-index'; interval = 43200;
  } else if (adapter === 'status' && STATUS[identifier]) {
    [title, url] = STATUS[identifier]; title += ' · service status'; topic = 'service-status'; interval = 600; maxAge = 1800; sourceType = 'official-api';
  } else if (adapter === 'pricing' && PRICING[identifier]) {
    [title, url, topic] = PRICING[identifier]; sourceType = 'official-documentation'; interval = 43200; maxAge = 86400;
  } else throw new Error('unsupported_source');
  return { id: `${adapter}/${identifier}`, adapter, identifier, title, topic, url, domain: new URL(url).hostname, interval, maxAge, sourceType };
}
const validString = (value: any, max = 256): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u0008]/.test(value);
const dateValue = (value: any) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const versionOrder = (a: string, b: string) => {
  const aa = a.replace(/^v/, '').split('.').map(Number), bb = b.replace(/^v/, '').split('.').map(Number);
  return (bb[0] - aa[0]) || (bb[1] - aa[1]) || (bb[2] - aa[2]);
};

export function parseSource(spec: SourceSpec, body: string): ParsedSource {
  const facts: ParsedFact[] = [], related: string[] = [];
  const add = (key: string, label: string, value: any, unit?: string) => {
    if (value === undefined || value === null || value === '' || (typeof value === 'string' && value.length > 500)) return;
    facts.push({ key, label, value, unit, valueType: typeof value === 'object' ? 'object' : typeof value });
  };
  const data = ['python', 'pricing'].includes(spec.adapter) ? null : JSON.parse(body);
  if (spec.adapter === 'npm') {
    if (data.name !== spec.identifier || !validString(data.version, 100)) throw new Error('npm_schema_mismatch');
    add('latest-version', 'Latest release version', data.version);
    add('node-requirement', 'Required Node.js version', data.engines?.node);
    add('npm-requirement', 'Required npm version', data.engines?.npm);
    add('license', 'Declared license', typeof data.license === 'string' ? data.license : data.license?.type);
    add('deprecated', 'Deprecation declared by publisher', Boolean(data.deprecated));
    for (const dependency of Object.keys(data.dependencies || {}).slice(0, 30)) {
      try { related.push(sourceSpec('npm', dependency).id); } catch { /* Invalid dependency names cannot enter discovery. */ }
    }
  } else if (spec.adapter === 'pypi') {
    if (!data.info || sourceSpec('pypi', data.info.name).identifier !== spec.identifier || !validString(data.info.version, 100)) throw new Error('pypi_schema_mismatch');
    add('latest-version', 'Latest release version', data.info.version);
    add('python-requirement', 'Required Python version', data.info.requires_python);
    add('license', 'Declared license expression', data.info.license_expression);
    const files = data.releases?.[data.info.version] ?? data.urls ?? [];
    if (files.length) {
      const dates = files.map((x: any) => dateValue(x.upload_time_iso_8601)).filter(Boolean).sort();
      if (dates.length) add('release-published', 'First distribution upload for latest release', dates[0], 'ISO 8601 UTC');
      if (files.every((x: any) => typeof x.yanked === 'boolean')) add('release-yanked', 'All latest-release distributions yanked', files.every((x: any) => x.yanked));
    }
    for (const dependency of data.info.requires_dist || []) {
      const name = String(dependency).match(/^[a-zA-Z0-9_.-]+/)?.[0];
      if (name) try { related.push(sourceSpec('pypi', name).id); } catch { /* Fail closed. */ }
    }
  } else if (spec.adapter === 'github') {
    if (!validString(data.tag_name, 100) || data.draft !== false || !dateValue(data.published_at)) throw new Error('release_schema_mismatch');
    const url = new URL(data.html_url);
    if (url.hostname !== 'github.com' || !url.pathname.toLowerCase().startsWith(`/${spec.identifier}/releases/`)) throw new Error('release_origin_mismatch');
    add('latest-release', 'Latest published release tag', data.tag_name);
    add('release-published', 'Release publication time', dateValue(data.published_at), 'ISO 8601 UTC');
    add('prerelease', 'Publisher marks release as prerelease', Boolean(data.prerelease));
  } else if (spec.adapter === 'nodejs') {
    if (!Array.isArray(data)) throw new Error('node_schema_mismatch');
    const release = data.filter((x: any) => /^v\d+\.\d+\.\d+$/.test(x.version) && (spec.identifier === 'current' || x.lts)).sort((a: any, b: any) => versionOrder(a.version, b.version))[0];
    if (!release || !dateValue(release.date)) throw new Error('node_release_missing');
    add('latest-version', 'Latest release version', release.version);
    add('release-published', 'Release date', release.date, 'YYYY-MM-DD');
    add('lts-codename', 'Release LTS designation', release.lts || 'Not designated LTS');
    add('bundled-npm', 'Bundled npm version', release.npm);
    add('v8-version', 'Bundled V8 version', release.v8);
  } else if (spec.adapter === 'python') {
    const versions = [...body.matchAll(/href="(3\.\d+\.\d+)\/"/g)].map(x => x[1]).sort(versionOrder);
    if (!versions.length) throw new Error('python_index_schema_mismatch');
    // A directory listing is not proof of support status or an exact release date.
    add('latest-listed-version', 'Highest stable-format version in the official release directory', versions[0]);
  } else if (spec.adapter === 'status') {
    if (!data.page || !data.status || !['none', 'minor', 'major', 'critical', 'maintenance'].includes(data.status.indicator)) throw new Error('status_schema_mismatch');
    add('service-status', 'Published service status indicator', data.status.indicator);
    add('status-updated', 'Provider status update time', dateValue(data.page.updated_at), 'ISO 8601 UTC');
    if (Array.isArray(data.incidents)) add('active-incidents', 'Incidents listed in provider summary', data.incidents.length, 'incidents');
    for (const component of (data.components || []).slice(0, 100)) {
      if (!/^[a-z0-9]{3,40}$/i.test(component.id) || !validString(component.name, 100) || !validString(component.status, 50)) continue;
      add(`component-${component.id.toLowerCase()}`, `${component.name} status`, component.status);
    }
  } else if (spec.adapter === 'pricing') {
    const { document } = parseHTML(body);
    // Current OpenAI tables explicitly distinguish service tier and context band.
    // Publish only rendered rows with this exact table schema; never collapse rates.
    if (spec.identifier === 'openai') for (const island of Array.from(document.querySelectorAll('astro-island[component-export="TextTokenPricingTables"]'))) {
      let props: any; try { props = JSON.parse(island.getAttribute('props') || '{}'); } catch { continue; }
      const tier = props.tier?.[1]; if (!['standard', 'batch', 'flex', 'fast', 'ultrafast'].includes(tier)) continue;
      let parent = island.parentElement, denomination = false;
      for (let i = 0; parent && i < 4; i++, parent = parent.parentElement) {
        if (/prices\s+per\s+1m\s+tokens/i.test(parent.previousElementSibling?.textContent || '')) denomination = true;
      }
      if (!denomination) continue;
      for (const table of Array.from(island.querySelectorAll('table'))) {
        const headings = Array.from(table.querySelectorAll('thead tr'));
        if (headings.length !== 2 || headings[0].textContent?.trim() !== 'Short contextLong context') continue;
        const columns = Array.from(headings[1].querySelectorAll('th')).map(x => x.textContent?.trim().toLowerCase());
        if (columns.join('|') !== 'model|input|cached input|cache writes|output|input|cached input|cache writes|output') continue;
        for (const row of Array.from(table.querySelectorAll('tbody tr'))) {
          const cells = Array.from(row.querySelectorAll('td')).map(x => x.textContent?.trim() || '');
          if (cells.length !== 9 || !/^[a-zA-Z0-9._-]{1,70}$/.test(cells[0])) continue;
          for (const [band, start] of [['short-context', 1], ['long-context', 5]] as const) {
            for (const [field, offset] of [['input', 0], ['output', 3]] as const) {
              const raw = cells[start + offset]; if (!/^\$\d+(?:\.\d+)?$/.test(raw)) continue;
              add(`${cells[0].toLowerCase()}-${tier}-${band}-${field}-price`, `${cells[0]} · ${tier} · ${band.replace('-', ' ')} · ${field} price`, Number(raw.slice(1)), 'USD / 1 million tokens');
            }
          }
        }
      }
    }
    for (const table of Array.from(document.querySelectorAll('table'))) {
      const rows = Array.from(table.querySelectorAll('tr'));
      const headers = Array.from(rows[0]?.querySelectorAll('th,td') || []).map(x => (x.textContent || '').trim().toLowerCase());
      const nameIndex = headers.findIndex(x => /^(model|model name)$/.test(x));
      const inputIndex = headers.findIndex(x => /^(base )?input( price| tokens)?$/.test(x));
      const outputIndex = headers.findIndex(x => /^output( price| tokens)?$/.test(x));
      if (nameIndex < 0 || inputIndex < 0 || outputIndex < 0) continue;
      // Parse only tables explicitly stating the denominator. Ambiguous tables remain unpublished.
      const context = (table.parentElement?.textContent || '').slice(0, 16000);
      if (!/(per\s+(?:1\s*)?(?:million|1m)\s+tokens|\/\s*mtok)/i.test(context)) continue;
      for (const row of rows.slice(1)) {
        const cells = Array.from(row.querySelectorAll('td')).map(x => (x.textContent || '').trim());
        const name = cells[nameIndex];
        if (!validString(name, 80) || !/^[a-zA-Z0-9 ._():-]+$/.test(name)) continue;
        for (const [field, idx] of [['input', inputIndex], ['output', outputIndex]] as const) {
          const raw = cells[idx]?.replace(/\s*\/\s*MTok\s*$/i, '').trim();
          if (!/^\$\d+(?:\.\d+)?$/.test(raw || '')) continue;
          const key = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')}-${field}-price`;
          if (!facts.some(x => x.key === key)) add(key, `${name} · ${field} token list price`, Number(raw.slice(1)), 'USD / 1 million tokens');
        }
      }
    }
    if (!facts.length) throw new Error('pricing_table_unverified');
  }
  if (!facts.length) throw new Error('no_verified_facts');
  return { facts, related: related.slice(0, 30), exhaustive: spec.adapter !== 'pricing' };
}

export const SEED_SOURCES = [
  ...'react react-dom next typescript vite vue nuxt svelte express fastify hono zod axios lodash date-fns dayjs eslint prettier vitest jest playwright puppeteer webpack rollup esbuild tailwindcss postcss sass sharp socket.io dotenv commander chalk debug semver uuid nanoid yargs cross-env tsx ts-node undici ajv openai @anthropic-ai/sdk @google/genai @modelcontextprotocol/sdk @tanstack/react-query @prisma/client prisma drizzle-orm @aws-sdk/client-s3 @supabase/supabase-js @sentry/node @babel/core'.split(' ').map(x => sourceSpec('npm', x)),
  ...'requests urllib3 httpx aiohttp flask django fastapi pydantic numpy pandas scipy scikit-learn matplotlib pillow sqlalchemy alembic psycopg boto3 botocore openai anthropic google-genai transformers torch tensorflow tokenizers datasets tiktoken langchain llama-index chromadb qdrant-client pytest ruff black mypy uv pip setuptools wheel packaging virtualenv poetry rich click typer celery redis beautifulsoup4 lxml scrapy cryptography pyjwt python-dotenv huggingface-hub sentence-transformers'.split(' ').map(x => sourceSpec('pypi', x)),
  ...['microsoft/vscode', 'facebook/react', 'vercel/next.js', 'oven-sh/bun', 'denoland/deno', 'astral-sh/uv', 'astral-sh/ruff', 'ollama/ollama', 'huggingface/transformers', 'pytorch/pytorch', 'kubernetes/kubernetes', 'redis/redis'].map(x => sourceSpec('github', x)),
  sourceSpec('nodejs', 'current'), sourceSpec('nodejs', 'lts'), sourceSpec('python', 'stable'),
  ...Object.keys(STATUS).map(x => sourceSpec('status', x)), ...Object.keys(PRICING).map(x => sourceSpec('pricing', x)),
];
export const DISCOVERY_QUERIES = ['react', 'typescript', 'node', 'testing', 'cli', 'server', 'database', 'ai', 'web', 'security', 'build', 'framework'];
