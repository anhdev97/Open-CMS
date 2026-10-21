import { zodResolver } from '@hookform/resolvers/zod';
import { InboxIcon, MoonIcon, PlusIcon, SunIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { AppLayout } from '../components/AppLayout';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { ErrorAlert } from '../components/ErrorAlert';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge, type Status } from '../components/StatusBadge';
import { ThemeToggle } from '../components/ThemeToggle';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Checkbox } from '../components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '../components/ui/form';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '../components/ui/sheet';
import { Separator } from '../components/ui/separator';
import { Skeleton } from '../components/ui/skeleton';
import { Switch } from '../components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Textarea } from '../components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { t } from '../i18n/en';
import { ApiError } from '../lib/api-error';
import { setTheme } from '../lib/theme';

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

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

const demoSchema = z.object({
  name: z.string().min(3, t('uiKit.form.nameTooShort')),
  email: z.string().email(t('uiKit.form.emailInvalid')),
});
type DemoValues = z.infer<typeof demoSchema>;

function FormDemo() {
  const form = useForm<DemoValues>({
    resolver: zodResolver(demoSchema),
    defaultValues: { name: 'ab', email: 'ok@example.com' },
    mode: 'onChange',
  });
  // Validate once on mount so the invalid default shows its message without any interaction.
  useEffect(() => {
    void form.trigger();
  }, [form]);

  return (
    <Form {...form}>
      <form
        className="grid w-full max-w-sm gap-4"
        onSubmit={form.handleSubmit(() => toast.success(t('uiKit.form.submitted')))}
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('uiKit.form.name')}</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormDescription>{t('uiKit.form.nameHint')}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('uiKit.form.email')}</FormLabel>
              <FormControl>
                <Input type="email" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-fit">
          {t('uiKit.form.submit')}
        </Button>
      </form>
    </Form>
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
            {t(`uiKit.variants.${v}`)}
          </Button>
        ))}
        <Button size="sm">{t('uiKit.sizeSm')}</Button>
        <Button size="lg">{t('uiKit.sizeLg')}</Button>
        <Button size="icon" aria-label={t('uiKit.addLabel')}>
          <PlusIcon />
        </Button>
        <Button disabled>{t('uiKit.disabled')}</Button>
      </Section>

      <Section title={t('ui.sections.form')}>
        <Field id="kit-input" label={t('uiKit.input')}>
          <Input id="kit-input" placeholder={t('uiKit.inputPlaceholder')} />
        </Field>
        <Field id="kit-invalid" label={t('uiKit.invalidInput')}>
          <Input id="kit-invalid" aria-invalid defaultValue={t('uiKit.invalidInput')} />
        </Field>
        <Field id="kit-disabled" label={t('uiKit.disabledInput')}>
          <Input id="kit-disabled" disabled defaultValue={t('uiKit.readOnlyValue')} />
        </Field>
        <Field id="kit-textarea" label={t('uiKit.textarea')}>
          <Textarea id="kit-textarea" placeholder={t('uiKit.textareaPlaceholder')} />
        </Field>
        <Field id="kit-select" label={t('uiKit.select')}>
          <Select defaultValue="b">
            <SelectTrigger id="kit-select" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="a">{t('uiKit.optionA')}</SelectItem>
              <SelectItem value="b">{t('uiKit.optionB')}</SelectItem>
              <SelectItem value="c">{t('uiKit.optionC')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <div className="flex items-center gap-2">
          <Checkbox id="kit-check" defaultChecked />
          <Label htmlFor="kit-check">{t('uiKit.checkbox')}</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="kit-switch" defaultChecked />
          <Label htmlFor="kit-switch">{t('uiKit.switch')}</Label>
        </div>
      </Section>

      <Section title={t('ui.sections.badges')}>
        {(['default', 'secondary', 'outline', 'success', 'warning', 'destructive'] as const).map((v) => (
          <Badge key={v} variant={v}>
            {t(`uiKit.variants.${v}`)}
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
              <AlertTitle>{t(`uiKit.variants.${v}`)}</AlertTitle>
              <AlertDescription>{t('ui.sampleDescription')}</AlertDescription>
            </Alert>
          ))}
          <ErrorAlert
            error={
              new ApiError(422, 'validation_failed', t('ui.sampleError'), [
                { path: 'title', message: t('uiKit.issueRequired') },
                { locale: 'vi', path: 'slug', message: t('uiKit.issueTaken') },
                t('uiKit.issuePlain'),
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
                <TableHead>{t('uiKit.tableName')}</TableHead>
                <TableHead>{t('uiKit.tableStatus')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {STATUSES.map((s) => (
                <TableRow key={s}>
                  <TableCell>{t('uiKit.tableRow', { status: t(`status.${s}`) })}</TableCell>
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

      <Section title={t('uiKit.sections.sheet')}>
        {SIDES.map((side) => (
          <Sheet key={side}>
            <SheetTrigger asChild>
              <Button variant="outline">{t('uiKit.sheetOpen', { side: t(`uiKit.sheetSides.${side}`) })}</Button>
            </SheetTrigger>
            <SheetContent side={side}>
              <SheetHeader>
                <SheetTitle>{t('uiKit.sheetTitle')}</SheetTitle>
                <SheetDescription>{t('ui.sampleDescription')}</SheetDescription>
              </SheetHeader>
            </SheetContent>
          </Sheet>
        ))}
      </Section>

      <Section title={t('uiKit.sections.formDemo')}>
        <FormDemo />
      </Section>

      <Section title={t('ui.sections.navigation')}>
        <Tabs defaultValue="one" className="w-full max-w-md">
          <TabsList>
            <TabsTrigger value="one">{t('uiKit.tabOne')}</TabsTrigger>
            <TabsTrigger value="two">{t('uiKit.tabTwo')}</TabsTrigger>
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

      <section className="space-y-4" aria-label={t('uiKit.sections.appLayout')}>
        <h2 className="text-lg font-semibold tracking-tight">{t('uiKit.sections.appLayout')}</h2>
        <p className="text-sm text-muted-foreground">{t('uiKit.layoutNote')}</p>
        {/* transform-gpu makes this box the containing block of the sidebar's fixed positioning */}
        <div className="h-128 transform-gpu overflow-auto rounded-lg border">
          <AppLayout user={{ name: 'Ada Lovelace', email: 'ada@example.com' }}>
            <PageHeader title={t('ui.sampleTitle')} description={t('ui.sampleDescription')} />
          </AppLayout>
        </div>
      </section>
    </main>
  );
}
