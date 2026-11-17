import { digest, fail } from '../compute/common.js';

export { digest, fail };
export const text = (maxLength = 1000) => ({ type: 'string', minLength: 1, maxLength });
export const number = (maximum = 1000000000000) => ({ type: 'integer', minimum: 0, maximum });
export const list = (items, maxItems = 100) => ({ type: 'array', minItems: 1, maxItems, items });
export const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
export const rights = { type: 'string', enum: ['owned_or_licensed'] };
export const reference = { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9_.:-]+$' };
export const currency = { type: 'string', enum: ['USD'] };
export function validate(schema, value, path = 'input') {
  const bad = () => { throw fail('invalid_product_input', 422, { field: path }); };
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) bad();
    if (schema.required.some(k => !Object.hasOwn(value, k)) || Object.keys(value).some(k => !Object.hasOwn(schema.properties, k) || ['__proto__', 'constructor', 'prototype'].includes(k))) bad();
    for (const [key, item] of Object.entries(value)) validate(schema.properties[key], item, path + '.' + key);
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < schema.minItems || value.length > schema.maxItems) bad();
    value.forEach((item, index) => validate(schema.items, item, path + '[' + index + ']'));
  } else if (schema.type === 'string') {
    if (typeof value !== 'string' || value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity) || (schema.pattern && !new RegExp(schema.pattern).test(value))) bad();
  } else if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value) || value < schema.minimum || value > schema.maximum) bad();
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') bad();
  if (schema.enum && !schema.enum.includes(value)) bad();
}
export function unique(items, field = 'id') {
  if (new Set(items.map(x => x[field])).size !== items.length) throw fail('duplicate_product_reference', 422, { field });
}
export function safeNumber(value) {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw fail('product_amount_overflow', 422);
  return Number(value);
}
export function subtotal(unit, quantity) { return safeNumber(BigInt(unit) * BigInt(quantity)); }
export function iso(value) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)) throw fail('invalid_product_timestamp', 422);
  return new Date(value).toISOString();
}
export function definition(route, name, description, schema, example, execute, check = () => {}) {
  return { id: 'commerce-' + route, route, name, description, amount: '100000', schema, example: { ...example, max_amount_atomic: '100000' }, execute, check };
}
