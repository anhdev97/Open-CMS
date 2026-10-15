export const en = {
  app: {
    name: 'OpenCMS',
    loading: 'Loading the admin…',
    comingSoon: 'The admin screens are on their way.',
  },
  nav: {
    main: 'Main navigation',
    contentTypes: 'Content types',
    builder: 'Builder',
    users: 'Users',
    content: 'Content',
    noContentTypes: 'No content types yet',
    loadFailed: 'Could not load content types',
    skipToContent: 'Skip to content',
  },
  account: {
    menu: 'Account menu',
    account: 'Account',
    theme: 'Theme',
    logOut: 'Log out',
  },
  theme: {
    light: 'Light',
    dark: 'Dark',
    system: 'System',
  },
  status: {
    draft: 'Draft',
    published: 'Published',
    changed: 'Changed',
    active: 'Active',
    disabled: 'Disabled',
  },
  common: {
    cancel: 'Cancel',
    confirm: 'Confirm',
    delete: 'Delete',
  },
  ui: {
    title: 'UI kit',
    description: 'Every component and variant of the admin design system. Available in dev mode only.',
    sections: {
      buttons: 'Buttons',
      form: 'Form controls',
      badges: 'Badges and status',
      alerts: 'Alerts and errors',
      data: 'Cards, tables and loading',
      overlays: 'Dialogs, menus and tooltips',
      navigation: 'Tabs and page chrome',
    },
    sampleTitle: 'Sample title',
    sampleDescription: 'Supporting copy that explains the section in a sentence or two.',
    toggleTheme: 'Toggle dark mode',
    openDialog: 'Open dialog',
    openConfirm: 'Delete something',
    openDestructive: 'Confirm (destructive)',
    openMenu: 'Open menu',
    hoverMe: 'Hover or focus me',
    tooltipText: 'A helpful tooltip',
    showToast: 'Show toast',
    toastText: 'Saved successfully',
    emptyTitle: 'Nothing here yet',
    emptyDescription: 'Create the first item to see it listed.',
    emptyAction: 'Create item',
    confirmTitle: 'Delete this item?',
    confirmDescription: 'This cannot be undone.',
    sampleError: 'The request was rejected',
  },
} as const;

/** Looks up a dot path in `en` and fills `{name}` placeholders; returns the key itself when it is missing. */
export function t(key: string, vars?: Record<string, string | number>): string {
  let node: unknown = en;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in node)) return key;
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node !== 'string') return key;
  if (!vars) return node;
  return node.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}
