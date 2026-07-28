'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { SessionUser } from '@/types/next-auth';
import { canViewDroneModule, isSiteAdmin } from '@/lib/auth/permissions';

interface NavItem {
  href: string;
  label: string;
}

export function Nav({ user }: { user: SessionUser }) {
  const pathname = usePathname();

  const items: NavItem[] = [{ href: '/kalender', label: 'Kalender' }];

  if (canViewDroneModule(user)) {
    items.push({ href: '/drohnen', label: 'Drohnengruppe' });
  }

  if (isSiteAdmin(user)) {
    items.push({ href: '/admin/benutzer', label: 'Verwaltung' });
  }

  // Nested routes (e.g. /kalender/abschnitt under /kalender) would otherwise match
  // more than one item's prefix check; only the longest (most specific) match wins.
  const activeHref = items
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <nav className="flex flex-wrap gap-1">
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
