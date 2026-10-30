'use client';

import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
import { Redirect, useAdminSearch } from '../lib/nav';
import type { RouteId } from './match';

const page = (load: () => Promise<ComponentType>) => dynamic(load, { ssr: false });

const redirectTo = (to: string): ComponentType =>
  function RedirectRoute() {
    return <Redirect to={`${to}${useAdminSearch()}`} />;
  };

/** One lazily loaded chunk per page. */
export const pages: Record<RouteId, ComponentType> = {
  uikit: page(() => import('../pages/UiKit').then((m) => m.UiKit)),
  setup: page(() => import('../pages/Setup').then((m) => m.Setup)),
  login: page(() => import('../pages/Login').then((m) => m.Login)),
  home: page(() => import('../pages/Home').then((m) => m.Home)),
  assets: page(() => import('../pages/Assets').then((m) => m.Assets)),
  content: page(() => import('../pages/Content').then((m) => m.Content)),
  settingsContentTypes: page(() => import('../pages/Builder').then((m) => m.Builder)),
  settingsUsers: page(() => import('../pages/Users').then((m) => m.Users)),
  settingsGroups: page(() => import('../pages/Groups').then((m) => m.Groups)),
  settingsLanguages: page(() => import('../pages/Languages').then((m) => m.Languages)),
  settingsSso: page(() => import('../pages/SsoManagement').then((m) => m.SsoManagement)),
  redirectUsers: redirectTo('/settings/users'),
  redirectBuilder: redirectTo('/settings/content-types'),
  account: page(() => import('../pages/Account').then((m) => m.Account)),
  notFound: page(() => import('../pages/NotFound').then((m) => m.NotFound)),
};
