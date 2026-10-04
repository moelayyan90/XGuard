import { sourceSpec, parseSource } from '../apps/relay/src/live/adapters.ts';
import { safeFetch, boundedBody, robotsAllows } from '../apps/relay/src/live/security.ts';
const sources = [['npm', 'react'], ['pypi', 'requests'], ['github', 'microsoft/vscode'], ['nodejs', 'current'], ['python', 'stable'], ['status', 'github'], ['pricing', 'openai'], ['pricing', 'anthropic']];
const results = await Promise.all(sources.map(async ([adapter, identifier]) => {
  const spec = sourceSpec(adapter, identifier);
  try {
    const robot = await safeFetch(`https://${spec.domain}/robots.txt`, { accept: 'text/plain' });
    if (robot.status !== 404 && !robot.ok) throw new Error(`robots_http_${robot.status}`);
    const rules = robot.status === 404 ? '' : await boundedBody(robot, 512000);
    if (!robotsAllows(rules, new URL(spec.url).pathname)) throw new Error('robots_disallowed');
    const response = await safeFetch(spec.url); if (!response.ok) throw new Error(`source_http_${response.status}`);
    const parsed = parseSource(spec, await boundedBody(response));
    return { source: spec.id, verified_facts: parsed.facts.length, first_fact: parsed.facts[0], checked_at: new Date().toISOString() };
  } catch (error) { return { source: spec.id, error: String(error) }; }
}));
console.log(JSON.stringify(results, null, 2));
if (!results.some(x => x.verified_facts > 0)) process.exitCode = 1;
