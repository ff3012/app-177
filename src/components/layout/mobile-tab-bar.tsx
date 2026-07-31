'use client';

import type { ReactElement } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { SessionUser } from '@/types/next-auth';
import { getActiveNavHref, getNavItems } from '@/lib/nav-items';

// Hand-authored inline SVGs, matching this codebase's existing convention (e.g. the edit-pencil
// icon in user-management-section.tsx) - no icon library is used anywhere in the app.
const ICONS: Record<string, ReactElement> = {
  '/kalender': (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="5" width="18" height="16" rx="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 10h18M8 3v4M16 3v4" strokeLinecap="round" />
    </svg>
  ),
  '/drohnen': (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="2.5" />
      <path d="M5 5l3.5 3.5M19 5l-3.5 3.5M5 19l3.5-3.5M19 19l-3.5-3.5" strokeLinecap="round" />
      <circle cx="5" cy="5" r="1.6" />
      <circle cx="19" cy="5" r="1.6" />
      <circle cx="5" cy="19" r="1.6" />
      <circle cx="19" cy="19" r="1.6" />
    </svg>
  ),
  '/news': (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 5h13a2 2 0 0 1 2 2v11l-3-2H6a2 2 0 0 1-2-2V5Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 9h7M8 12.5h5" strokeLinecap="round" />
    </svg>
  ),
  '/admin/benutzer': (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 8a3 3 0 1 1 0 6M22 20c0-2.6-1.8-4.8-4.2-5.6" strokeLinecap="round" />
    </svg>
  ),
};

// Mobile-only (<640px) counterpart to Nav (nav.tsx). z-30: above ordinary page content, but below
// the profile dropdown (z-40) and the calendar's full-screen event modal (z-50) - see the z-index
// table in the design plan for why that ordering matters (a fixed bottom bar must never be tappable
// through/above content that's meant to be blocking).
export function MobileTabBar({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const items = getNavItems(user);
  const activeHref = getActiveNavHref(items, pathname);

  return (
    <nav
      className="pb-safe-tabbar fixed inset-x-0 bottom-0 z-30 grid grid-cols-[repeat(var(--tab-count),1fr)] border-t border-neutral-200 bg-white sm:hidden"
      style={{ '--tab-count': items.length } as React.CSSProperties}
      aria-label="Hauptnavigation"
    >
      {items.map((item) => {
        const active = item.href === activeHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center justify-center gap-0.5 pt-2 text-[11px] font-medium ${
              active ? 'text-brand' : 'text-[#aeaeb2]'
            }`}
            aria-current={active ? 'page' : undefined}
          >
            {ICONS[item.href]}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
