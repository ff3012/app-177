'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/admin/benutzer', label: 'Benutzerverwaltung' },
  { href: '/admin/drohnen', label: 'Drohnengruppe' },
  { href: '/admin/email', label: 'E-Mail' },
  { href: '/admin/status', label: 'Status' },
];

/** Verwaltung-Brief.md 5: "Sidebar entfällt. Stattdessen horizontale, scrollbare Tabs unter dem
 * Titel." - separate Komponente statt AdminSidebarNav wiederzuverwenden, da die visuelle Sprache
 * (Pill-Tabs statt Sidebar-Zeilen) grundverschieden ist; beide teilen dieselbe ITEMS-Liste bewusst
 * dupliziert statt in eine gemeinsame Datei ausgelagert - vier feste Einträge, geringes
 * Pflegerisiko, analog zur bisherigen Praxis dieser Codebase bei kleinen Konstanten-Listen. */
export function AdminMobileTabs() {
  const pathname = usePathname();

  return (
    <nav className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 md:hidden" aria-label="Verwaltung">
      {ITEMS.map((item) => {
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
