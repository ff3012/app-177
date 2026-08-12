import Link from 'next/link';
import { getAdminSidebarStatus } from '@/lib/system/system-check';
import { getAdminNavItems } from '@/lib/admin/nav-items';
import { getReachableScopes, getScopeMemberCounts } from '@/lib/admin/scope';
import type { SessionUser } from '@/types/next-auth';
import { AdminSidebarNav } from './admin-sidebar-nav';
import { GeltungsbereichSelector } from './geltungsbereich-selector';

const STATUS_ROWS = [
  { key: 'database', label: 'Datenbank' },
  { key: 'mailjet', label: 'Mailjet' },
  { key: 'ntp', label: 'Zeitserver' },
] as const;

/** Verwaltung-Brief.md: feste linke Sidebar (nur ab md:) statt der bisherigen horizontalen
 * AdminNav-Pillreihe. Server Component - liest den Status direkt serverseitig
 * (getAdminSidebarStatus ist selbst 60s gecacht, siehe system-check.ts), nur die Link-Liste
 * braucht als Client-Unterkomponente usePathname für den aktiven Zustand. user wird von
 * admin/layout.tsx durchgereicht, seit die Nav-Items berechtigungsabhängig sind (Heimatfeuerwehr-
 * Admins ohne Site-Admin-Recht sehen hier nur "Heimatfeuerwehr").
 *
 * Benutzerverwaltung-Breite-Brief.md §6: Breite 210px -> 246px, und die Sidebar scrollt nicht mehr
 * mit der Tabelle mit (position: sticky; top: 62px - Höhe des app-weiten Headers aus (app)/
 * layout.tsx; height: calc(100dvh - 62px), eigener overflow-y-auto falls die Sidebar selbst mal
 * länger als der Viewport wird).
 *
 * Geltungsbereich-Wähler (Verwaltung-Filter-Brief.md §2): sitzt bewusst AUSSERHALB des
 * gepolsterten Innenbereichs, randlos über der gesamten Sidebar-Breite mit eigener Hairline -
 * deshalb wanderte das bisherige py-6/pl-3.5/pr-3.5 vom <aside> selbst auf einen inneren <div>.
 * GeltungsbereichSelector rendert selbst `null`, wenn reachable.length <= 1 ist (z. B. ein
 * Feuerwehr-Admin mit nur seiner Heimatwehr) - keine eigene Bedingung hier nötig. memberCounts
 * (§6: "486 Mitglieder" in der Kontextzeile) kommt aus derselben cache()-deduplizierten Quelle wie
 * reachableScopes (scope.ts), ein zusätzlicher Request kostet also nur eine weitere Prisma-Abfrage,
 * keinen weiteren Seitenaufruf. */
export async function AdminSidebar({ user }: { user: SessionUser }) {
  const [status, reachableScopes, memberCounts] = await Promise.all([
    getAdminSidebarStatus(),
    getReachableScopes(user),
    getScopeMemberCounts(user),
  ]);
  const items = getAdminNavItems(user);

  return (
    <aside className="sticky top-[62px] hidden h-[calc(100dvh-62px)] shrink-0 overflow-y-auto border-r border-line md:block md:w-[246px]">
      <GeltungsbereichSelector reachable={reachableScopes} memberCounts={memberCounts} />
      <div className="py-6 pl-3.5 pr-3.5">
        <span className="mb-3 block px-3 text-[11px] font-semibold uppercase tracking-[.13em] text-ink-faint">
          Verwaltung
        </span>
        <AdminSidebarNav items={items} />
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
      </div>
    </aside>
  );
}
