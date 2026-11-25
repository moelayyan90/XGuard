const verbs = ['get','post','put','patch','delete','head','options','trace'];
const record = v => v && typeof v === 'object' && !Array.isArray(v);
const sorted = obj => Array.isArray(obj) ? obj.map(sorted) : record(obj) ? Object.fromEntries(Object.keys(obj).sort().map(k => [k, sorted(obj[k])])) : obj;
const same = (a,b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
export function compareOpenApi(before, after) {
  const issues = [], limits = new Set();
  let visited = 0;
  function change(location, change, action, severity = 'breaking') {
    if (issues.length < 100) issues.push({ location, change, action, severity });
    else limits.add('Only the first 100 changes are returned.');
  }
  for (const doc of [before, after]) {
    if (!/^3\.(0|1)\.\d+$/.test(doc.openapi) || !record(doc.paths) || Object.keys(doc.paths).length > 128)
      throw new Error('unsupported_openapi_document');
  }
  function resolve(value, doc, at) {
    if (!value?.$ref) return value;
    const ref = value.$ref;
    if (typeof ref !== 'string' || !ref.startsWith('#/components/') || Object.keys(value).length !== 1) { limits.add('Reference requires manual review at ' + at); return null; }
    let target = doc;
    for (const key of ref.slice(2).split('/').map(x => x.replaceAll('~1','/').replaceAll('~0','~'))) {
      if (!record(target) || !Object.hasOwn(target,key)) { limits.add('Unresolved reference at ' + at); return null; }
      target = target[key];
    }
    if (!record(target) || target.$ref) { limits.add('Nested reference requires review at ' + at); return null; }
    return target;
  }
  function schema(left, right, at, side, depth = 0) {
    if (++visited > 1500 || depth > 10) { limits.add('Schema traversal limit reached.'); return; }
    const a = resolve(left, before, at), b = resolve(right, after, at);
    if (!a || !b) { if (left || right) limits.add('Uncompared schema at ' + at); return; }
    if (!same(a.type,b.type)) change(at,'schema_type_changed','Update the ' + side + ' serializer or decoder.', 'potentially_breaking');
    if (!same(a.enum,b.enum)) {
      const from = side === 'request' ? a.enum : b.enum, to = side === 'request' ? b.enum : a.enum;
      if (Array.isArray(to) && (!Array.isArray(from) || from.some(v => !to.some(w => same(v,w)))))
        change(at,'enum_contract_changed','Handle the changed set of allowed values.');
    }
    const ar = new Set(a.required || []), br = new Set(b.required || []);
    for (const key of (side === 'request' ? br : ar))
      if (!(side === 'request' ? ar : br).has(key)) change(at + '/' + key,side === 'request' ? 'request_field_now_required' : 'response_field_no_longer_guaranteed',side === 'request' ? 'Supply this field in requests.' : 'Handle an omitted field.');
    for (const [key, value] of Object.entries(a.properties || {})) {
      if (!Object.hasOwn(b.properties || {},key)) {
        if (side === 'response' || b.additionalProperties === false) change(at + '/' + key,'field_removed',side === 'request' ? 'Stop sending this property.' : 'Update the response decoder.');
      } else schema(value,b.properties[key],at + '/' + key,side,depth+1);
    }
    if (a.items || b.items) schema(a.items,b.items,at + '/items',side,depth+1);
    for (const key of ['allOf','anyOf','oneOf','not','if','then','else','discriminator','additionalProperties','pattern','minimum','maximum','format','nullable','const','minLength','maxLength','readOnly','writeOnly'])
      if (a[key] !== undefined || b[key] !== undefined) {
        if (!same(a[key],b[key]) || ['allOf','anyOf','oneOf','not'].includes(key)) limits.add('Review ' + key + ' at ' + at);
      }
  }
  function content(a,b,at,side) {
    for (const [kind, item] of Object.entries(a?.content || {})) {
      if (!Object.hasOwn(b?.content || {},kind)) change(at + '/' + kind,'media_type_removed','Use a supported media type.');
      else schema(item.schema,b.content[kind].schema,at + '/' + kind,side);
    }
  }
  function parameters(path, op, doc, at) {
    const map = new Map();
    for (const raw of [...(path.parameters || []), ...(op.parameters || [])]) {
      const item = resolve(raw,doc,at);
      if (item) map.set(item.in + '/' + (item.in === 'header' ? String(item.name).toLowerCase() : item.name), item);
    }
    return map;
  }
  for (const [path, entry] of Object.entries(before.paths)) {
    const previous = resolve(entry,before,path);
    if (!previous) continue;
    if (!Object.hasOwn(after.paths,path)) { change(path,'path_removed','Move callers to a supported endpoint.'); continue; }
    const next = resolve(after.paths[path],after,path);
    if (!next) continue;
    for (const verb of verbs) {
      if (!previous[verb]) continue;
      const at = verb.toUpperCase() + ' ' + path, old = previous[verb], current = next[verb];
      if (!current) { change(at,'operation_removed','Change the method or endpoint.'); continue; }
      if (!same(old.security ?? before.security ?? [], current.security ?? after.security ?? [])) change(at,'security_requirements_changed','Review supported authentication and scopes.','potentially_breaking');
      if (current.deprecated && !old.deprecated) change(at,'operation_deprecated','Plan migration before removal.','warning');
      const p = parameters(previous,old,before,at), q = parameters(next,current,after,at);
      for (const [key,param] of q) {
        if (param.required && !p.get(key)?.required) change(at + '/' + key,'parameter_now_required','Send the required parameter.');
        if (p.has(key)) schema(p.get(key).schema,param.schema,at + '/' + key,'request');
      }
      for (const key of p.keys()) if (!q.has(key)) change(at + '/' + key,'parameter_removed','Check whether the old parameter is still accepted.','potentially_breaking');
      const left = resolve(old.requestBody,before,at), right = resolve(current.requestBody,after,at);
      if (right?.required && !left?.required) change(at,'request_body_now_required','Send the documented request body.');
      content(left,right,at + '/request','request');
      for (const [status, resp] of Object.entries(old.responses || {})) {
        if (!Object.hasOwn(current.responses || {},status)) change(at + '/' + status,'response_status_removed','Update success and error handling.');
        else content(resolve(resp,before,at),resolve(current.responses[status],after,at),at + '/' + status,'response');
      }
    }
  }
  if (!same(before.components?.securitySchemes, after.components?.securitySchemes))
    change('components/securitySchemes','security_scheme_changed','Check credentials, token URLs and scopes.','potentially_breaking');
  return { findings: issues, coverage_limits: [...limits], verdict: issues.some(x => x.severity === 'breaking') ? 'breaking_changes_found' : issues.length || limits.size ? 'review_required' : 'no_change_found_in_checked_rules',
    evidence: [{ source: 'caller_supplied_openapi_documents', specification: 'https://spec.openapis.org/oas/v3.1.1.html' }],
    scope: 'Static inspection of declared interfaces. Runtime behavior and undocumented constraints require separate checks.' };
}
