export type FieldKind =
  | 'text' | 'longText' | 'richText' | 'slug' | 'email' | 'url' | 'number' | 'boolean'
  | 'date' | 'datetime' | 'json' | 'money' | 'asset' | 'reference' | 'taxonomy';

export interface FieldDefinition {
  id: string;
  name: string;
  kind: FieldKind;
  required: boolean;
  localizable: boolean;
  indexed: boolean;
  unique: boolean;
  label?: string;
  description?: string;
  options: Record<string, any>;
}

export interface ContentTypeDefinition {
  id: string;
  apiId: string;
  displayName: string;
  description?: string;
  fields: FieldDefinition[];
}

export interface Meta {
  schemaEditable: boolean;
  defaultLocale: string;
  locales: string[];
  fieldKinds: FieldKind[];
}

export interface PlanResponse {
  changed: boolean;
  summary: string[];
  warnings: string[];
  sql: string[];
}

export interface ApplyResponse extends PlanResponse {
  status: 'created' | 'metadata-only' | 'up-to-date';
  schemaFile: string | null;
  migrationFile: string | null;
  generated: string[];
  applied: string[];
}

export class ApiError extends Error {
  constructor(message: string, public issues: unknown[] = []) {
    super(message);
  }
}

const BASE = process.env.NEXT_PUBLIC_OPENCMS_API_URL ?? 'http://localhost:4000';
const TOKEN = process.env.NEXT_PUBLIC_OPENCMS_ADMIN_TOKEN;

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = Array.isArray(body.message) ? body.message.join(', ') : body.message ?? res.statusText;
    throw new ApiError(msg, body.issues ?? []);
  }
  return body as T;
}

export const newId = (prefix: 'ct' | 'fld') =>
  `${prefix}_${Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => (b % 36).toString(36)).join('')}`;

export function formatIssue(issue: unknown): string {
  if (typeof issue === 'string') return issue;
  const i = issue as { path?: string; message?: string; locale?: string | null };
  return `${i.locale ? `[${i.locale}] ` : ''}${i.path ? `${i.path}: ` : ''}${i.message ?? JSON.stringify(issue)}`;
}
