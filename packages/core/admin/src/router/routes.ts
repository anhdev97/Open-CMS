'use client';

import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
import type { RouteId } from './match';

const page = (load: () => Promise<ComponentType>) => dynamic(load, { ssr: false });

/** One lazily loaded chunk per page. */
export const pages: Record<RouteId, ComponentType> = {
  uikit: page(() => import('../pages/UiKit').then((m) => m.UiKit)),
  setup: page(() => import('../pages/Setup').then((m) => m.Setup)),
  login: page(() => import('../pages/Login').then((m) => m.Login)),
  home: page(() => import('../pages/Home').then((m) => m.Home)),
  content: page(() => import('../pages/Content').then((m) => m.Content)),
  builder: page(() => import('../pages/Builder').then((m) => m.Builder)),
  users: page(() => import('../pages/Users').then((m) => m.Users)),
  account: page(() => import('../pages/Account').then((m) => m.Account)),
  notFound: page(() => import('../pages/NotFound').then((m) => m.NotFound)),
};
