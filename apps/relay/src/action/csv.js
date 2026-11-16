import { fail } from '../compute/common.js';

export const CSV_LIMITS = { bytes: 65536, rows: 2000, columns: 40, cell: 4096 };
// Strict CSV parser: quoted newlines/commas and escaped quotes are supported.
// Reject malformed records instead of silently truncating customer data.
export function parseCsv(text, delimiter = ',') {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > CSV_LIMITS.bytes || !text.trim() || text.includes('\0')) throw fail('invalid_csv_size', 422);
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], cell = '', quoted = false, closed = false;
  const pushCell = () => { if (cell.length > CSV_LIMITS.cell) throw fail('csv_cell_limit', 422); row.push(cell); cell = ''; closed = false; if (row.length > CSV_LIMITS.columns) throw fail('csv_column_limit', 422); };
  const pushRow = () => { pushCell(); rows.push(row); row = []; if (rows.length > CSV_LIMITS.rows + 1) throw fail('csv_row_limit', 422); };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
      else cell += ch;
    } else if (ch === delimiter) pushCell();
    else if (ch === '\r' || ch === '\n') { if (ch === '\r' && text[i + 1] === '\n') i++; pushRow(); }
    else if (ch === '"' && cell === '' && !closed) quoted = true;
    else { if (closed || ch === '"') throw fail('malformed_csv', 422); cell += ch; }
    if (cell.length > CSV_LIMITS.cell) throw fail('csv_cell_limit', 422);
  }
  if (quoted) throw fail('unclosed_csv_quote', 422);
  if (cell !== '' || row.length || closed) pushRow();
  if (rows.length < 2) throw fail('csv_requires_header_and_data', 422);
  return rows;
}
export function normalizeCsv(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['csv', 'delimiter', 'trim', 'dedupe', 'key_columns'].includes(k))) throw fail('invalid_csv_input', 422);
  const delimiter = input.delimiter ?? ',';
  if (![',', ';', '\t'].includes(delimiter) || ['trim', 'dedupe'].some(k => input[k] !== undefined && typeof input[k] !== 'boolean')) throw fail('invalid_csv_options', 422);
  const rows = parseCsv(input.csv, delimiter), headers = rows[0].map(x => x.trim());
  if (headers.some(x => !x) || new Set(headers).size !== headers.length) throw fail('csv_headers_must_be_unique', 422);
  if (rows.slice(1).some(row => row.some(x => x.trim()) && row.length !== headers.length)) throw fail('csv_row_width_mismatch', 422);
  const keys = input.key_columns ?? headers;
  if (!Array.isArray(keys) || !keys.length || new Set(keys).size !== keys.length || keys.some(k => !headers.includes(k))) throw fail('invalid_csv_key_columns', 422);
  return { csv: input.csv, delimiter, trim: input.trim !== false, dedupe: input.dedupe !== false, key_columns: keys };
}
function encodeCsv(rows) {
  // Spreadsheet formula injection is neutralized in downloadable CSV files.
  return rows.map(row => row.map(value => {
    let text = String(value);
    if (/^[\s\uFEFF]*[=+@-]/.test(text) || /^[\t\r]/.test(text)) text = "'" + text;
    return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
  }).join(',')).join('\r\n') + '\r\n';
}
export function cleanCsv(raw) {
  const input = normalizeCsv(raw), rows = parseCsv(input.csv, input.delimiter), headers = rows[0].map(x => x.trim());
  const keys = input.key_columns.map(k => headers.indexOf(k));
  const seen = new Set(), clean = [headers], duplicate = [headers];
  let blanks = 0, trimmed = 0, formulas = 0;
  for (const row of rows.slice(1)) {
    if (row.every(x => !x.trim())) { blanks++; continue; }
    const next = row.map(x => { const v = input.trim ? x.trim() : x; if (v !== x) trimmed++; if (/^[\s\uFEFF]*[=+@-]/.test(v) || /^[\t\r]/.test(v)) formulas++; return v; });
    const key = JSON.stringify(keys.map(i => next[i]));
    if (input.dedupe && seen.has(key)) duplicate.push(next);
    else { seen.add(key); clean.push(next); }
  }
  const report = { input_rows: rows.length - 1, output_rows: clean.length - 1, duplicate_rows: duplicate.length - 1, blank_rows_removed: blanks, cells_trimmed: trimmed, formula_cells_escaped: formulas, columns: headers, key_columns: input.key_columns, rule: 'Case-sensitive exact key match after optional whitespace trimming. First row wins; duplicates are retained in a separate file. No values are inferred.' };
  return { files: [{ name: 'clean.csv', type: 'text/csv', content: encodeCsv(clean) }, { name: 'duplicates.csv', type: 'text/csv', content: encodeCsv(duplicate) }, { name: 'report.json', type: 'application/json', content: JSON.stringify(report, null, 2) }], report };
}
