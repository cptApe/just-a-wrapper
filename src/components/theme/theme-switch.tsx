'use client';

import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { useLayoutEffect, useReducer, useRef } from 'react';
import { IconMonitor01, IconMoon01, IconSun } from '@/components/icons';
import { arrowKeyIndex } from '@/components/theme/arrow-key-index';
import { type ThemePreference, useTheme } from '@/components/theme/theme-provider';
import { useHydrated } from '@/hooks/use-hydrated';
import { cn } from '@/lib/utils';
import { indicatorReducer } from './lib/indicator-machine';

// The pill slide uses WAAPI, not a CSS transition: next-themes runs with
// `disableTransitionOnChange`, which drops a global `* { transition: none }`
// for one frame on every theme flip — exactly when the pill moves — so a CSS
// transition would be suppressed. WAAPI is unaffected.

const OPTIONS: { value: ThemePreference; Icon: typeof IconSun; label: string }[] = [
  { value: 'light', Icon: IconSun, label: 'Light' },
  { value: 'dark', Icon: IconMoon01, label: 'Dark' },
  { value: 'system', Icon: IconMonitor01, label: 'System' },
];

// Indicator travel per segment: the size-8 (2rem) segment plus the gap-px
// (0.125rem) between segments — the two must move in lockstep or the pill
// lands off-center on the outer segments.
const SEGMENT_STEP_REM = 2.0625;
const SLIDE_EASING = 'cubic-bezier(0,0,0.2,1)';
const SLIDE_DURATION_MS = 200;

const trackClasses = 'relative flex items-center gap-px rounded-button bg-glass-bg-hover p-0.5';
const segmentClasses =
  'relative z-10 flex size-8 items-center justify-center rounded-button transition-colors duration-150';

function useSlideIndicator(activeIndex: number, mounted: boolean) {
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const [state, dispatch] = useReducer(indicatorReducer, { kind: 'unmounted', index: activeIndex });
  if (mounted && (state.kind === 'unmounted' || state.index !== activeIndex)) {
    dispatch({ index: activeIndex });
  }

  useLayoutEffect(() => {
    const el = indicatorRef.current;
    if (!el) return;

    const from = state.kind === 'ready' ? state.from : activeIndex;
    const to = activeIndex;
    const canAnimate = state.kind === 'ready';

    const toTransform = `translateX(${to * SEGMENT_STEP_REM}rem)`;
    // Pin the resting transform so the indicator is correct even when the
    // animation is skipped (no movement, reduced motion, or pre-mount).
    el.style.transform = toTransform;

    if (!canAnimate) return;
    if (from === to) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    el.animate(
      [{ transform: `translateX(${from * SEGMENT_STEP_REM}rem)` }, { transform: toTransform }],
      { duration: SLIDE_DURATION_MS, easing: SLIDE_EASING },
    );
  }, [activeIndex, state]);

  return indicatorRef;
}

function SlideIndicator({
  indicatorRef,
  activeIndex,
  mounted,
  className,
}: {
  indicatorRef: React.RefObject<HTMLSpanElement | null>;
  activeIndex: number;
  mounted: boolean;
  className?: string;
}) {
  return (
    <span
      ref={indicatorRef}
      aria-hidden
      className={cn('absolute top-0.5 left-0.5 size-8 rounded-button', className)}
      style={{
        transform: `translateX(${activeIndex * SEGMENT_STEP_REM}rem)`,
        opacity: mounted ? 1 : 0,
      }}
    />
  );
}

// Radix menus only roving-focus registered menu items and close on Tab, so a
// nested radiogroup of plain buttons would be unreachable by keyboard; each
// option is therefore a real `menuitemradio` item.
export function ThemeMenuSwitch({ className }: { className?: string }) {
  const { preference: stored, setPreference } = useTheme();
  const mounted = useHydrated();
  // next-themes reads localStorage in the client's first render while the
  // server rendered the default, so the hydration render must use the default
  // too; the real preference applies right after mount (the pill snaps there).
  const preference: ThemePreference = mounted ? stored : 'system';
  const activeIndex = Math.max(
    0,
    OPTIONS.findIndex((o) => o.value === preference),
  );
  const indicatorRef = useSlideIndicator(activeIndex, mounted);
  const segmentRefs = useRef<(HTMLDivElement | null)[]>([]);

  return (
    <DropdownMenuPrimitive.RadioGroup
      value={preference}
      onValueChange={(value) => {
        const next = OPTIONS.find((o) => o.value === value);
        if (next) setPreference(next.value);
      }}
      aria-label="Theme"
      className={cn(trackClasses, className)}
    >
      <SlideIndicator
        indicatorRef={indicatorRef}
        activeIndex={activeIndex}
        mounted={mounted}
        className="bg-glass-separator"
      />
      {OPTIONS.map((o, index) => (
        <DropdownMenuPrimitive.RadioItem
          key={o.value}
          value={o.value}
          aria-label={`${o.label} theme`}
          ref={(el) => {
            segmentRefs.current[index] = el;
          }}
          onSelect={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            // Horizontal control in a vertical menu: make Left/Right move
            // between segments too (Radix only wires Up/Down).
            const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
            if (delta === 0) return;
            e.preventDefault();
            e.stopPropagation();
            segmentRefs.current[(index + delta + OPTIONS.length) % OPTIONS.length]?.focus();
          }}
          className={cn(
            segmentClasses,
            'outline-none text-glass-fg-secondary',
            'data-[highlighted]:bg-glass-bg-hover data-[highlighted]:text-glass-fg',
            'data-[state=checked]:text-glass-fg',
          )}
        >
          <o.Icon className="size-5" />
        </DropdownMenuPrimitive.RadioItem>
      ))}
    </DropdownMenuPrimitive.RadioGroup>
  );
}

export type ThemeSwitchOption<V extends string> = {
  value: V;
  Icon: typeof IconSun;
  label: string;
};

/** Light and dark, the pair every non-menu switch in the product offers. */
export const LIGHT_DARK_OPTIONS = [
  { value: 'light', Icon: IconSun, label: 'Light' },
  { value: 'dark', Icon: IconMoon01, label: 'Dark' },
] as const satisfies readonly ThemeSwitchOption<'light' | 'dark'>[];

/** The same sliding icon switch as the menu, on a light surface and outside
    any menu: plain radio buttons, arrow keys move the selection. Use this
    wherever a theme or scheme toggle is needed instead of drawing a new one. */
export function ThemeIconSwitch<V extends string>({
  options,
  value,
  onChange,
  label = 'Theme',
  className,
}: {
  options: readonly ThemeSwitchOption<V>[];
  value: V;
  onChange: (value: V) => void;
  label?: string;
  className?: string;
}) {
  const mounted = useHydrated();
  const activeIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const indicatorRef = useSlideIndicator(activeIndex, mounted);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'relative flex shrink-0 items-center gap-px rounded-button bg-alpha-6 p-0.5',
        className,
      )}
      onKeyDown={(e) => {
        const nextIndex = arrowKeyIndex(e.key, activeIndex, options.length);
        if (nextIndex === null) return;
        e.preventDefault();
        const next = options.at(nextIndex);
        if (!next) return;
        onChange(next.value);
        // Move focus with the selection so the roving tabindex stays on the
        // focused segment and the next Tab leaves the group from there.
        buttonRefs.current[nextIndex]?.focus();
      }}
    >
      <SlideIndicator
        indicatorRef={indicatorRef}
        activeIndex={activeIndex}
        mounted={mounted}
        className="bg-background shadow-sm dark:shadow-none"
      />
      {options.map((o, index) => (
        <button
          key={o.value}
          ref={(el) => {
            buttonRefs.current[index] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          aria-label={`${o.label} ${label.toLowerCase()}`}
          tabIndex={value === o.value ? 0 : -1}
          onClick={() => onChange(o.value)}
          className={cn(
            segmentClasses,
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
            value === o.value ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <o.Icon className="size-5" />
        </button>
      ))}
    </div>
  );
}
