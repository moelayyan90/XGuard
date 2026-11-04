import { ORIGIN } from './types.ts';

export const factExample = 'npm/react/latest-version';
const factIdPattern = '^[A-Za-z0-9][A-Za-z0-9_.-]*(?:/[@A-Za-z0-9][A-Za-z0-9_.-]*){2,3}$';
const factIdRegex = new RegExp(factIdPattern);
export const factIdSchema = { type: 'string', maxLength: 350, pattern: factIdPattern,
  description: 'Canonical fact ID, for example ' + factExample } as const;

export function isPublicFactId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= factIdSchema.maxLength && factIdRegex.test(value);
}

export async function readPublicFact(factId: string, read: (request: Request) => Promise<Response>) {
  const canonicalUrl = ORIGIN + '/fact/' + factId;
  const source = await read(new Request(canonicalUrl, {
    headers: { accept: 'application/json', 'user-agent': 'XGuardLive-FactTransport/1.0' },
  }));
  if (source.status === 404) return null;
  if (!source.ok) throw new Error('Public fact temporarily unavailable');
  const { fact } = await source.json() as { fact?: Record<string, unknown> };
  if (fact?.id !== factId) throw new Error('Public fact ID mismatch');
  return { fact, canonicalUrl };
}
