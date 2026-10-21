'use client';

import NextLink from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, type ComponentProps } from 'react';
import { adminHref } from './admin-href';

export { adminHref };

type LinkProps = Omit<ComponentProps<typeof NextLink>, 'href'> & { to: string };

/** `next/link` with an admin-relative `to`. */
export function Link({ to, ...rest }: LinkProps) {
  return <NextLink {...rest} href={adminHref(to)} />;
}

export function useAdminNavigate(): (to: string, opts?: { replace?: boolean }) => void {
  const router = useRouter();
  return useCallback(
    (to, opts) => {
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

/** Pathname without the `/admin` prefix; `/` for the root. */
export function useAdminPathname(): string {
  const p = usePathname() ?? '/';
  const rest = p === '/admin' ? '' : p.startsWith('/admin/') ? p.slice('/admin'.length) : p;
  return rest === '' ? '/' : rest;
}
