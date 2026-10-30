import { api } from './api';

const base = '/api/admin/sso';

export interface SsoProvider {
  id: string;
  code: string;
  displayName: string;
  lifecycle: 'DRAFT' | 'ACTIVE' | 'DISABLED' | 'ARCHIVED';
  activeVersionId: string | null;
  draftVersionId: string | null;
  hasDraftSecret: boolean;
  draftState: 'DRAFT' | 'TESTED' | null;
  draftUpdatedAt: string | null;
}
export interface SsoVersion {
  id: string;
  versionNo: number;
  state: string;
  configPublic: { issuer?: string; clientId?: string; scopes?: string[] };
  testedAt: string | null;
  publishedAt: string | null;
}
export interface SsoPolicy { enabled: boolean; revision: number }
export interface SsoHealth {
  health: { health_status: string; checked_at: string | null; failure_code: string | null } | null;
  events: { id: string; category: string; failure_code: string | null; at: string }[];
}
export interface DraftInput {
  code: string;
  displayName: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes?: string[];
}

export const listSsoProviders = () =>
  api<{ data: SsoProvider[] }>(`${base}/providers`).then((r) => r.data);
export const listSsoVersions = (id: string) =>
  api<{ data: SsoVersion[] }>(`${base}/providers/${encodeURIComponent(id)}/versions`).then((r) => r.data);
export const getSsoHealth = (id: string) =>
  api<{ data: SsoHealth }>(`${base}/providers/${encodeURIComponent(id)}/health`).then((r) => r.data);
export const getSsoPolicy = () =>
  api<{ data: SsoPolicy }>(`${base}/policy`).then((r) => r.data);
export const setSsoPolicy = (enabled: boolean, expectedRevision: number) =>
  api<{ data: SsoPolicy }>(`${base}/policy`, { method: 'PATCH', json: { enabled, expectedRevision } }).then((r) => r.data);
export const createSsoProvider = (input: DraftInput) =>
  api<{ data: { providerId: string; draftId: string } }>(`${base}/providers`, { method: 'POST', json: input }).then((r) => r.data);
export const editSsoDraft = (id: string, input: Partial<Omit<DraftInput, 'code'>>, expectedUpdatedAt: string) =>
  api(`${base}/providers/${encodeURIComponent(id)}/draft`, { method: 'PATCH', json: { ...input, expectedUpdatedAt } });
export const testSsoDraft = (id: string) =>
  api<{ data: { testedFingerprint: string; warning: string } }>(
    `${base}/providers/${encodeURIComponent(id)}/test`, { method: 'POST' }).then((r) => r.data);
export const publishSsoDraft = (id: string, expectedFingerprint: string) =>
  api(`${base}/providers/${encodeURIComponent(id)}/publish`, { method: 'POST', json: { expectedFingerprint } });
export const ssoProviderAction = (id: string, action: 'disable' | 'restore' | 'archive' | 'probe') =>
  api(`${base}/providers/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
export const createSsoRecoveryDraft = (id: string, sourceVersionId: string) =>
  api(`${base}/providers/${encodeURIComponent(id)}/recovery-draft`, { method: 'POST', json: { sourceVersionId } });
export const verifySsoStepUp = (password: string) =>
  api(`${base}/step-up`, { method: 'POST', json: { password } });
export const blockSsoIdentity = (providerCode: string, subject: string, reason: string) =>
  api(`${base}/identities/block`, { method: 'POST', json: { providerCode, subject, reason } });
export const unblockSsoIdentity = (providerCode: string, subject: string) =>
  api(`${base}/identities/unblock`, { method: 'POST', json: { providerCode, subject } });
