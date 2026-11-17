import { definition, object, list, reference, text, rights, digest, unique, iso, fail } from './common.js';

const schema = object({ version: reference, rights, sources: list(object({ id: reference, source: text(1500), observed_at: text(30), content: text(8000) }), 10) });
export const contextCapsules = definition('context-capsule', 'Attributed context capsule', 'Package owned or licensed text into a versioned, hashed context capsule. Removes exact duplicate paragraphs and preserves source attribution. No inferred facts or promised token reduction.', schema, { version: 'v1', rights: 'owned_or_licensed', sources: [{ id: 'policy', source: 'owner-provided policy', observed_at: '2026-11-17T00:00:00Z', content: 'Refund requests need an order reference.\n\nRefund requests need an order reference.' }] }, async input => {
  const paragraphs = [], positions = new Map(), provenance = [];
  for (const source of input.sources) {
    const ids = [];
    for (const p of source.content.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean)) {
      if (!positions.has(p)) { positions.set(p, paragraphs.length); paragraphs.push(p); }
      ids.push(positions.get(p));
    }
    provenance.push({ id: source.id, source: source.source, observed_at: iso(source.observed_at), content_sha256: await digest(source.content), paragraph_indices: ids });
  }
  const content = paragraphs.join('\n\n');
  return { version: input.version, content, content_sha256: await digest(content), sources: provenance, input_characters: input.sources.reduce((n, s) => n + s.content.length, 0), output_characters: content.length, compression: 'Exact paragraph deduplication only. Rights are an uploader attestation, not an independently verified license.' };
}, input => { unique(input.sources); for (const s of input.sources) iso(s.observed_at); if (input.sources.reduce((n, s) => n + s.content.length, 0) > 10000) throw fail('context_size_limit', 422); });
