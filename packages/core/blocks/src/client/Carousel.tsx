'use client';
// Carousel: `<section aria-roledescription="carousel">` with a scroll-snap track, every slide in the server HTML. Swipe
// and scroll work without JS; arrows, dots and autoplay come after hydration and only when there are more slides than
// fit in view. Autoplay runs only when `autoplay` is a number of seconds and motion is not reduced; it pauses on hover,
// while focus is inside, while the tab is hidden and with the pause button. No browser globals at import time.
import { Children, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, PauseIcon, PlayIcon } from 'lucide-react';
import type { NodeStyle, Responsive } from '@opencloudcms/schema';
import type { SpacingToken } from '../types';
import { cn } from '../ui/tokens';
import { styleAttr, styleProps } from '../ui/style';
import { currentBreakpoint, perBreakpoint, prefersReducedMotion, subscribeMedia } from './media';

import {
  CAROUSEL, CAROUSEL_ARROW, CAROUSEL_DOT, CAROUSEL_DOT_MARK, CAROUSEL_DOTS, CAROUSEL_GAP, CAROUSEL_NEXT, CAROUSEL_PAUSE, CAROUSEL_PREV,
  CAROUSEL_SLIDE, CAROUSEL_SLIDE_SNAP, CAROUSEL_SNAP, CAROUSEL_TRACK, CAROUSEL_TRACK_ARROWS,
} from '../ui/carousel-classes';

export {
  CAROUSEL, CAROUSEL_ARROW, CAROUSEL_DOT, CAROUSEL_DOT_MARK, CAROUSEL_DOTS, CAROUSEL_GAP, CAROUSEL_NEXT, CAROUSEL_PAUSE, CAROUSEL_PREV,
  CAROUSEL_SLIDE, CAROUSEL_SLIDE_SNAP, CAROUSEL_SNAP, CAROUSEL_TRACK, CAROUSEL_TRACK_ARROWS,
};

type Msg = { prev: string; next: string; goto: string; of: string; pause: string; play: string };
const MSG: Record<string, Msg> = {
  'en-US': { prev: 'Previous slide', next: 'Next slide', goto: 'Go to slide {n}', of: '{n} of {total}', pause: 'Pause', play: 'Play' },
  'vi-VN': { prev: 'Trang trước', next: 'Trang sau', goto: 'Đến trang {n}', of: '{n} trên {total}', pause: 'Tạm dừng', play: 'Phát' },
  'fr-FR': { prev: 'Diapositive précédente', next: 'Diapositive suivante', goto: 'Aller à la diapositive {n}', of: '{n} sur {total}', pause: 'Pause', play: 'Lecture' },
  'id-ID': { prev: 'Slide sebelumnya', next: 'Slide berikutnya', goto: 'Ke slide {n}', of: '{n} dari {total}', pause: 'Jeda', play: 'Putar' },
};
const fill = (t: string, v: Record<string, number>) => t.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ''));
const isPerView = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 1 && x <= 6;

export type CarouselProps = {
  /** Each child is one slide. */
  children?: ReactNode;
  /** Slides in view per breakpoint, 1–6 (fractional allowed: the collection layout peeks with 1.25). */
  perView?: Responsive<number>;
  gap?: SpacingToken;
  arrows?: boolean;
  dots?: boolean;
  loop?: boolean;
  /** Seconds between slides; anything else is off. */
  autoplay?: number | 'off';
  /** Accessible name of the carousel (the block label). */
  label?: string;
  locale?: string;
  id?: string;
  style?: NodeStyle;
  /** Builder canvas only: no autoplay, no snapping or controls, slides side by side. Absent on the website. */
  editor?: { static?: boolean };
};

export function Carousel({ children, perView, gap = '4', arrows = true, dots = true, loop = false, autoplay, label, locale, id, style, editor }: CarouselProps) {
  const slides = Children.toArray(children);
  const total = slides.length;
  const pv = perBreakpoint<number>(perView, 1, isPerView);
  const msg = MSG[locale ?? ''] ?? MSG['en-US'];
  const isStatic = editor?.static === true;
  const seconds = typeof autoplay === 'number' && autoplay > 0 ? autoplay : 0;

  const track = useRef<HTMLDivElement>(null);
  const [hydrated, setHydrated] = useState(false);
  const [bp, setBp] = useState<'base' | 'md' | 'lg'>('base');
  const [reduced, setReduced] = useState(false);
  const [index, setIndex] = useState(0);
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pageHidden, setPageHidden] = useState(false);
  const [userPaused, setUserPaused] = useState(false);

  useEffect(() => {
    const read = () => {
      setBp(currentBreakpoint());
      setReduced(prefersReducedMotion());
    };
    read();
    setHydrated(true);
    const off = subscribeMedia(read);
    const onVis = () => setPageHidden(document.hidden);
    onVis();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      off();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const inView = pv[bp];
  const multi = !isStatic && total > inView;
  const last = Math.max(0, total - Math.floor(inView));
  const current = Math.min(index, last);

  const go = useCallback(
    (to: number) => {
      const i = Math.min(Math.max(0, to), last);
      setIndex(i);
      const t = track.current;
      const items = t ? (Array.from(t.children) as HTMLElement[]) : [];
      if (!t || !items[i]) return;
      const left = items[i].offsetLeft - (items[0]?.offsetLeft ?? 0);
      if (typeof t.scrollTo === 'function') t.scrollTo({ left, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      else t.scrollLeft = left;
    },
    [last],
  );

  // Swipe/scroll by the user: the nearest slide becomes current (layout only; nothing to read without one).
  const onScroll = () => {
    const t = track.current;
    if (!t || !t.clientWidth) return;
    const items = Array.from(t.children) as HTMLElement[];
    const start = items[0]?.offsetLeft ?? 0;
    let best = 0;
    items.forEach((el, i) => {
      if (Math.abs(el.offsetLeft - start - t.scrollLeft) < Math.abs((items[best]?.offsetLeft ?? 0) - start - t.scrollLeft)) best = i;
    });
    setIndex(Math.min(best, last));
  };

  const canAutoplay = hydrated && multi && seconds > 0 && !reduced;
  const running = canAutoplay && !userPaused && !hover && !focused && !pageHidden;
  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => go(current >= last ? 0 : current + 1), seconds * 1000);
    return () => clearTimeout(t);
  }, [running, current, last, seconds, go]);

  const sp = styleProps(style, 'block');
  const vars = {
    '--ocms-pv': String(pv.base),
    '--ocms-pv-md': String(pv.md),
    '--ocms-pv-lg': String(pv.lg),
    '--ocms-gap': CAROUSEL_GAP[gap] ?? CAROUSEL_GAP['4'],
  } as CSSProperties;
  const showArrows = hydrated && multi && arrows;
  const showDots = hydrated && multi && dots;

  return (
    <section
      id={id}
      aria-roledescription="carousel"
      aria-label={label || undefined}
      className={cn(CAROUSEL, sp.className)}
      style={styleAttr(sp)}
      onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        const next = e.relatedTarget;
        if (!(next instanceof Node) || !e.currentTarget.contains(next)) setFocused(false);
      }}
    >
      <div
        ref={track}
        data-ocms-carousel-track=""
        aria-live={running ? 'off' : 'polite'}
        className={cn(CAROUSEL_TRACK, isStatic ? undefined : CAROUSEL_SNAP, showArrows ? CAROUSEL_TRACK_ARROWS : undefined)}
        style={vars}
        onScroll={onScroll}
      >
        {slides.map((s, i) => (
          <div
            key={i}
            role="group"
            aria-roledescription="slide"
            aria-label={fill(msg.of, { n: i + 1, total })}
            className={cn(CAROUSEL_SLIDE, isStatic ? undefined : CAROUSEL_SLIDE_SNAP)}
          >
            {s}
          </div>
        ))}
      </div>
      {showArrows ? (
        <>
          <button type="button" aria-label={msg.prev} className={cn(CAROUSEL_ARROW, CAROUSEL_PREV)} disabled={!loop && current === 0} onClick={() => go(current === 0 ? last : current - 1)}>
            <ChevronLeftIcon className="size-4" aria-hidden="true" />
          </button>
          <button type="button" aria-label={msg.next} className={cn(CAROUSEL_ARROW, CAROUSEL_NEXT)} disabled={!loop && current >= last} onClick={() => go(current >= last ? 0 : current + 1)}>
            <ChevronRightIcon className="size-4" aria-hidden="true" />
          </button>
        </>
      ) : null}
      {showDots || canAutoplay ? (
        <div className={CAROUSEL_DOTS}>
          {canAutoplay ? (
            <button type="button" aria-label={userPaused ? msg.play : msg.pause} className={CAROUSEL_PAUSE} onClick={() => setUserPaused((p) => !p)}>
              {userPaused ? <PlayIcon className="size-3.5" aria-hidden="true" /> : <PauseIcon className="size-3.5" aria-hidden="true" />}
            </button>
          ) : null}
          {showDots
            ? Array.from({ length: last + 1 }, (_, i) => (
                <button key={i} type="button" aria-label={fill(msg.goto, { n: i + 1 })} aria-current={i === current} className={CAROUSEL_DOT} onClick={() => go(i)}>
                  <span className={CAROUSEL_DOT_MARK} />
                </button>
              ))
            : null}
        </div>
      ) : null}
    </section>
  );
}
