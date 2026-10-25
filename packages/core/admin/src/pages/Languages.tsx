import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { SUPPORTED_LOCALES, type Locale } from '@opencloudcms/schema';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorAlert } from '../components/ErrorAlert';
import { PageHeader } from '../components/PageHeader';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import { Switch } from '../components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { t } from '../i18n';
import { ApiError } from '../lib/api-error';
import { fetchLocales, planLocaleChange, saveLocales, type LocalesResponse } from '../lib/locales';

export function Languages() {
  const [data, setData] = useState<LocalesResponse | null>(null);
  const [enabled, setEnabled] = useState<Locale[]>([]);
  const [def, setDef] = useState<Locale>('en-US');
  const [error, setError] = useState<Error | null>(null);
  const [confirm, setConfirm] = useState<Locale[] | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = useCallback((r: LocalesResponse) => {
    setData(r);
    setEnabled(r.locales);
    setDef(r.defaultLocale);
  }, []);

  useEffect(() => {
    fetchLocales().then(apply).catch(setError);
  }, [apply]);

  if (!data) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('languages.title')} description={t('languages.description')} />
        <ErrorAlert error={error} />
        {!error && <Skeleton className="h-40 w-full" aria-hidden="true" />}
      </div>
    );
  }

  const editable = data.editable;
  const dirty =
    def !== data.defaultLocale ||
    enabled.length !== data.locales.length ||
    enabled.some((l) => !data.locales.includes(l));

  const toggle = (code: Locale, on: boolean) => {
    setEnabled((cur) => (on ? SUPPORTED_LOCALES.map((l) => l.code).filter((c) => c === code || cur.includes(c)) : cur.filter((c) => c !== code)));
  };

  const save = async (confirmDisable?: Locale[]) => {
    setBusy(true);
    setError(null);
    try {
      const r = await saveLocales({ locales: enabled, defaultLocale: def, ...(confirmDisable?.length ? { confirmDisable } : {}) });
      apply(r);
      window.dispatchEvent(new Event('opencloudcms:schema-changed'));
      toast.success(t('languages.savedToast'));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'locale_has_entries') {
        // Server saw entries the page did not know about (stale counts): refresh and ask again.
        const stale = e.issues.map((i) => (i as { path?: string[] }).path?.[0]).filter(Boolean) as Locale[];
        const fresh = await fetchLocales().catch(() => null);
        if (fresh) setData((d) => (d ? { ...d, entryCounts: fresh.entryCounts } : d));
        setConfirm(stale);
      } else {
        setError(e instanceof Error ? e : new Error(String(e)));
      }
    } finally {
      setBusy(false);
    }
  };

  const onSave = () => {
    const { needsConfirm } = planLocaleChange(data, { locales: enabled, defaultLocale: def }, data.entryCounts);
    if (needsConfirm.length > 0) setConfirm(needsConfirm);
    else void save();
  };

  const name = (code: Locale) => SUPPORTED_LOCALES.find((l) => l.code === code)?.name ?? code;
  const confirmList = (confirm ?? []).map((l) => t('languages.confirmItem', { name: name(l), code: l, count: data.entryCounts[l] ?? 0 })).join('; ');

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('languages.title')}
        description={t('languages.description')}
        actions={
          editable && (
            <Button size="sm" onClick={onSave} disabled={!dirty || busy}>
              {t('languages.save')}
            </Button>
          )
        }
      />
      {!editable && (
        <Alert variant="warning">
          <AlertDescription>{t('languages.readOnly')}</AlertDescription>
        </Alert>
      )}
      <ErrorAlert error={error} />
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('languages.colLanguage')}</TableHead>
              <TableHead>{t('languages.colEnabled')}</TableHead>
              <TableHead>{t('languages.colDefault')}</TableHead>
              <TableHead className="text-right">{t('languages.colEntries')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {SUPPORTED_LOCALES.map((l) => {
              const isOn = enabled.includes(l.code);
              const isDefault = def === l.code;
              return (
                <TableRow key={l.code}>
                  <TableCell>
                    {l.name} <span className="font-mono text-muted-foreground">{l.code}</span>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={isOn}
                      disabled={!editable || isDefault}
                      onCheckedChange={(v) => toggle(l.code, v)}
                      aria-label={t('languages.enable', { name: l.name })}
                    />
                  </TableCell>
                  <TableCell>
                    <input
                      type="radio"
                      name="default-locale"
                      className="size-4 accent-primary"
                      checked={isDefault}
                      disabled={!editable || !isOn}
                      onChange={() => setDef(l.code)}
                      aria-label={t('languages.makeDefault', { name: l.name })}
                    />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{data.entryCounts[l.code] ?? 0}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t('languages.confirmTitle')}
        description={t('languages.confirmDescription', { list: confirmList })}
        confirmLabel={t('languages.confirmAction')}
        destructive
        onConfirm={() => confirm && save(confirm)}
      />
    </div>
  );
}
