const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim().replace(/^Bearer\s+/i, '');
const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();

if (!token || !accountId) throw new Error('Cloudflare deployment credentials unavailable');

const bindings = process.argv.slice(2).map((entry) => {
  const separator = entry.indexOf('=');
  if (separator <= 0 || separator === entry.length - 1) throw new Error(`Invalid domain binding: ${entry}`);
  return { hostname: entry.slice(0, separator), service: entry.slice(separator + 1) };
});

if (bindings.length === 0) throw new Error('At least one hostname=service binding is required');

const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/domains`;
const headers = {
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
  accept: 'application/json',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  return { response, payload };
}

async function listDomains() {
  const { response, payload } = await call(base);
  if (!response.ok || payload?.success !== true || !Array.isArray(payload?.result)) {
    throw new Error(`Unable to list Worker custom domains (HTTP ${response.status})`);
  }
  return payload.result;
}

async function findDomain(hostname) {
  const domains = await listDomains();
  return domains.find((domain) => String(domain?.hostname || '').toLowerCase() === hostname.toLowerCase()) || null;
}

async function detach(domain) {
  const { response } = await call(`${base}/${encodeURIComponent(domain.id)}`, { method: 'DELETE' });
  if (!response.ok) {
    throw new Error(`Unable to detach ${domain.hostname} from ${domain.service || 'unknown'} (HTTP ${response.status})`);
  }

  for (let attempt = 1; attempt <= 12; attempt += 1) {
    if (!(await findDomain(domain.hostname))) return;
    await sleep(Math.min(500 * attempt, 3000));
  }
  throw new Error(`Timed out waiting for ${domain.hostname} to detach`);
}

async function attach(hostname, service) {
  const body = JSON.stringify({ hostname, service, zone_name: 'xguardgate.com' });

  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const { response, payload } = await call(base, { method: 'PUT', body });
    if (response.ok && payload?.success === true) return;

    const current = await findDomain(hostname).catch(() => null);
    if (current?.service === service) return;

    if (response.status !== 409 && response.status < 500) {
      const message = payload?.errors?.map((error) => error?.message).filter(Boolean).join('; ') || `HTTP ${response.status}`;
      throw new Error(`Unable to attach ${hostname} to ${service}: ${message}`);
    }
    await sleep(Math.min(1000 * attempt, 5000));
  }

  throw new Error(`Timed out attaching ${hostname} to ${service}`);
}

for (const { hostname, service } of bindings) {
  const current = await findDomain(hostname);
  if (current?.service === service) {
    console.log(`${hostname} already points to ${service}`);
    continue;
  }

  if (current) {
    console.log(`Moving ${hostname}: ${current.service || 'unknown'} -> ${service}`);
    await detach(current);
  } else {
    console.log(`Attaching ${hostname} -> ${service}`);
  }

  await attach(hostname, service);
  const verified = await findDomain(hostname);
  if (!verified || verified.service !== service) {
    throw new Error(`Verification failed for ${hostname}: expected ${service}, got ${verified?.service || 'unbound'}`);
  }
  console.log(`Verified ${hostname} -> ${service}`);
}
