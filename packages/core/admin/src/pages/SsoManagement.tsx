'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/PageHeader';
import { ErrorAlert } from '../components/ErrorAlert';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { ApiError } from '../lib/api-error';
import {
  blockSsoIdentity, createSsoProvider, createSsoRecoveryDraft, editSsoDraft,
  getSsoHealth, getSsoPolicy, listSsoProviders, listSsoVersions,
  publishSsoDraft, setSsoPolicy, ssoProviderAction, testSsoDraft,
  unblockSsoIdentity, verifySsoStepUp,
  type DraftInput, type SsoHealth, type SsoPolicy, type SsoProvider, type SsoVersion,
} from '../lib/sso-api';

const emptyDraft: DraftInput = {
  code: '', displayName: '', issuer: '', clientId: '', clientSecret: '',
};

export function SsoManagement() {
  const { user } = useAuth();
  const canManage = user.permissions.includes('settings.sso.manage');
  const canIdentities = user.permissions.includes('settings.sso.identities');
  const [providers, setProviders] = useState<SsoProvider[]>([]);
  const [policy, setPolicy] = useState<SsoPolicy | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [versions, setVersions] = useState<SsoVersion[]>([]);
  const [health, setHealth] = useState<SsoHealth | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<DraftInput>(emptyDraft);
  const [editing, setEditing] = useState(false);
  const [showDraft, setShowDraft] = useState(false);
  const [fingerprints, setFingerprints] = useState<Record<string, string>>({});
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [stepUpPassword, setStepUpPassword] = useState('');
  const pendingAction = useRef<(() => Promise<void>) | null>(null);
  const [blockForm, setBlockForm] = useState({ providerCode: '', subject: '', reason: '' });

  const reload = useCallback(async () => {
    const [p, state] = await Promise.all([listSsoProviders(), getSsoPolicy()]);
    setProviders(p);
    setPolicy(state);
  }, []);
  useEffect(() => {
    void reload().catch((e: unknown) => setError(e instanceof Error ? e : new Error(String(e))));
  }, [reload]);
  useEffect(() => {
    if (!selected) return;
    let live = true;
    Promise.all([listSsoVersions(selected), getSsoHealth(selected)]).then(
      ([v, h]) => { if (live) { setVersions(v); setHealth(h); } },
      (e: unknown) => { if (live) setError(e instanceof Error ? e : new Error(String(e))); },
    );
    return () => { live = false; };
  }, [selected, providers]);

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
      toast.success('SSO configuration saved');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'step_up_required') {
        pendingAction.current = action;
        setStepUpOpen(true);
      } else {
        setError(e instanceof Error ? e : new Error(String(e)));
      }
    } finally { setBusy(false); }
  }

  async function submitStepUp(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      await verifySsoStepUp(stepUpPassword);
      setStepUpPassword('');
      setStepUpOpen(false);
      const next = pendingAction.current;
      pendingAction.current = null;
      if (next) await run(next);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally { setBusy(false); }
  }

  async function saveDraft(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (editing && selected) {
      const provider = providers.find((p) => p.id === selected);
      if (!provider?.draftUpdatedAt) return;
      const { code: _code, clientSecret, ...rest } = draft;
      await run(async () => {
        await editSsoDraft(selected, {
          ...rest,
          ...(clientSecret ? { clientSecret } : {}),
        }, provider.draftUpdatedAt!);
        setShowDraft(false);
        setFingerprints((prev) => { const next = { ...prev }; delete next[selected]; return next; });
      });
    } else {
      await run(async () => {
        const created = await createSsoProvider(draft);
        setSelected(created.providerId);
        setShowDraft(false);
      });
    }
    setDraft({ ...emptyDraft, clientSecret: '' });
  }

  function openEdit(provider: SsoProvider) {
    const v = versions.find((x) => x.id === provider.draftVersionId);
    setDraft({
      code: provider.code,
      displayName: provider.displayName,
      issuer: v?.configPublic.issuer ?? '',
      clientId: v?.configPublic.clientId ?? '',
      scopes: v?.configPublic.scopes ?? ['openid', 'email', 'profile'],
      clientSecret: '',
    });
    setEditing(true);
    setSelected(provider.id);
    setShowDraft(true);
  }

  const current = providers.find((p) => p.id === selected);

  return (
    <div className="space-y-6">
      <PageHeader title="Single Sign-On" description="Manage Admin Portal OIDC providers. CMS password login is always available."
        actions={canManage ? (
          <Button onClick={() => { setEditing(false); setDraft({ ...emptyDraft }); setShowDraft(true); }}>
            Add OIDC provider
          </Button>
        ) : undefined} />
      <ErrorAlert error={error} />

      <Card>
        <CardHeader><CardTitle>Global SSO login</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">Controls external login choices only. Local Login stays enabled.</p>
          <Switch aria-label="Enable SSO" checked={policy?.enabled ?? false} disabled={!policy || !canManage || busy}
            onCheckedChange={(enabled) => {
              if (policy) void run(async () => { setPolicy(await setSsoPolicy(enabled, policy.revision)); });
            }} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Identity providers</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {providers.length === 0 ? <p className="text-sm text-muted-foreground">No providers configured.</p> : null}
          {providers.map((provider) => (
            <div key={provider.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
              <div>
                <p className="font-medium">{provider.displayName} <span className="text-sm text-muted-foreground">({provider.code})</span></p>
                <p className="text-xs text-muted-foreground">{provider.lifecycle}
                  {provider.draftState ? ` · Draft ${provider.draftState}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setSelected(provider.id)}>Details</Button>
                {canManage && provider.draftVersionId && (
                  <Button variant="outline" size="sm" onClick={() => openEdit(provider)}>Edit draft</Button>
                )}
                {canManage && provider.draftVersionId && (
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(async () => {
                    const result = await testSsoDraft(provider.id);
                    setFingerprints((cur) => ({ ...cur, [provider.id]: result.testedFingerprint }));
                    toast.info(result.warning);
                  })}>Test</Button>
                )}
                {canManage && provider.draftVersionId && fingerprints[provider.id] && (
                  <Button size="sm" disabled={busy} onClick={() => void run(async () => {
                    await publishSsoDraft(provider.id, fingerprints[provider.id]);
                  })}>Publish</Button>
                )}
                {canManage && provider.lifecycle === 'ACTIVE' && (
                  <Button size="sm" variant="outline" disabled={busy}
                    onClick={() => void run(async () => { await ssoProviderAction(provider.id, 'disable'); })}>Disable</Button>
                )}
                {canManage && provider.lifecycle === 'DISABLED' && (
                  <Button size="sm" variant="outline" disabled={busy}
                    onClick={() => void run(async () => { await ssoProviderAction(provider.id, 'restore'); })}>Restore</Button>
                )}
                {canManage && (provider.lifecycle === 'DISABLED' || provider.lifecycle === 'DRAFT') && (
                  <Button size="sm" variant="outline" disabled={busy}
                    onClick={() => void run(async () => { await ssoProviderAction(provider.id, 'archive'); })}>Archive</Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {current && (
        <Card>
          <CardHeader><CardTitle>{current.displayName} · Versions &amp; health</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm">Health: <strong>{health?.health?.health_status ?? 'UNKNOWN'}</strong>
              {health?.health?.failure_code ? ` · ${health.health.failure_code}` : ''}
            </p>
            {canManage && <Button variant="outline" size="sm"
              onClick={() => void run(async () => { await ssoProviderAction(current.id, 'probe'); })}>Probe discovery</Button>}
            <div className="space-y-2">
              {versions.map((v) => (
                <div key={v.id} className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm">
                  <span>v{v.versionNo} · {v.state} · {v.configPublic.issuer ?? ''}</span>
                  {canManage && !current.draftVersionId && (v.state === 'PUBLISHED' || v.state === 'SUPERSEDED') &&
                    <Button variant="outline" size="sm" onClick={() => void run(async () => {
                      await createSsoRecoveryDraft(current.id, v.id);
                    })}>Recovery draft</Button>}
                </div>
              ))}
            </div>
            {health?.events?.length ? (
              <details className="text-sm">
                <summary className="cursor-pointer">Health history ({health.events.length})</summary>
                <ul className="mt-2 space-y-1">
                  {health.events.map((event) => <li key={event.id}>
                    {new Date(event.at).toLocaleString()} · {event.category}
                    {event.failure_code ? ` · ${event.failure_code}` : ''}
                  </li>)}
                </ul>
              </details>
            ) : null}
          </CardContent>
        </Card>
      )}

      {canIdentities && (
        <Card>
          <CardHeader><CardTitle>External identity block / unblock</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            <Input aria-label="Provider code" placeholder="Provider code" value={blockForm.providerCode}
              onChange={(e) => setBlockForm({ ...blockForm, providerCode: e.target.value })} />
            <Input aria-label="External subject" placeholder="External subject (sub)" value={blockForm.subject}
              onChange={(e) => setBlockForm({ ...blockForm, subject: e.target.value })} />
            <Input aria-label="Block reason" placeholder="Reason for block" value={blockForm.reason}
              onChange={(e) => setBlockForm({ ...blockForm, reason: e.target.value })} />
            <div className="flex gap-2">
              <Button disabled={busy} onClick={() => void run(async () => {
                await blockSsoIdentity(blockForm.providerCode, blockForm.subject, blockForm.reason);
                setBlockForm({ providerCode: '', subject: '', reason: '' });
              })}>Block identity</Button>
              <Button variant="outline" disabled={busy} onClick={() => void run(async () => {
                await unblockSsoIdentity(blockForm.providerCode, blockForm.subject);
                setBlockForm({ providerCode: '', subject: '', reason: '' });
              })}>Unblock identity</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={showDraft} onOpenChange={setShowDraft}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit draft' : 'Add OIDC provider'}</DialogTitle>
            <DialogDescription>Client Secret is write-only. Test discovery before publishing.</DialogDescription>
          </DialogHeader>
          <form className="grid gap-3" onSubmit={(e) => void saveDraft(e)}>
            <Label htmlFor="sso-code">Code</Label>
            <Input id="sso-code" required disabled={editing} value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })} />
            <Label htmlFor="sso-label">Display name</Label>
            <Input id="sso-label" required value={draft.displayName}
              onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} />
            <Label htmlFor="sso-issuer">Issuer (HTTPS)</Label>
            <Input id="sso-issuer" required type="url" value={draft.issuer}
              onChange={(e) => setDraft({ ...draft, issuer: e.target.value })} />
            <Label htmlFor="sso-client">Client ID</Label>
            <Input id="sso-client" required value={draft.clientId}
              onChange={(e) => setDraft({ ...draft, clientId: e.target.value })} />
            <Label htmlFor="sso-secret">Client Secret</Label>
            <Input id="sso-secret" type="password" autoComplete="off"
              required={!editing} value={draft.clientSecret}
              placeholder={editing ? 'Leave blank to retain secret' : ''}
              onChange={(e) => setDraft({ ...draft, clientSecret: e.target.value })} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowDraft(false)}>Cancel</Button>
              <Button type="submit" disabled={busy}>Save draft</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={stepUpOpen} onOpenChange={setStepUpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm with CMS password</DialogTitle>
            <DialogDescription>Required for sensitive SSO changes. Valid for ten minutes in this session.</DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={(e) => void submitStepUp(e)}>
            <Label htmlFor="sso-stepup">CMS password</Label>
            <Input id="sso-stepup" type="password" required autoComplete="current-password"
              value={stepUpPassword} onChange={(e) => setStepUpPassword(e.target.value)} />
            <DialogFooter><Button type="submit" disabled={busy}>Verify and continue</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
