// Curated icon names (kebab-case lucide names) for the Icon element and Button icons. Plain strings: the schema
// imports no icon library; the blocks UI maps each name to an explicitly imported component.

/** At most 80 names, nav and commerce first. */
export const ICON_NAMES: readonly string[] = [
  // navigation
  'menu', 'x', 'chevron-down', 'chevron-up', 'chevron-left', 'chevron-right', 'arrow-right', 'arrow-left', 'arrow-up-right',
  'search', 'home', 'external-link', 'link', 'list', 'layout-grid', 'filter', 'sliders-horizontal',
  // commerce
  'shopping-cart', 'shopping-bag', 'package', 'store', 'truck', 'credit-card', 'gift', 'tag', 'percent', 'heart', 'star',
  // people and contact
  'user', 'users', 'phone', 'mail', 'map-pin', 'map', 'message-circle', 'send', 'bell', 'globe',
  // time
  'clock', 'calendar',
  // status
  'check', 'check-circle', 'info', 'alert-circle', 'help-circle', 'plus', 'minus', 'shield-check', 'award', 'zap', 'thumbs-up',
  // actions and media
  'share-2', 'download', 'play', 'pause', 'image', 'bookmark', 'eye', 'lock', 'settings', 'log-in', 'log-out', 'sun', 'moon',
  // social
  'facebook', 'instagram', 'youtube', 'twitter', 'linkedin', 'github',
];

export function isIconName(v: unknown): boolean {
  return typeof v === 'string' && ICON_NAMES.includes(v);
}
