import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ChecklistStatus } from '@prisma/client';
import { requireUser } from '@/lib/auth/session';
import { canManageChecklists } from '@/lib/auth/permissions';
import { getAllowedDroneGroups } from '@/lib/drone/flightbook-groups';
import { checklistCounts, listChecklistsAdmin, type AdminChecklistItem } from '@/lib/drone/checklist/queries';
import { TOTAL_STEPS } from '@/lib/drone/checklist/labels';
import { viennaDateParts } from '@/lib/drone/checklist/columns';
import { AdminMobileTabs } from '@/components/admin/admin-mobile-tabs';
import { getAdminNavItems } from '@/lib/admin/nav-items';
import { resendChecklistMailAction } from '@/app/(app)/drohnen/checkliste/actions';

const PAGE_SIZE = 25;
const STATUS_FILTERS: { key: string; label: string; status?: ChecklistStatus }[] = [
  { key: 'alle', label: 'Alle' },
  { key: 'entwuerfe', label: 'Entwürfe', status: 'DRAFT' },
  { key: 'abgeschlossen', label: 'Abgeschlossen', status: 'SUBMITTED' },
  { key: 'verworfen', label: 'Verworfen', status: 'DISCARDED' },
];

const BADGE: Record<ChecklistStatus, { label: string; className: string }> = {
  DRAFT: { label: 'Entwurf', className: 'bg-amber-100 text-amber-900' },
  SUBMITTED: { label: 'Abgeschlossen', className: 'bg-green-100 text-green-900' },
  DISCARDED: { label: 'Verworfen', className: 'bg-neutral-200 text-neutral-700' },
};

const fmtDate = (d: Date) => {
  const { datum, zeit } = viennaDateParts(d);
  const [y, m, day] = datum.split('-');
  return `${day}.${m}.${y} ${zeit}`;
};

function stand(item: AdminChecklistItem): { text: string; error: boolean } {
  const flights = item.linkedFlights > 0 ? ` · ${item.linkedFlights} ${item.linkedFlights === 1 ? 'Flug' : 'Flüge'} verknüpft` : '';
  if (item.status === 'DRAFT') return { text: `Schritt ${item.step + 1} von ${TOTAL_STEPS} · gespeichert ${fmtDate(item.updatedAt)}${flights}`, error: false };
  if (item.status === 'DISCARDED') return { text: `verworfen ${item.discardedAt ? fmtDate(item.discardedAt) : ''}${flights}`, error: false };
  if (item.mailedAt) return { text: `✉ gesendet an ${item.mailedTo ?? '-'} · ${fmtDate(item.mailedAt)}${flights}`, error: false };
  if (item.mailError?.startsWith('Testbetrieb')) return { text: `${item.mailError}${flights}`, error: false };
  if (item.mailError) return { text: `Versand fehlgeschlagen: ${item.mailError}${flights}`, error: true };
  return { text: `Versand ausstehend${flights}`, error: false };
}

export default async function ChecklistenVerwaltungPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string; status?: string; page?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const allowedGroups = await getAllowedDroneGroups(user);
  const group = allowedGroups.find((g) => g.id === params.group) ?? allowedGroups[0];
  if (!group || !group.featureChecklist || !canManageChecklists(user, group)) notFound();

  const filter = STATUS_FILTERS.find((f) => f.key === params.status) ?? STATUS_FILTERS[0];
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);
  const [counts, { items, total }] = await Promise.all([
    checklistCounts(group.id),
    listChecklistsAdmin(group.id, { status: filter.status, page, pageSize: PAGE_SIZE }),
  ]);
  const totalAll = counts.drafts + counts.submitted + counts.discarded;
  const chipCount: Record<string, number> = { alle: totalAll, entwuerfe: counts.drafts, abgeschlossen: counts.submitted, verworfen: counts.discarded };
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (extra: Record<string, string>) =>
    `/admin/drohnen/checklisten?${new URLSearchParams({ group: group.id, status: filter.key, ...extra }).toString()}`;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href={`/admin/drohnen?group=${group.id}`} className="text-sm text-brand hover:underline">
          ‹ Drohnengruppe
        </Link>
        <h1 className="text-[28px] font-bold text-ink">Checklisten</h1>
        <p className="text-[15px] text-ink-muted">
          {group.name} · {totalAll} {totalAll === 1 ? 'Checkliste' : 'Checklisten'} gespeichert
        </p>
      </div>
      <AdminMobileTabs items={getAdminNavItems(user)} />

      <div className="flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/admin/drohnen/checklisten?${new URLSearchParams({ group: group.id, status: f.key }).toString()}`}
            className={`rounded-full px-3.5 py-2 text-sm font-semibold ${f.key === filter.key ? 'bg-ink text-white' : 'bg-surface-sunken text-ink-muted'}`}
          >
            {f.label} {chipCount[f.key]}
          </Link>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg bg-surface p-6 text-center text-sm text-ink-muted shadow-card">Keine Checklisten in dieser Ansicht.</div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {items.map((item) => {
            const s = stand(item);
            const resend = resendChecklistMailAction.bind(null, item.id);
            return (
              <li key={item.id} className="flex flex-col gap-2 rounded-lg bg-surface p-4 shadow-card sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${BADGE[item.status].className}`}>{BADGE[item.status].label}</span>
                    <span className="font-mono text-xs text-ink-muted">{fmtDate(item.flightAt)}</span>
                  </div>
                  <div className="truncate text-[15px] font-semibold text-ink">{item.title}</div>
                  <div className="truncate text-xs text-ink-muted">Pilot {item.pilotName}</div>
                  <div className={`text-xs ${s.error ? 'font-semibold text-danger' : 'text-ink-muted'}`}>{s.text}</div>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-sm">
                  {item.status === 'SUBMITTED' && (
                    <>
                      <a href={`/drohnen/checkliste/${item.id}/pdf`} className="font-semibold text-brand hover:underline">
                        PDF
                      </a>
                      <form action={resend}>
                        <button type="submit" className="font-semibold text-brand hover:underline">
                          Erneut senden
                        </button>
                      </form>
                    </>
                  )}
                  {item.status === 'DRAFT' && (
                    <Link href={`/drohnen/checkliste/${item.id}`} className="font-semibold text-brand hover:underline">
                      {item.createdById === user.id ? 'Fortsetzen' : 'Ansehen'}
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-ink-muted">
          {page > 1 ? (
            <Link href={href({ page: String(page - 1) })} className="font-semibold text-brand hover:underline">
              ‹ Zurück
            </Link>
          ) : (
            <span />
          )}
          <span>
            Seite {page} von {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={href({ page: String(page + 1) })} className="font-semibold text-brand hover:underline">
              Weiter ›
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}
