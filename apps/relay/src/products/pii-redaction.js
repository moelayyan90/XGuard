import { definition, object, text, list, rights } from './common.js';

const rules = [
  ['PRIVATE_KEY', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['API_SECRET', /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{20,})\b/g],
  ['BEARER_TOKEN', /\bBearer\s+[A-Za-z0-9._~+/-]{12,}={0,2}/gi],
  ['EMAIL', /\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+\b/gi],
  ['PHONE', /(?<!\w)\+\d[\d ()-]{7,22}\d(?!\w)/g],
];
export const piiRedaction = definition('redact', 'Sensitive text redaction', 'Redact email, international phone, bearer tokens and selected API/private-key patterns from supplied text. No reverse mapping is stored. Pattern coverage is limited; inspect results before sharing.', object({ rights, text: text(10000), types: list({ type: 'string', enum: rules.map(([id]) => id) }, 5) }), { rights: 'owned_or_licensed', text: 'Contact alice@example.com or +962 79 123 4567.', types: ['EMAIL', 'PHONE', 'API_SECRET', 'BEARER_TOKEN', 'PRIVATE_KEY'] }, input => {
  let result = input.text; const counts = {};
  for (const [kind, pattern] of rules) if (input.types.includes(kind)) { let n = 0; result = result.replace(pattern, () => { n++; return '[' + kind + '_REDACTED]'; }); counts[kind] = n; }
  return { text: result, counts, retained_reverse_mapping: false, coverage: 'Pattern detection only. Names, addresses, local phone numbers and unknown secret formats are not guaranteed to be removed.' };
});
