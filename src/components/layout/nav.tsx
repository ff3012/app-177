'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { SessionUser } from '@/types/next-auth';
import { getActiveNavHref, getNavItems } from '@/lib/nav-items';

// Desktop-only (>=640px) - MobileTabBar (mobile-tab-bar.tsx) renders the same items below that
// breakpoint. Both stay mounted in the DOM at all times; Tailwind's hidden/sm: classes decide
// which one paints, matching this codebase's only responsive convention (no JS media queries).
export function Nav({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const items = getNavItems(user);
  const activeHref = getActiveNavHref(items, pathname);

  return (
    <nav className="hidden flex-wrap gap-1 sm:flex">
      {items.map((item) => {
        const active = item.href === activeHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded px-3 py-2 text-sm font-medium ${
              active ? 'bg-brand text-white' : 'text-neutral-200 hover:bg-white/10'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
