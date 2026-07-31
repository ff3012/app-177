'use client';

import { useEffect, useRef } from 'react';
import { useMobileHeader } from './mobile-header-context';

// Height of the mobile single-row header bar (h-14 below in (app)/layout.tsx) - the intersection
// threshold is offset by exactly this so the crossfade lines up with the bar's own bottom edge,
// not the raw viewport top.
const MOBILE_HEADER_HEIGHT_PX = 56;

// 21 steps (0, .05, .1, ..., 1) so the observer fires often enough for a visually continuous
// crossfade/shrink instead of a hard cut - IntersectionObserver only re-fires when the ratio
// crosses one of these thresholds, so more steps = smoother, fewer = cheaper.
const THRESHOLDS = Array.from({ length: 21 }, (_, i) => i / 20);

/**
 * iOS-style large title that collapses into the shared mobile header bar as the user scrolls past
 * it. Only meaningful on mobile (<640px, where the header is a single fixed row) - on desktop this
 * just renders the same plain heading Kalender always had, no observer, no cost.
 */
export function CollapsingPageTitle({ title }: { title: string }) {
  const { setTitle } = useMobileHeader();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const headingEl = titleRef.current;
    if (!sentinel || !headingEl) return;
    // Rebound to a non-null-typed const: TS doesn't retain the narrowing above inside the nested
    // function declarations below (resetToDesktop, the observer callback), even though `const` +
    // that guard makes it safe in practice.
    const heading = headingEl;

    const mobileQuery = window.matchMedia('(max-width: 639px)');
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    // Inline styles always win over the sm: CSS classes below, so on desktop we must clear them
    // back to '' (letting the classes take over) rather than relying on a CSS override that inline
    // styles would ignore anyway.
    function resetToDesktop() {
      heading.style.opacity = '';
      heading.style.transform = '';
      setTitle(null, 0);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!mobileQuery.matches) {
          resetToDesktop();
          return;
        }
        const ratio = entries[0]?.intersectionRatio ?? 1;
        const progress = 1 - ratio;
        setTitle(title, progress);
        heading.style.opacity = String(1 - progress);
        heading.style.transform = reducedMotionQuery.matches
          ? 'none'
          : `translateY(${-progress * 8}px) scale(${1 - progress * 0.05})`;
      },
      { threshold: THRESHOLDS, rootMargin: `-${MOBILE_HEADER_HEIGHT_PX}px 0px 0px 0px` },
    );
    observer.observe(sentinel);

    mobileQuery.addEventListener('change', resetToDesktop);

    return () => {
      observer.disconnect();
      mobileQuery.removeEventListener('change', resetToDesktop);
      resetToDesktop();
    };
  }, [title, setTitle]);

  return (
    <>
      <h1
        ref={titleRef}
        className="text-[28px] font-bold leading-tight text-neutral-900 transition-[opacity,transform] duration-150 motion-reduce:transition-none sm:text-lg sm:font-semibold"
      >
        {title}
      </h1>
      <div ref={sentinelRef} aria-hidden className="h-px w-full sm:hidden" />
    </>
  );
}
