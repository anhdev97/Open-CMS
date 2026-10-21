import type { Locale } from '@opencms/schema';
import { createContext, useContext } from 'react';

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  roles: string[];
  /** Saved admin language; `null` means follow the browser. */
  locale?: Locale | null;
}

export interface AuthContextValue {
  user: AuthUser;
  /** `POST /api/auth/logout`, then sends the whole page to the returned `redirectTo`. */
  logout: () => Promise<void>;
  /** Updates the saved admin language in the cached user (after a successful `PATCH /api/auth/me`). */
  setUserLocale: (locale: Locale | null) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthGate');
  return value;
}
