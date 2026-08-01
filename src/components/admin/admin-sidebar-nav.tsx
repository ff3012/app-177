'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { AdminNavItem } from '@/lib/admin/nav-items';

/** Ersetzt die bisherige AdminNav (horizontale Pill-Reihe) durch die vertikale Sidebar-Liste aus
 * Verwaltung-Brief.md. Eigene Client-Komponente nur für die Link-Liste (braucht usePathname für
 * den aktiven Zustand), damit die umgebende AdminSidebar als Server Component den Status-Teil
 * direkt serverseitig rendern kann. items kommt von getAdminNavItems(user) statt einer fest
 * codierten Liste, seit "Heimatfeuerwehr" auch für reine Feuerwehr-Admins sichtbar ist. */
export function AdminSidebarNav({ items }: { items: AdminNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5">
      {items.map((item) => {
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
