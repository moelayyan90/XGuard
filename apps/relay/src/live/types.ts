export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Row = Record<string, any>;
export interface Sql { exec(query: string, ...values: any[]): { toArray(): Row[] }; }
export interface Storage { sql: Sql; transactionSync<T>(fn: () => T): T; setAlarm(time: number): Promise<void>; }
export interface State { storage: Storage; blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>; }
export interface Stub { fetch(request: Request): Promise<Response>; }
export interface Namespace { idFromName(name: string): any; get(id: any): Stub; }
export interface Env {
  LIVE_SHARDS: Namespace;
  LIVE_CONTROL: Namespace;
  XGUARD_OPERATOR_KEY?: string;
  LIVE_ADMIN_KEY?: string;
  LIVE_SESSION_KEY?: string;
  LIVE_REPORT_KEY?: string;
  LIVE_BOOTSTRAP?: string;
  LIVE_SOURCE_FETCHES?: string;
  MONETIZATION_MODE?: string;
  CF_VERSION_METADATA?: { id: string; tag?: string };
}
export interface Context { waitUntil(promise: Promise<any>): void; }
export type Adapter = 'npm' | 'pypi' | 'github' | 'nodejs' | 'python' | 'status' | 'pricing';
export interface SourceSpec {
  id: string; adapter: Adapter; identifier: string; title: string; topic: string;
  url: string; domain: string; interval: number; maxAge: number; sourceType: string;
}
export interface ParsedFact { key: string; label: string; value: Json; unit?: string; valueType?: string; }
export interface ParsedSource { facts: ParsedFact[]; related: string[]; exhaustive: boolean; }
export interface ObservationInput { spec: SourceSpec; facts: ParsedFact[]; observedAt: string; hash: string; fetchId: string; method: string; etag?: string; lastModified?: string; related?: string[]; exhaustive?: boolean; }
export const ORIGIN = 'https://xguardgate.com';
export const SHARDS = 32; // Persisted placement contract. Never change without a migration.
export const VERSION = '6.0.0';
export const TOPICS: Record<string, string> = {
  'javascript-packages': 'JavaScript packages', 'python-packages': 'Python packages',
  'software-releases': 'Software releases', 'runtimes': 'Language runtimes',
  'ai-model-pricing': 'AI model pricing', 'api-pricing': 'API pricing', 'service-status': 'Service status',
};
