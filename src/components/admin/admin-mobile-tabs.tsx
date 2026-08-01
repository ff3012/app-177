'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { AdminNavItem } from '@/lib/admin/nav-items';

/** Verwaltung-Brief.md 5: "Sidebar entfällt. Stattdessen horizontale, scrollbare Tabs unter dem
 * Titel." - separate Komponente statt AdminSidebarNav wiederzuverwenden, da die visuelle Sprache
 * (Pill-Tabs statt Sidebar-Zeilen) grundverschieden ist. items kommt seit "Heimatfeuerwehr" von
 * getAdminNavItems(user) statt einer fest codierten Liste (die vorher hier dupliziert war) -
 * jede aufrufende Seite berechnet items selbst aus ihrem eigenen requireUser()-Ergebnis. */
export function AdminMobileTabs({ items }: { items: AdminNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 md:hidden" aria-label="Verwaltung">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`flex h-9 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-sm font-medium ${
              active ? 'bg-brand text-white' : 'bg-surface-sunken text-ink-muted'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
