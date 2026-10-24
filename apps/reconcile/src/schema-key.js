// Schemas are build-owned JSON. Runtime schemas must match a compiled entry
// exactly, independent of object-key order; unknown schemas fail closed.
export function schemaKey(value) {
  if (Array.isArray(value)) return `[${value.map(schemaKey).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${schemaKey(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
