import { InboxIcon, MoonIcon, PlusIcon, SunIcon, Trash2Icon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { ErrorAlert } from '@/components/ErrorAlert';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge, type Status } from '@/components/StatusBadge';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { t } from '@/i18n/en';
import { ApiError } from '@/lib/api-error';
import { setTheme } from '@/lib/theme';

const STATUSES: Status[] = ['draft', 'published', 'changed', 'active', 'disabled'];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4" aria-label={title}>
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="flex flex-wrap items-start gap-3">{children}</div>
      <Separator />
    </section>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="grid w-64 gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

/** Dev-only showcase (route `/_ui`): every ui component and variant plus the OpenCMS components. */
export function UiKit() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const [confirm, setConfirm] = useState<'normal' | 'destructive' | null>(null);

  function flipTheme() {
    const next = !dark;
    setTheme(next ? 'dark' : 'light');
    setDark(next);
  }

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-4 md:p-8">
      <PageHeader
        title={t('ui.title')}
        description={t('ui.description')}
        actions={
          <Button variant="outline" size="icon" onClick={flipTheme} aria-label={t('ui.toggleTheme')}>
            {dark ? <SunIcon /> : <MoonIcon />}
          </Button>
        }
      />

      <Section title={t('ui.sections.buttons')}>
        {(['default', 'secondary', 'outline', 'ghost', 'link', 'destructive'] as const).map((v) => (
          <Button key={v} variant={v}>
            {v}
          </Button>
        ))}
        <Button size="sm">sm</Button>
        <Button size="lg">lg</Button>
        <Button size="icon" aria-label="Add">
          <PlusIcon />
        </Button>
        <Button disabled>disabled</Button>
      </Section>

      <Section title={t('ui.sections.form')}>
        <Field id="kit-input" label="Input">
          <Input id="kit-input" placeholder="Type here" />
        </Field>
        <Field id="kit-invalid" label="Invalid input">
          <Input id="kit-invalid" aria-invalid defaultValue="nope" />
        </Field>
        <Field id="kit-disabled" label="Disabled input">
          <Input id="kit-disabled" disabled defaultValue="Read only" />
        </Field>
        <Field id="kit-textarea" label="Textarea">
          <Textarea id="kit-textarea" placeholder="Longer text" />
        </Field>
        <Field id="kit-select" label="Select">
          <Select defaultValue="b">
            <SelectTrigger id="kit-select" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="a">Option A</SelectItem>
              <SelectItem value="b">Option B</SelectItem>
              <SelectItem value="c">Option C</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <div className="flex items-center gap-2">
          <Checkbox id="kit-check" defaultChecked />
          <Label htmlFor="kit-check">Checkbox</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="kit-switch" defaultChecked />
          <Label htmlFor="kit-switch">Switch</Label>
        </div>
      </Section>

      <Section title={t('ui.sections.badges')}>
        {(['default', 'secondary', 'outline', 'success', 'warning', 'destructive'] as const).map((v) => (
          <Badge key={v} variant={v}>
            {v}
          </Badge>
        ))}
        <Separator orientation="vertical" className="h-6" />
        {STATUSES.map((s) => (
          <StatusBadge key={s} status={s} />
        ))}
      </Section>

      <Section title={t('ui.sections.alerts')}>
        <div className="grid w-full gap-3">
          {(['default', 'success', 'warning', 'destructive'] as const).map((v) => (
            <Alert key={v} variant={v}>
              <AlertTitle>{v}</AlertTitle>
              <AlertDescription>{t('ui.sampleDescription')}</AlertDescription>
            </Alert>
          ))}
          <ErrorAlert
            error={
              new ApiError(422, 'validation_failed', t('ui.sampleError'), [
                { path: 'title', message: 'Required' },
                { locale: 'vi', path: 'slug', message: 'Already taken' },
                'Plain string issue',
              ])
            }
          />
        </div>
      </Section>

      <Section title={t('ui.sections.data')}>
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>{t('ui.sampleTitle')}</CardTitle>
            <CardDescription>{t('ui.sampleDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </CardContent>
        </Card>
        <div className="min-w-0 flex-1 basis-80 rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {STATUSES.map((s) => (
                <TableRow key={s}>
                  <TableCell className="capitalize">{s} item</TableCell>
                  <TableCell>
                    <StatusBadge status={s} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="w-full">
          <EmptyState
            icon={InboxIcon}
            title={t('ui.emptyTitle')}
            description={t('ui.emptyDescription')}
            action={
              <Button>
                <PlusIcon />
                {t('ui.emptyAction')}
              </Button>
            }
          />
        </div>
      </Section>

      <Section title={t('ui.sections.overlays')}>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">{t('ui.openDialog')}</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('ui.sampleTitle')}</DialogTitle>
              <DialogDescription>{t('ui.sampleDescription')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button>{t('common.confirm')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Button variant="outline" onClick={() => setConfirm('normal')}>
          {t('ui.openConfirm')}
        </Button>
        <Button variant="destructive" onClick={() => setConfirm('destructive')}>
          <Trash2Icon />
          {t('ui.openDestructive')}
        </Button>
        <ConfirmDialog
          open={confirm !== null}
          onOpenChange={(open) => !open && setConfirm(null)}
          title={t('ui.confirmTitle')}
          description={t('ui.confirmDescription')}
          confirmLabel={t('common.delete')}
          destructive={confirm === 'destructive'}
          onConfirm={() => setConfirm(null)}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">{t('ui.openMenu')}</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>{t('account.theme')}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <ThemeToggle />
            <DropdownMenuSeparator />
            <DropdownMenuItem>{t('account.account')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline">{t('ui.hoverMe')}</Button>
          </TooltipTrigger>
          <TooltipContent>{t('ui.tooltipText')}</TooltipContent>
        </Tooltip>
        <Button variant="outline" onClick={() => toast.success(t('ui.toastText'))}>
          {t('ui.showToast')}
        </Button>
      </Section>

      <Section title={t('ui.sections.navigation')}>
        <Tabs defaultValue="one" className="w-full max-w-md">
          <TabsList>
            <TabsTrigger value="one">One</TabsTrigger>
            <TabsTrigger value="two">Two</TabsTrigger>
          </TabsList>
          <TabsContent value="one" className="text-sm text-muted-foreground">
            {t('ui.sampleDescription')}
          </TabsContent>
          <TabsContent value="two" className="text-sm text-muted-foreground">
            {t('ui.sampleDescription')}
          </TabsContent>
        </Tabs>
        <div className="w-full rounded-lg border p-4">
          <PageHeader
            title={t('ui.sampleTitle')}
            description={t('ui.sampleDescription')}
            actions={
              <>
                <Button variant="outline">{t('common.cancel')}</Button>
                <Button>{t('common.confirm')}</Button>
              </>
            }
          />
        </div>
      </Section>
    </main>
  );
}
