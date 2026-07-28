'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/admin/benutzer', label: 'Benutzerverwaltung' },
  { href: '/admin/drohnen', label: 'Drohnengruppe' },
  { href: '/admin/email', label: 'E-Mail' },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <div className="flex flex-wrap gap-2">
      {ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${
              active
                ? 'bg-brand text-white'
                : 'border border-neutral-200 bg-white text-neutral-900 hover:bg-neutral-50'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
