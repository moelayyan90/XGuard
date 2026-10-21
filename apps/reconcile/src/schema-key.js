// Object key order is immaterial to JSON Schema; array order remains intact.
export function schemaKey(value) {
  if (Array.isArray(value)) return `[${value.map(schemaKey).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${schemaKey(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
