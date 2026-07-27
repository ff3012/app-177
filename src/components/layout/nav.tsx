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

  const items: NavItem[] = [
    { href: '/kalender', label: 'Meine Feuerwehr' },
    { href: '/kalender/abschnitt', label: 'Abschnitt-Kalender' },
  ];

  if (canViewDroneModule(user)) {
    items.push({ href: '/drohnen', label: 'Drohnengruppe' });
  }

  if (isSiteAdmin(user)) {
    items.push({ href: '/admin/benutzer', label: 'Verwaltung' });
  }

  return (
    <nav className="flex flex-wrap gap-1">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded px-3 py-2 text-sm font-medium ${
              active ? 'bg-brand text-white' : 'text-neutral-700 hover:bg-neutral-100'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
