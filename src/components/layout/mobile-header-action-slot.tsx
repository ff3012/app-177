'use client';

import { useMobileHeader } from './mobile-header-context';

/** Renders whatever the current page registered (e.g. Kalender's filter button) - sm:hidden
 * unconditionally, since desktop's always-visible layout never needs a header action icon. */
export function MobileHeaderActionSlot() {
  const { actionSlot } = useMobileHeader();
  if (!actionSlot) return null;
  return <span className="sm:hidden">{actionSlot}</span>;
}
