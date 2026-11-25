'use client';

import NextLink from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, type ComponentProps } from 'react';
import { adminHref } from './admin-href';
import { confirmNavigation } from './nav-guard';

export { adminHref };

type LinkProps = Omit<ComponentProps<typeof NextLink>, 'href'> & { to: string };

/** `next/link` with an admin-relative `to`; asks the unsaved-changes guard (lib/nav-guard) first. */
export function Link({ to, onClick, ...rest }: LinkProps) {
  return (
    <NextLink
      {...rest}
      href={adminHref(to)}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented && !confirmNavigation()) e.preventDefault();
      }}
    />
  );
}

/** `skipGuard`: the caller already confirmed, or the move keeps the page (e.g. a `?locale=` replace). */
export function useAdminNavigate(): (to: string, opts?: { replace?: boolean; skipGuard?: boolean }) => void {
  const router = useRouter();
  return useCallback(
    (to, opts) => {
      if (!opts?.skipGuard && !confirmNavigation()) return;
      if (opts?.replace) router.replace(adminHref(to));
      else router.push(adminHref(to));
    },
    [router],
  );
}

export const AdminParamsContext = createContext<Record<string, string>>({});

export function useAdminParams(): Record<string, string> {
  return useContext(AdminParamsContext);
}

export function Redirect({ to }: { to: string }) {
  const navigate = useAdminNavigate();
  useEffect(() => {
    navigate(to, { replace: true });
  }, [navigate, to]);
  return null;
}

export function useAdminSearch(): string {
  const qs = useSearchParams().toString();
  return qs ? `?${qs}` : '';
}

/** One query parameter of the current admin URL, or `null`. */
export function useAdminSearchParam(name: string): string | null {
  return useSearchParams().get(name);
}

/** Pathname without the `/admin` prefix; `/` for the root. */
export function useAdminPathname(): string {
  const p = usePathname() ?? '/';
  const rest = p === '/admin' ? '' : p.startsWith('/admin/') ? p.slice('/admin'.length) : p;
  return rest === '' ? '/' : rest;
}
