import { definition, object, list, reference, text, rights, digest, unique, iso } from './common.js';

export const auditVault = definition('audit-manifest', 'Evidence chain manifest', 'Hash and chain your supplied evidence records and produce an exportable manifest. The paid delivery receipt signs the output digest. Source authenticity is not independently verified; results retain the existing 30-day checkout policy.', object({ rights, events: list(object({ id: reference, observed_at: text(30), source_reference: text(1500), payload: text(5000) }), 30) }), { rights: 'owned_or_licensed', events: [{ id: 'event-1', observed_at: '2026-11-17T00:00:00Z', source_reference: 'customer audit log', payload: 'Invoice 123 approved' }] }, async input => {
  let previous = '0'.repeat(64); const entries = [];
  for (const event of input.events) {
    const entry = { id: event.id, observed_at: iso(event.observed_at), source_reference: event.source_reference, payload_sha256: await digest(event.payload), previous_sha256: previous };
    previous = await digest(entry); entries.push({ ...entry, entry_sha256: previous });
  }
  return { algorithm: 'SHA-256 canonical-JSON chain', entries, root_sha256: previous, source_authenticity_verified: false, external_immutable_archive: false };
}, input => { unique(input.events); input.events.forEach(e => iso(e.observed_at)); });
