import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { isBezirksAdmin } from '@/lib/auth/permissions';
import { getAdminNavItems } from '@/lib/admin/nav-items';
import { getReachableScopes } from '@/lib/admin/scope';
import { GeltungsbereichSelector } from '@/components/admin/geltungsbereich-selector';
import { AdminMobileTabs } from '@/components/admin/admin-mobile-tabs';
import { isMcpEnabled } from '@/lib/mcp/enabled';
import { toggleMcpEnabled } from './actions';

// admin/layout.tsx lässt viele Rollen herein - diese Seite bleibt Bezirksadmin-only, daher die eigene Prüfung.
export default async function McpVerwaltungPage() {
  const user = await requireUser();
  const reachableScopes = await getReachableScopes(user);
  if (!isBezirksAdmin(user)) {
    notFound();
  }

  const enabled = await isMcpEnabled();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[28px] font-bold text-ink">KI-Zugriff</h1>

      <div className="md:hidden">
        <GeltungsbereichSelector reachable={reachableScopes} />
      </div>
      <AdminMobileTabs items={getAdminNavItems(user)} />

      <div className="flex max-w-[640px] flex-col gap-4">
        <div className="rounded-lg bg-surface p-4 shadow-card">
          <h2 className="mb-1 text-[15px] font-semibold text-ink">MCP-Connector für Claude und ChatGPT</h2>
          <p className="mb-3 text-sm text-ink-muted">
            Ist der Connector ausgeschaltet, antworten der Endpunkt und die Anmeldeseiten wie "nicht vorhanden". Wer ihn
            nutzen darf, wird je Benutzer in der Benutzerverwaltung festgelegt ("KI-Zugriff (MCP)").
          </p>
          <p className="mb-3 text-sm font-medium text-ink">
            Status: {enabled ? 'eingeschaltet' : 'ausgeschaltet'}
          </p>
          <form action={toggleMcpEnabled}>
            <input type="hidden" name="enabled" value={enabled ? 'false' : 'true'} />
            <button
              type="submit"
              className="min-h-11 rounded-md bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
            >
              {enabled ? 'Ausschalten' : 'Einschalten'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
