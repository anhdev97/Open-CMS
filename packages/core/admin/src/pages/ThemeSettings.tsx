import { useEffect, useState } from 'react';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { validateTheme, type ThemeDefinition } from '@opencloudcms/schema';
import { ErrorAlert } from '../components/ErrorAlert';
import { PageHeader } from '../components/PageHeader';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Skeleton } from '../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { t } from '../i18n';
import { ApiError } from '../lib/api-error';
import { formatIssue } from '../lib/format-issue';
import {
  SEED_THEME,
  addColor,
  addPalette,
  fetchTheme,
  isHex,
  isThemeName,
  removeColor,
  removePalette,
  renameColor,
  renamePalette,
  saveTheme,
  setColorLabel,
  setPaletteLabel,
  setValue,
  uniqueName,
  type ThemeResponse,
} from '../lib/theme-settings';

interface Issue {
  path: (string | number)[];
  message: string;
}

const title = (id: string, label?: string) => label || id.charAt(0).toUpperCase() + id.slice(1);
const pathKey = (p: readonly (string | number)[]) => p.join('.');

function nameProblem(text: string, value: string, taken: readonly string[]): 'invalid' | 'taken' | null {
  if (text === value) return null;
  if (!isThemeName(text)) return 'invalid';
  return taken.includes(text) ? 'taken' : null;
}

const hintText = (p: 'invalid' | 'taken') => t(p === 'invalid' ? 'themeSettings.hintInvalid' : 'themeSettings.hintTaken');

/** Name input that commits (rename) on blur / Enter; an invalid or taken name stays in the box with a hint and is not applied. */
function NameInput({ value, taken, disabled, label, onCommit }: { value: string; taken: readonly string[]; disabled: boolean; label: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const problem = nameProblem(text, value, taken);
  const commit = () => {
    if (text !== value && !problem) onCommit(text);
  };
  return (
    <div className="space-y-1">
      <Input
        className="h-8 font-mono"
        value={text}
        disabled={disabled}
        aria-label={label}
        aria-invalid={problem ? true : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setText(value);
        }}
      />
      {problem && <p className="text-xs text-destructive">{hintText(problem)}</p>}
    </div>
  );
}

function LabelInput({ value, disabled, label, onChange }: { value: string; disabled: boolean; label: string; onChange: (v: string) => void }) {
  return (
    <Input
      className="h-7 text-xs"
      value={value}
      disabled={disabled}
      placeholder={t('themeSettings.labelPlaceholder')}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function ThemeSettings() {
  const [data, setData] = useState<ThemeResponse | null>(null);
  const [draft, setDraft] = useState<ThemeDefinition | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [busy, setBusy] = useState(false);
  const [newColor, setNewColor] = useState('');

  useEffect(() => {
    fetchTheme()
      .then((r) => {
        setData(r);
        setDraft(r.theme);
      })
      .catch(setError);
  }, []);

  if (!data) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('themeSettings.title')} description={t('themeSettings.description')} />
        <ErrorAlert error={error} />
        {!error && <Skeleton className="h-40 w-full" aria-hidden="true" />}
      </div>
    );
  }

  const editable = data.editable;
  const dirty = JSON.stringify(draft) !== JSON.stringify(data.theme);
  const update = (fn: (t: ThemeDefinition) => ThemeDefinition) => {
    setDraft((d) => (d ? fn(d) : d));
    setIssues([]);
  };
  const invalid = new Set(issues.map((i) => pathKey(i.path)));

  const save = async () => {
    if (!draft) return;
    const local = validateTheme(draft) as Issue[];
    if (local.length > 0) {
      setError(null);
      setIssues(local);
      return;
    }
    setBusy(true);
    setError(null);
    setIssues([]);
    try {
      const r = await saveTheme(draft);
      setData(r);
      setDraft(r.theme);
      toast.success(t('themeSettings.savedToast'));
    } catch (e) {
      if (e instanceof ApiError) setIssues(e.issues.filter((i): i is Issue => !!i && typeof i === 'object' && Array.isArray((i as Issue).path)));
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <PageHeader
      title={t('themeSettings.title')}
      description={t('themeSettings.description')}
      actions={
        editable &&
        draft && (
          <Button size="sm" onClick={save} disabled={!dirty || busy}>
            {t('themeSettings.save')}
          </Button>
        )
      }
    />
  );
  const notice = !editable && (
    <Alert variant="warning">
      <AlertDescription>{t('themeSettings.readOnly')}</AlertDescription>
    </Alert>
  );

  if (!draft) {
    return (
      <div className="space-y-6">
        {header}
        {notice}
        <ErrorAlert error={error} />
        <Card className="items-start gap-3 p-6">
          <p className="font-medium">{t('themeSettings.emptyTitle')}</p>
          <p className="text-sm text-muted-foreground">{t('themeSettings.emptyDescription')}</p>
          {editable && (
            <Button size="sm" onClick={() => setDraft(SEED_THEME)}>
              {t('themeSettings.create')}
            </Button>
          )}
        </Card>
      </div>
    );
  }

  const colorNames = Object.keys(draft.colors);
  const paletteIds = Object.keys(draft.palettes);
  const newColorProblem = nameProblem(newColor, '', colorNames);

  return (
    <div className="space-y-6">
      {header}
      {notice}
      <ErrorAlert error={error && issues.length === 0 ? error : null} />
      {issues.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            <ul className="list-disc space-y-0.5 pl-4">
              {issues.map((i, k) => (
                <li key={k}>{formatIssue({ path: pathKey(i.path), message: i.message })}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('themeSettings.colColor')}</TableHead>
              {paletteIds.map((id) => (
                <TableHead key={id} className="min-w-44">
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="active-palette"
                      className="size-4 accent-primary"
                      checked={draft.activePalette === id}
                      disabled={!editable}
                      onChange={() => update((d) => ({ ...d, activePalette: id }))}
                      aria-label={t('themeSettings.makeActive', { name: title(id, draft.palettes[id]?.label) })}
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <LabelInput
                        value={draft.palettes[id]?.label ?? ''}
                        disabled={!editable}
                        label={t('themeSettings.paletteLabel', { name: id })}
                        onChange={(v) => update((d) => setPaletteLabel(d, id, v))}
                      />
                      <NameInput
                        value={id}
                        taken={paletteIds}
                        disabled={!editable}
                        label={t('themeSettings.paletteName', { name: title(id, draft.palettes[id]?.label) })}
                        onCommit={(to) => update((d) => renamePalette(d, id, to))}
                      />
                    </div>
                    {editable && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0"
                        disabled={paletteIds.length <= 1}
                        onClick={() => update((d) => removePalette(d, id))}
                        aria-label={t('themeSettings.removePalette', { name: title(id, draft.palettes[id]?.label) })}
                      >
                        <Trash2Icon aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                </TableHead>
              ))}
              <TableHead className="w-12">
                {editable && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => update((d) => addPalette(d, uniqueName('palette', Object.keys(d.palettes))))}
                  >
                    <PlusIcon aria-hidden="true" />
                    {t('themeSettings.addPalette')}
                  </Button>
                )}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {colorNames.map((c) => (
              <TableRow key={c}>
                <TableCell>
                  <div className="space-y-1">
                    <LabelInput
                      value={draft.colors[c]?.label ?? ''}
                      disabled={!editable}
                      label={t('themeSettings.colorLabel', { name: c })}
                      onChange={(v) => update((d) => setColorLabel(d, c, v))}
                    />
                    <NameInput
                      value={c}
                      taken={colorNames}
                      disabled={!editable}
                      label={t('themeSettings.colorName', { name: title(c, draft.colors[c]?.label) })}
                      onCommit={(to) => update((d) => renameColor(d, c, to))}
                    />
                  </div>
                </TableCell>
                {paletteIds.map((id) => {
                  const v = draft.palettes[id]?.values[c] ?? '';
                  const bad = invalid.has(pathKey(['palettes', id, 'values', c])) || (v !== '' && !isHex(v) && issues.length > 0);
                  return (
                    <TableCell key={id}>
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="size-6 shrink-0 rounded border border-input"
                          style={{ backgroundColor: isHex(v) ? v : 'transparent' }}
                        />
                        <Input
                          className="h-8 font-mono"
                          value={v}
                          disabled={!editable}
                          aria-label={`${title(id, draft.palettes[id]?.label)}: ${title(c, draft.colors[c]?.label)}`}
                          aria-invalid={bad || undefined}
                          onChange={(e) => update((d) => setValue(d, id, c, e.target.value))}
                        />
                      </div>
                    </TableCell>
                  );
                })}
                <TableCell>
                  {editable && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => update((d) => removeColor(d, c))}
                      aria-label={t('themeSettings.removeColor', { name: title(c, draft.colors[c]?.label) })}
                    >
                      <Trash2Icon aria-hidden="true" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      {editable && (
        <form
          className="flex max-w-sm flex-wrap items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (isThemeName(newColor) && !colorNames.includes(newColor)) {
              update((d) => addColor(d, newColor));
              setNewColor('');
            }
          }}
        >
          <Input
            className="h-8 font-mono"
            value={newColor}
            placeholder={t('themeSettings.newColorPlaceholder')}
            aria-label={t('themeSettings.newColor')}
            aria-invalid={newColor && newColorProblem ? true : undefined}
            onChange={(e) => setNewColor(e.target.value)}
          />
          <Button type="submit" size="sm" variant="outline" disabled={!isThemeName(newColor) || colorNames.includes(newColor)}>
            <PlusIcon aria-hidden="true" />
            {t('themeSettings.addColor')}
          </Button>
          {newColor && newColorProblem && <p className="basis-full text-xs text-destructive">{hintText(newColorProblem)}</p>}
        </form>
      )}
    </div>
  );
}
