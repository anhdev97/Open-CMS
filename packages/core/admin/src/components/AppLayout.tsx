import {
  BoxesIcon,
  ChevronsUpDownIcon,
  DatabaseIcon,
  LogOutIcon,
  PaletteIcon,
  ShieldIcon,
  UserIcon,
  UsersIcon,
  WrenchIcon,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
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
} from '@/components/ui/dropdown-menu';
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
} from '@/components/ui/sidebar';
import { t } from '@/i18n/en';
import { api } from '../lib/api';

export interface LayoutUser {
  name?: string | null;
  email: string;
  roles: string[];
}

interface ContentTypeLink {
  id: string;
  apiId: string;
  displayName: string;
}

async function loadContentTypes(): Promise<ContentTypeLink[]> {
  return (await api<{ data: ContentTypeLink[] }>('/api/admin/content-types')).data;
}

const BASE_NAV = [
  { to: '/', label: 'nav.contentTypes', icon: DatabaseIcon },
  { to: '/builder', label: 'nav.builder', icon: WrenchIcon },
] as const;

const SUPER_ADMIN_NAV = [
  { to: '/users', label: 'nav.users', icon: UsersIcon },
  { to: '/roles', label: 'nav.roles', icon: ShieldIcon },
] as const;

function useContentTypes() {
  const [types, setTypes] = useState<ContentTypeLink[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    const load = () =>
      loadContentTypes().then(
        (list) => live && (setTypes(list), setFailed(false)),
        () => live && setFailed(true),
      );
    void load();
    window.addEventListener('opencms:schema-changed', load);
    return () => {
      live = false;
      window.removeEventListener('opencms:schema-changed', load);
    };
  }, []);
  return { types, failed };
}

function AppSidebar({ user }: { user: LayoutUser }) {
  const { pathname } = useLocation();
  const { types, failed } = useContentTypes();
  const isSuperAdmin = user.roles.includes('super_admin');
  const nav = [...BASE_NAV, ...(isSuperAdmin ? SUPER_ADMIN_NAV : [])];
  const { isMobile, setOpenMobile } = useSidebar();
  // On mobile the sidebar is a sheet: close it once a link is followed.
  const closeOnNavigate = () => {
    if (isMobile) setOpenMobile(false);
  };
  const isActive = (to: string) => (to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`));

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
              {nav.map(({ to, label, icon: Icon }) => (
                <SidebarMenuItem key={to}>
                  <SidebarMenuButton asChild isActive={isActive(to)}>
                    <Link to={to} aria-current={isActive(to) ? 'page' : undefined} onClick={closeOnNavigate}>
                      <Icon aria-hidden="true" />
                      <span>{t(label)}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>{t('nav.content')}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {types === null && !failed && [0, 1, 2].map((i) => (
                  <li key={i}>
                    <SidebarMenuSkeleton />
                  </li>
                ))}
              {failed && (
                <li className="px-2 py-1.5 text-xs text-destructive" role="status">
                  {t('nav.loadFailed')}
                </li>
              )}
              {types?.length === 0 && (
                <li className="px-2 py-1.5 text-xs text-muted-foreground">{t('nav.noContentTypes')}</li>
              )}
              {types?.map((ct) => {
                const to = `/content/${ct.apiId}`;
                return (
                  <SidebarMenuItem key={ct.id}>
                    <SidebarMenuButton asChild isActive={isActive(to)}>
                      <Link to={to} aria-current={isActive(to) ? 'page' : undefined} onClick={closeOnNavigate}>
                        <span>{ct.displayName}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
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
      <AppSidebar user={user} />
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
