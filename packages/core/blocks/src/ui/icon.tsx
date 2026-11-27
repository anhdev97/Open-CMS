// Curated icon set (`ICON_NAMES` in @opencloudcms/schema) mapped to explicitly imported lucide components, so the
// website bundle holds this set only. lucide-react has no brand icons: the six social glyphs are drawn here with
// lucide's own `createLucideIcon` (24×24, stroke `currentColor`, same props). Isomorphic: no hooks, no globals.
import {
  ArrowLeftIcon, ArrowRightIcon, ArrowUpRightIcon, AwardIcon, BellIcon, BookmarkIcon, CalendarIcon, CheckCircleIcon, CheckIcon,
  ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ChevronUpIcon, ClockIcon, CreditCardIcon, DownloadIcon, ExternalLinkIcon,
  EyeIcon, FilterIcon, GiftIcon, GlobeIcon, HeartIcon, HelpCircleIcon, HomeIcon, ImageIcon, InfoIcon, LayoutGridIcon, LinkIcon,
  ListIcon, LockIcon, LogInIcon, LogOutIcon, MailIcon, MapIcon, MapPinIcon, MenuIcon, MessageCircleIcon, MinusIcon, MoonIcon,
  PackageIcon, PauseIcon, PercentIcon, PhoneIcon, PlayIcon, PlusIcon, SearchIcon, SendIcon, SettingsIcon, Share2Icon,
  ShieldCheckIcon, ShoppingBagIcon, ShoppingCartIcon, SlidersHorizontalIcon, StarIcon, StoreIcon, SunIcon, TagIcon,
  ThumbsUpIcon, TruckIcon, UserIcon, UsersIcon, XIcon, ZapIcon, AlertCircleIcon, createLucideIcon, type LucideIcon,
} from 'lucide-react';
import type { NodeStyle } from '@opencloudcms/schema';
import { cn } from './tokens';
import { styleAttr, styleProps } from './style';

/** Simple brand glyphs (outline style, like the rest of the set). */
const FacebookIcon = createLucideIcon('facebook', [
  ['path', { d: 'M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z', key: 'fb' }],
]);
const InstagramIcon = createLucideIcon('instagram', [
  ['rect', { width: '20', height: '20', x: '2', y: '2', rx: '5', ry: '5', key: 'ig1' }],
  ['circle', { cx: '12', cy: '12', r: '4', key: 'ig2' }],
  ['path', { d: 'M17.5 6.5h.01', key: 'ig3' }],
]);
const YoutubeIcon = createLucideIcon('youtube', [
  ['rect', { width: '20', height: '14', x: '2', y: '5', rx: '4', key: 'yt1' }],
  ['path', { d: 'm10 9 5 3-5 3z', key: 'yt2' }],
]);
const TwitterIcon = createLucideIcon('twitter', [
  ['path', { d: 'M4 4l16 16', key: 'tw1' }],
  ['path', { d: 'M20 4 13.5 11.5', key: 'tw2' }],
  ['path', { d: 'M10.5 12.5 4 20', key: 'tw3' }],
]);
const LinkedinIcon = createLucideIcon('linkedin', [
  ['path', { d: 'M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z', key: 'li1' }],
  ['rect', { width: '4', height: '12', x: '2', y: '9', key: 'li2' }],
  ['circle', { cx: '4', cy: '4', r: '2', key: 'li3' }],
]);
const GithubIcon = createLucideIcon('github', [
  ['path', { d: 'M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21', key: 'gh' }],
]);

/** Every `ICON_NAMES` entry → its component (test/blocks/components-ui.test.ts checks the two lists match). */
export const ICON_COMPONENTS: Record<string, LucideIcon> = {
  menu: MenuIcon, x: XIcon, 'chevron-down': ChevronDownIcon, 'chevron-up': ChevronUpIcon, 'chevron-left': ChevronLeftIcon,
  'chevron-right': ChevronRightIcon, 'arrow-right': ArrowRightIcon, 'arrow-left': ArrowLeftIcon, 'arrow-up-right': ArrowUpRightIcon,
  search: SearchIcon, home: HomeIcon, 'external-link': ExternalLinkIcon, link: LinkIcon, list: ListIcon, 'layout-grid': LayoutGridIcon,
  filter: FilterIcon, 'sliders-horizontal': SlidersHorizontalIcon,
  'shopping-cart': ShoppingCartIcon, 'shopping-bag': ShoppingBagIcon, package: PackageIcon, store: StoreIcon, truck: TruckIcon,
  'credit-card': CreditCardIcon, gift: GiftIcon, tag: TagIcon, percent: PercentIcon, heart: HeartIcon, star: StarIcon,
  user: UserIcon, users: UsersIcon, phone: PhoneIcon, mail: MailIcon, 'map-pin': MapPinIcon, map: MapIcon,
  'message-circle': MessageCircleIcon, send: SendIcon, bell: BellIcon, globe: GlobeIcon,
  clock: ClockIcon, calendar: CalendarIcon,
  check: CheckIcon, 'check-circle': CheckCircleIcon, info: InfoIcon, 'alert-circle': AlertCircleIcon, 'help-circle': HelpCircleIcon,
  plus: PlusIcon, minus: MinusIcon, 'shield-check': ShieldCheckIcon, award: AwardIcon, zap: ZapIcon, 'thumbs-up': ThumbsUpIcon,
  'share-2': Share2Icon, download: DownloadIcon, play: PlayIcon, pause: PauseIcon, image: ImageIcon, bookmark: BookmarkIcon,
  eye: EyeIcon, lock: LockIcon, settings: SettingsIcon, 'log-in': LogInIcon, 'log-out': LogOutIcon, sun: SunIcon, moon: MoonIcon,
  facebook: FacebookIcon, instagram: InstagramIcon, youtube: YoutubeIcon, twitter: TwitterIcon, linkedin: LinkedinIcon, github: GithubIcon,
};

export type IconSize = 'sm' | 'md' | 'lg' | 'xl';
export const ICON_SIZE: Record<IconSize, string> = { sm: 'size-4', md: 'size-5', lg: 'size-6', xl: 'size-8' };

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * Inline svg of a curated icon; nothing for an unknown name. With a non-empty `label` it is an image named by the
 * label (`role="img"`); without one it is decorative (`aria-hidden`).
 */
export function Icon({
  name, size, label, className, style, id,
}: { name: string; size?: IconSize; label?: string; className?: string; style?: NodeStyle; id?: string }) {
  if (typeof name !== 'string' || !has(ICON_COMPONENTS, name)) return null;
  const C = ICON_COMPONENTS[name];
  const sp = styleProps(style, 'inline');
  const cls = cn('shrink-0', ICON_SIZE[size as IconSize] ?? ICON_SIZE.md, className, sp.className);
  const st = styleAttr(sp);
  const l = typeof label === 'string' ? label.trim() : '';
  return l ? <C id={id} className={cls} style={st} role="img" aria-label={l} /> : <C id={id} className={cls} style={st} aria-hidden="true" />;
}
