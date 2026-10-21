'use client';

import type { ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { can, routePermission } from '../lib/can';
import { Forbidden } from '../pages/Forbidden';
import type { RouteId } from './match';

/** Renders Forbidden (inside the layout) when the signed-in user lacks the route's permission. Unguarded routes pass through. */
export function RouteGuard({ id, children }: { id: RouteId; children: ReactNode }) {
  const need = routePermission(id);
  if (!need) return <>{children}</>;
  return <Gate need={need}>{children}</Gate>;
}

function Gate({ need, children }: { need: Parameters<typeof can>[1]; children: ReactNode }) {
  const { user } = useAuth();
  return can(user.permissions, need) ? <>{children}</> : <Forbidden />;
}
