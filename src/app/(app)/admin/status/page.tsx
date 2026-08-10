import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { isBezirksAdmin } from '@/lib/auth/permissions';
import { getAdminNavItems } from '@/lib/admin/nav-items';
import { getReachableScopes } from '@/lib/admin/scope';
import { GeltungsbereichSelector } from '@/components/admin/geltungsbereich-selector';
import { AdminMobileTabs } from '@/components/admin/admin-mobile-tabs';
import { SystemCheckPanel } from './system-check-panel';

// admin/layout.tsx's Gate deckt seit "Heimatfeuerwehr" auch reine Feuerwehr-Admins ab - diese
// Seite bleibt Site-Admin-only, daher die eigene Prüfung hier (Sicherheits-Härtung, siehe
// CLAUDE.md).
export default async function StatusPage() {
  const user = await requireUser();
  const reachableScopes = await getReachableScopes(user);
  if (!isBezirksAdmin(user)) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[28px] font-bold text-ink">Status</h1>

      <div className="md:hidden">
        <GeltungsbereichSelector reachable={reachableScopes} />
      </div>
      <AdminMobileTabs items={getAdminNavItems(user)} />

      <SystemCheckPanel />
    </div>
  );
}
