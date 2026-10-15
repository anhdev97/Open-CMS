import { createContext, useContext } from 'react';

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  roles: string[];
}

export interface AuthContextValue {
  user: AuthUser;
  /** `POST /api/auth/logout`, then sends the whole page to the returned `redirectTo`. */
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthGate');
  return value;
}
