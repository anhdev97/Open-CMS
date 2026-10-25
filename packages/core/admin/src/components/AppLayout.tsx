import { BoxesIcon, ChevronRightIcon, ChevronsUpDownIcon, HomeIcon, ImageIcon, LogOutIcon, PaletteIcon, UserIcon } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ContentGroupDefinition, LocalizedText } from '@opencloudcms/schema';
import { ThemeToggle } from './ThemeToggle';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from './ui/sidebar';
import { t } from '../i18n';
import { Link, useAdminPathname } from '../lib/nav';
import { api } from '../lib/api';
import { useLocale } from '../i18n/hooks';
import { buildSidebarTree, UNGROUPED_KEY, type SidebarTypeInput } from '../lib/sidebar-tree';
import { settingsItems } from '../navigation';
import { useAuth } from '../auth/AuthContext';
import { can, visibleSettingsItems } from '../lib/can';
import { cn } from '../lib/utils';

const NAV_STORAGE_KEY = 'opencms-nav';
const SETTINGS_KEY = '__settings';

function readOpen(): Record<string, boolean> {
  try {
    const v = JSON.parse(localStorage.getItem(NAV_STORAGE_KEY) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function writeOpen(v: Record<string, boolean>) {
  try {
    localStorage.setItem(NAV_STORAGE_KEY, JSON.stringify(v));
  } catch {
    // storage unavailable: state stays in memory
  }
}

export interface LayoutUser {
  name?: string | null;
  email: string;
}

interface ContentTypeLink {
  id: string;
  apiId: string;
  displayName: string | LocalizedText;
  group?: string;
}

async function loadContentTypes(): Promise<ContentTypeLink[]> {
  return (await api<{ data: ContentTypeLink[] }>('/api/admin/content-types')).data;
}

async function loadGroups(): Promise<ContentGroupDefinition[]> {
  return (await api<{ groups?: ContentGroupDefinition[] }>('/api/admin/meta')).groups ?? [];
}

function useContentTypes(enabled: boolean) {
  const [types, setTypes] = useState<ContentTypeLink[] | null>(null);
  const [groups, setGroups] = useState<ContentGroupDefinition[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const load = () => {
      loadGroups().then(
        (list) => live && setGroups(list),
        () => undefined, // groups are cosmetic: types still show ungrouped
      );
      return loadContentTypes().then(
        (list) => live && (setTypes(list), setFailed(false)),
        () => live && setFailed(true),
      );
    };
    void load();
    window.addEventListener('opencms:schema-changed', load);
    return () => {
      live = false;
      window.removeEventListener('opencms:schema-changed', load);
    };
  }, [enabled]);
  return { types, groups, failed };
}

function NavGroup({
  id,
  title,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const panel = `nav-group-${id}`;
  return (
    <SidebarGroup>
      <SidebarGroupLabel asChild>
        <button type="button" aria-expanded={open} aria-controls={panel} onClick={onToggle} className="w-full cursor-pointer">
          <ChevronRightIcon className={cn('mr-1 size-3.5 transition-transform', open && 'rotate-90')} aria-hidden="true" />
          <span className="truncate">{title}</span>
        </button>
      </SidebarGroupLabel>
      <SidebarGroupContent id={panel} hidden={!open}>
        {open && <SidebarMenu>{children}</SidebarMenu>}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function AppSidebar() {
  const pathname = useAdminPathname();
  const locale = useLocale();
  const { user } = useAuth();
  const canRead = can(user.permissions, 'content.read');
  const visibleSettings = useMemo(() => visibleSettingsItems(settingsItems, user.permissions), [user.permissions]);
  const { types, groups, failed } = useContentTypes(canRead);
  const { isMobile, setOpenMobile } = useSidebar();
  const [stored, setStored] = useState<Record<string, boolean>>({});
  useEffect(() => setStored(readOpen()), []);
  // On mobile the sidebar is a sheet: close it once a link is followed.
  const closeOnNavigate = () => {
    if (isMobile) setOpenMobile(false);
  };
  const isActive = (to: string) => (to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`));

  const tree = useMemo(
    () => buildSidebarTree((types ?? []) as SidebarTypeInput[], groups, locale),
    [types, groups, locale],
  );
  const settingsActive = visibleSettings.some((i) => isActive(i.to));
  // A group is open when stored open (default open) or when it holds the current page.
  const isOpen = (key: string, holdsCurrent: boolean) => holdsCurrent || (stored[key] ?? true);
  const toggle = (key: string, holdsCurrent: boolean) => {
    const next = { ...stored, [key]: !isOpen(key, holdsCurrent) };
    setStored(next);
    writeOpen(next);
  };

  const link = (to: string, label: string, icon?: ReactNode) => (
    <SidebarMenuItem key={to}>
      <SidebarMenuButton asChild isActive={isActive(to)}>
        <Link to={to} aria-current={isActive(to) ? 'page' : undefined} onClick={closeOnNavigate}>
          {icon}
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );

  return (
    <Sidebar aria-label={t('nav.main')}>
      <SidebarHeader>
        <Link
          to="/"
          onClick={closeOnNavigate}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-base font-semibold tracking-tight"
        >
          <span className="flex size-7 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
            <BoxesIcon className="size-4" aria-hidden="true" />
          </span>
          {t('app.name')}
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {link('/', t('nav.home'), <HomeIcon aria-hidden="true" />)}
              {canRead && link('/assets', t('nav.assets'), <ImageIcon aria-hidden="true" />)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {canRead && types === null && !failed && (
          <SidebarGroup>
            <SidebarMenu>
              {[0, 1, 2].map((i) => (
                <li key={i}>
                  <SidebarMenuSkeleton />
                </li>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}
        {canRead && failed && (
          <p className="px-4 py-1.5 text-xs text-destructive" role="status">
            {t('nav.loadFailed')}
          </p>
        )}
        {canRead && types?.length === 0 && <p className="px-4 py-1.5 text-xs text-muted-foreground">{t('nav.noContentTypes')}</p>}
        {canRead && tree.map((g) => {
          const holds = g.items.some((i) => isActive(`/content/${i.apiId}`));
          return (
            <NavGroup
              key={g.key}
              id={g.key}
              title={g.key === UNGROUPED_KEY ? t('nav.content') : g.title}
              open={isOpen(g.key, holds)}
              onToggle={() => toggle(g.key, holds)}
            >
              {g.items.map((i) => link(`/content/${i.apiId}`, i.title))}
            </NavGroup>
          );
        })}
        {visibleSettings.length > 0 && (
        <NavGroup
          id="settings"
          title={t('nav.settings')}
          open={isOpen(SETTINGS_KEY, settingsActive)}
          onToggle={() => toggle(SETTINGS_KEY, settingsActive)}
        >
          {visibleSettings.map(({ to, label, icon: Icon }) => link(to, t(label), <Icon aria-hidden="true" />))}
        </NavGroup>
        )}
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}

function AccountMenu({ user, onLogout }: { user: LayoutUser; onLogout?: () => void }) {
  const label = user.name || user.email;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="max-w-56" aria-label={t('account.menu')}>
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
            {label.charAt(0).toUpperCase()}
          </span>
          <span className="hidden truncate sm:inline">{label}</span>
          <ChevronsUpDownIcon className="text-muted-foreground" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          {user.name && <div className="truncate text-sm font-medium">{user.name}</div>}
          <div className="truncate text-xs text-muted-foreground">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/account">
            <UserIcon aria-hidden="true" />
            {t('account.account')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <PaletteIcon className="mr-2 size-4" aria-hidden="true" />
            {t('account.theme')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <ThemeToggle />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onLogout?.()}>
          <LogOutIcon aria-hidden="true" />
          {t('account.logOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface AppLayoutProps {
  user: LayoutUser;
  /** Called by "Log out"; AuthGate supplies it. */
  onLogout?: () => void;
  children: ReactNode;
}

/** Sidebar + top bar + content area. Below 768px the sidebar becomes a sheet (shadcn sidebar behaviour). */
export function AppLayout({ user, onLogout, children }: AppLayoutProps) {
  return (
    <SidebarProvider>
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2"
      >
        {t('nav.skipToContent')}
      </a>
      <AppSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur">
          <SidebarTrigger />
          <div className="ml-auto">
            <AccountMenu user={user} onLogout={onLogout} />
          </div>
        </header>
        <div id="main-content" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 space-y-6 p-4 outline-none md:p-8">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
