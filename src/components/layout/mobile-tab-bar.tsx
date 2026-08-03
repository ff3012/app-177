'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { SessionUser } from '@/types/next-auth';
import { canViewDroneModule } from '@/lib/auth/permissions';
import { WappenFallbackIcon } from './wappen-fallback-icon';

// Hand-authored inline SVGs, matching this codebase's existing convention - no icon library.
const KALENDER_ICON = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="5" width="18" height="16" rx="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3 10h18M8 3v4M16 3v4" strokeLinecap="round" />
  </svg>
);
const DROHNEN_ICON = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="2.5" />
    <path d="M5 5l3.5 3.5M19 5l-3.5 3.5M5 19l3.5-3.5M19 19l-3.5-3.5" strokeLinecap="round" />
    <circle cx="5" cy="5" r="1.6" />
    <circle cx="19" cy="5" r="1.6" />
    <circle cx="5" cy="19" r="1.6" />
    <circle cx="19" cy="19" r="1.6" />
  </svg>
);

function isActiveHref(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Startbildschirm-Brief.md §3: feste 3-Tab-Leiste (Kalender | Wappen-Home | Drohnengruppe),
 * bewusst NICHT mehr über getNavItems()/nav-items.ts gebaut wie die Desktop-<Nav> - dieser Umbau
 * betrifft laut Brief nur die mobile Ansicht, Desktop bleibt bei der bisherigen, permissionsgetriebenen
 * Item-Liste (News/Verwaltung landen auf Mobile stattdessen im Kopfzeilen-Pill bzw. im ProfileMenu,
 * siehe (app)/layout.tsx und profile-menu.tsx). Der Drohnengruppe-Tab entfällt ganz (statt einen
 * toten Link zu zeigen), wenn canViewDroneModule falsch ist - die mittlere Spalte bleibt trotzdem
 * zentriert, da alle drei Grid-Spalten immer gleich breit sind (repeat(3,1fr)).
 */
export function MobileTabBar({ user, wappenSrc }: { user: SessionUser; wappenSrc: string | null }) {
  const pathname = usePathname();
  const showDrohnen = canViewDroneModule(user);
  const kalenderActive = isActiveHref(pathname, '/kalender');
  const homeActive = isActiveHref(pathname, '/meine-feuerwehr');
  const drohnenActive = isActiveHref(pathname, '/drohnen');

  return (
    <nav
      className="pb-safe-tabbar fixed inset-x-0 bottom-0 z-30 grid h-[86px] grid-cols-3 items-start border-t border-neutral-200 bg-white pt-2.5 sm:hidden"
      aria-label="Hauptnavigation"
    >
      <Link
        href="/kalender"
        className={`flex flex-col items-center gap-0.5 text-[11px] font-medium ${kalenderActive ? 'text-brand' : 'text-[#aeaeb2]'}`}
        aria-current={kalenderActive ? 'page' : undefined}
      >
        {KALENDER_ICON}
        Kalender
      </Link>

      <Link
        href="/meine-feuerwehr"
        className="flex flex-col items-center gap-1"
        aria-current={homeActive ? 'page' : undefined}
      >
        <span className="-mt-4 flex h-[46px] w-[46px] items-center justify-center rounded-full bg-white shadow-[0_2px_10px_rgba(28,28,30,0.18)]">
          {wappenSrc ? (
            <img src={wappenSrc} alt="Wappen der eigenen Feuerwehr" className="h-[30px] w-[30px] object-contain" />
          ) : (
            <WappenFallbackIcon size={30} />
          )}
        </span>
        <span className={`text-[11px] font-semibold ${homeActive ? 'text-brand' : 'text-[#aeaeb2]'}`}>Meine Feuerwehr</span>
      </Link>

      {showDrohnen ? (
        <Link
          href="/drohnen"
          className={`flex flex-col items-center gap-0.5 text-[11px] font-medium ${drohnenActive ? 'text-brand' : 'text-[#aeaeb2]'}`}
          aria-current={drohnenActive ? 'page' : undefined}
        >
          {DROHNEN_ICON}
          Drohnengruppe
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
    </nav>
  );
}
