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
  contentNew: page(() => import('../pages/content/ContentNew').then((m) => m.ContentNew)),
  contentDetail: page(() => import('../pages/content/ContentDetail').then((m) => m.ContentDetail)),
  contentEdit: page(() => import('../pages/content/ContentEdit').then((m) => m.ContentEdit)),
  pages: page(() => import('../pages/Pages').then((m) => m.Pages)),
  pageEditor: page(() => import('../pages/PageEditor').then((m) => m.PageEditor)),
  settingsContentTypes: page(() => import('../pages/content-types/TypeList').then((m) => m.TypeList)),
  settingsContentTypeNew: page(() => import('../pages/content-types/TypeNew').then((m) => m.TypeNew)),
  settingsContentTypeDetail: page(() => import('../pages/content-types/TypeDetail').then((m) => m.TypeDetail)),
  settingsContentTypeEdit: page(() => import('../pages/content-types/TypeEdit').then((m) => m.TypeEdit)),
  settingsContentGroups: page(() => import('../pages/content-types/GroupsPage').then((m) => m.GroupsPage)),
  settingsUsers: page(() => import('../pages/Users').then((m) => m.Users)),
  settingsGroups: page(() => import('../pages/Groups').then((m) => m.Groups)),
  settingsLanguages: page(() => import('../pages/Languages').then((m) => m.Languages)),
  settingsBlocks: page(() => import('../pages/Blocks').then((m) => m.Blocks)),
  settingsTheme: page(() => import('../pages/ThemeSettings').then((m) => m.ThemeSettings)),
  blockEditor: page(() => import('../pages/BlockEditor').then((m) => m.BlockEditor)),
  redirectUsers: redirectTo('/settings/users'),
  redirectBuilder: redirectTo('/settings/content-types'),
  account: page(() => import('../pages/Account').then((m) => m.Account)),
  notFound: page(() => import('../pages/NotFound').then((m) => m.NotFound)),
};
