import { parseHTML } from 'linkedom';
import { definition, object, list, text, reference, rights, unique, fail } from './common.js';

const schema = object({ rights, html: text(10000), row_selector: text(150), fields: list(object({ name: reference, selector: text(150), attribute: { type: 'string', enum: ['text', 'href', 'src', 'content', 'datetime', 'data-id'] } }), 20) });
function inspect(input) {
  const { document } = parseHTML(input.html), rows = [...document.querySelectorAll(input.row_selector)];
  if (rows.length > 100) throw fail('dom_row_limit', 422);
  for (const f of input.fields) document.querySelectorAll(f.selector);
  return rows;
}
function transform(input) {
  return inspect(input).map(row => Object.fromEntries(input.fields.map(f => {
    const node = row.querySelector(f.selector);
    return [f.name, node ? (f.attribute === 'text' ? node.textContent.trim() : node.getAttribute(f.attribute)) : null];
  })));
}
export const domToApi = definition('dom-to-api', 'HTML to structured JSON', 'Apply CSS selectors to your supplied HTML and return a JSON dataset and schema. No JavaScript execution or remote fetches. Live website monitoring requires an authorized source adapter.', schema, { rights: 'owned_or_licensed', html: '<main><article><h2>GPU plan</h2><span class="price">$5</span></article></main>', row_selector: 'article', fields: [{ name: 'name', selector: 'h2', attribute: 'text' }, { name: 'price', selector: '.price', attribute: 'text' }] }, input => {
  const rows = transform(input);
  return { rows, schema: { type: 'array', items: { type: 'object', properties: Object.fromEntries(input.fields.map(f => [f.name, { type: ['string', 'null'] }])), additionalProperties: false } }, mapping: { row_selector: input.row_selector, fields: input.fields }, remote_requests: 0, scripts_executed: 0 };
}, input => { unique(input.fields, 'name'); try { const rows = transform(input); if (new TextEncoder().encode(JSON.stringify(rows)).length > 80000) throw fail('dom_result_limit', 422); } catch (e) { if (e.code) throw e; throw fail('invalid_css_selector', 422); } });
