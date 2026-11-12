import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { isBezirksAdmin } from '@/lib/auth/permissions';
import { getAdminNavItems } from '@/lib/admin/nav-items';
import { getReachableScopes } from '@/lib/admin/scope';
import { GeltungsbereichSelector } from '@/components/admin/geltungsbereich-selector';
import { AdminMobileTabs } from '@/components/admin/admin-mobile-tabs';
import { prisma } from '@/lib/db/prisma';
import { isMcpEnabled } from '@/lib/mcp/enabled';
import { MCP_AUDIT_RETENTION_DAYS } from '@/lib/mcp/retention';
import { toggleMcpEnabled } from './actions';

const AUDIT_ROWS = 50;
const OUTCOME_LABEL: Record<string, string> = { OK: 'OK', DENIED: 'Abgelehnt', ERROR: 'Fehler' };

// admin/layout.tsx lässt viele Rollen herein - diese Seite bleibt Bezirksadmin-only, daher die eigene Prüfung.
export default async function McpVerwaltungPage() {
  const user = await requireUser();
  const reachableScopes = await getReachableScopes(user);
  if (!isBezirksAdmin(user)) {
    notFound();
  }

  const [enabled, entries, activeTokens] = await Promise.all([
    isMcpEnabled(),
    prisma.mcpAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: AUDIT_ROWS,
      include: { user: { select: { firstName: true, lastName: true } } },
    }),
    prisma.oauthToken.count({ where: { revokedAt: null, refreshExpiresAt: { gt: new Date() } } }),
  ]);
  const rows = entries.map((entry) => ({
    id: entry.id,
    time: entry.createdAt.toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Vienna' }),
    user: entry.user ? `${entry.user.lastName} ${entry.user.firstName}` : '–',
    tool: entry.tool,
    outcome: OUTCOME_LABEL[entry.outcome] ?? 'Fehler',
    summary: entry.summary,
  }));

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

      <div className="rounded-lg bg-surface p-4 shadow-card">
        <h2 className="mb-1 text-[15px] font-semibold text-ink">Prüfprotokoll</h2>
        <p className="mb-3 text-sm text-ink-muted">
          Schreibaktionen und abgelehnte Zugriffe (die letzten {AUDIT_ROWS} Einträge; Einträge werden nach {MCP_AUDIT_RETENTION_DAYS} Tagen gelöscht). Aktive Token: {activeTokens}.
        </p>
        {rows.length === 0 ? (
          <p className="text-sm text-ink-muted">Noch keine Einträge.</p>
        ) : (
          <>
            {/* Mobil: Karten, ab sm: Tabelle - beide aus demselben rows-Array. Zusammenfassungen sind reiner Text (React maskiert). */}
            <ul className="flex flex-col gap-2 sm:hidden">
              {rows.map((row) => (
                <li key={row.id} className="rounded-md border border-line p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-ink">{row.tool}</span>
                    <span className="text-xs font-medium text-ink">{row.outcome}</span>
                  </div>
                  <div className="mt-1 text-xs text-ink-muted">
                    {row.time} · {row.user}
                  </div>
                  <p className="mt-1.5 break-words text-ink-muted">{row.summary}</p>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                    <th className="py-2 pr-3">Zeit</th>
                    <th className="py-2 pr-3">Benutzer</th>
                    <th className="py-2 pr-3">Werkzeug</th>
                    <th className="py-2 pr-3">Ergebnis</th>
                    <th className="py-2">Zusammenfassung</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-line align-top">
                      <td className="whitespace-nowrap py-2 pr-3 text-ink-muted">{row.time}</td>
                      <td className="py-2 pr-3">{row.user}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{row.tool}</td>
                      <td className="py-2 pr-3">{row.outcome}</td>
                      <td className="py-2 text-ink-muted">{row.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
