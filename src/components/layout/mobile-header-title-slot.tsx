'use client';

import { useMobileHeader } from './mobile-header-context';

/**
 * Crossfades the "BFKDO St. Pölten" wordmark with the current page's collapsing large title
 * (CollapsingPageTitle) as titleProgress goes 0 -> 1. Both spans are absolutely stacked in the
 * same box rather than side by side, so only one text occupies the limited mobile header width at
 * a time - matches how iOS itself swaps the nav bar's title area instead of adding a second label.
 */
export function MobileHeaderTitleSlot({ fallback }: { fallback: string }) {
  const { title, titleProgress } = useMobileHeader();

  return (
    <div className="relative h-5 min-w-0 flex-1 sm:hidden">
      <span
        className="absolute inset-0 truncate text-[17px] font-semibold text-white transition-opacity duration-150 motion-reduce:transition-none"
        style={{ opacity: 1 - titleProgress }}
      >
        {fallback}
      </span>
      {title && (
        <span
          className="absolute inset-0 truncate text-[17px] font-semibold text-white transition-opacity duration-150 motion-reduce:transition-none"
          style={{ opacity: titleProgress }}
        >
          {title}
        </span>
      )}
    </div>
  );
}
