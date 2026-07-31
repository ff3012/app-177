'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/admin/benutzer', label: 'Benutzerverwaltung' },
  { href: '/admin/drohnen', label: 'Drohnengruppe' },
  { href: '/admin/email', label: 'E-Mail' },
  { href: '/admin/status', label: 'Status' },
];

/** Ersetzt die bisherige AdminNav (horizontale Pill-Reihe) durch die vertikale Sidebar-Liste aus
 * Verwaltung-Brief.md. Eigene Client-Komponente nur für die Link-Liste (braucht usePathname für
 * den aktiven Zustand), damit die umgebende AdminSidebar als Server Component den Status-Teil
 * direkt serverseitig rendern kann. */
export function AdminSidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5">
      {ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`flex h-10 items-center rounded-[7px] px-3 text-sm ${
              active ? 'bg-brand-subtle font-semibold text-brand-hover' : 'text-ink-muted hover:bg-surface-sunken'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
