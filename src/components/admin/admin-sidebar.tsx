import Link from 'next/link';
import { getAdminSidebarStatus } from '@/lib/system/system-check';
import { AdminSidebarNav } from './admin-sidebar-nav';

const STATUS_ROWS = [
  { key: 'database', label: 'Datenbank' },
  { key: 'mailjet', label: 'Mailjet' },
  { key: 'ntp', label: 'Zeitserver' },
] as const;

/** Verwaltung-Brief.md: feste linke Sidebar (210px, nur ab md:) statt der bisherigen horizontalen
 * AdminNav-Pillreihe. Server Component - liest den Status direkt serverseitig
 * (getAdminSidebarStatus ist selbst 60s gecacht, siehe system-check.ts), nur die Link-Liste
 * braucht als Client-Unterkomponente usePathname für den aktiven Zustand. */
export async function AdminSidebar() {
  const status = await getAdminSidebarStatus();

  return (
    <aside className="hidden shrink-0 border-r border-line py-6 pl-3.5 pr-3.5 md:block md:w-[210px]">
      <span className="mb-3 block px-3 text-[11px] font-semibold uppercase tracking-[.13em] text-ink-faint">
        Verwaltung
      </span>
      <AdminSidebarNav />
      <Link
        href="/admin/status"
        className="mt-6 flex flex-col gap-2 border-t border-line pt-4 hover:opacity-80"
      >
        {STATUS_ROWS.map((row) => (
          <span key={row.key} className="flex items-center gap-2 px-3 text-xs text-ink-muted">
            <span
              aria-hidden
              className={`h-2 w-2 shrink-0 rounded-full ${status[row.key] ? 'bg-success' : 'bg-danger'}`}
            />
            {row.label}
          </span>
        ))}
      </Link>
    </aside>
  );
}
