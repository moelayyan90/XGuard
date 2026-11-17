import { fail } from '../compute/common.js';

export function approvedPartners(env, now = Date.now()) {
  if (!env.XGUARD_APPROVED_PARTNERS_JSON) return [];
  let records;
  try { records = JSON.parse(env.XGUARD_APPROVED_PARTNERS_JSON); } catch { throw fail('partner_configuration_invalid', 503); }
  if (!Array.isArray(records) || records.length > 30) throw fail('partner_configuration_invalid', 503);
  const ids = new Set();
  return records.map(record => {
    if (!record || !/^[a-z0-9-]{1,80}$/.test(record.id) || ids.has(record.id) || typeof record.name !== 'string' || record.name.length > 150 || !Array.isArray(record.capabilities) || record.capabilities.length > 20 || record.capabilities.some(c => !/^[a-z0-9-]{1,80}$/.test(c)) || typeof record.agreement_reference !== 'string' || !record.agreement_reference.length || record.agreement_reference.length > 300 || !Number.isFinite(Date.parse(record.agreement_valid_until)) || !Number.isInteger(record.commission_bps) || record.commission_bps < 0 || record.commission_bps > 10000) throw fail('partner_configuration_invalid', 503);
    let url;
    try { url = new URL(record.offer_url); } catch { throw fail('partner_configuration_invalid', 503); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || url.search || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(url.hostname)) throw fail('partner_configuration_invalid', 503);
    ids.add(record.id);
    return { id: record.id, name: record.name, capabilities: record.capabilities, offer_url: url.href, agreement_reference: record.agreement_reference, agreement_valid_until: record.agreement_valid_until, commission_bps: record.commission_bps, commercial_disclosure: record.commission_bps ? 'XGuard may receive a commission under the referenced agreement.' : 'No referral commission configured.', price: null, capacity: 'UNKNOWN', conversion_tracking: 'Not activated' };
  }).filter(p => Date.parse(p.agreement_valid_until) > now);
}
export const distributionChannels = [
  { id: 'mcp', endpoint: 'https://xguardgate.com/mcp', role: 'First-party tool discovery; pre-existing official registry listing io.github.moelayyan90/xguard verified on 2026-11-17 at version 6.0.0', external_marketplace_listing_verified: true, evidence: 'https://registry.modelcontextprotocol.io/v0.1/servers/io.github.moelayyan90%2Fxguard/versions/6.0.0' },
  { id: 'a2a', endpoint: 'https://xguardgate.com/.well-known/agent-card.json', role: 'First-party agent discovery', external_marketplace_listing_verified: false },
  { id: 'openapi', endpoint: 'https://xguardgate.com/openapi.json', role: 'First-party API contract', external_marketplace_listing_verified: false },
  { id: 'x402', endpoint: 'https://api.xguardgate.com/api/paid/v1/catalog', role: 'Existing x402 service discovery and attributed payment requirements', external_marketplace_listing_verified: false },
  { id: 'products', endpoint: 'https://xguardgate.com/products', role: 'Search-indexable service pages with truthful scope', external_marketplace_listing_verified: false },
];
