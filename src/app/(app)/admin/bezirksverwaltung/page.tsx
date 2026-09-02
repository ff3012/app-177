import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canAccessBezirksverwaltung, canManageDrohnengruppenBezirksweit, canManageFeuerwehrenBezirksweit } from '@/lib/auth/permissions';
import { getAdminNavItems } from '@/lib/admin/nav-items';
import { getReachableScopes } from '@/lib/admin/scope';
import { GeltungsbereichSelector } from '@/components/admin/geltungsbereich-selector';
import { AdminMobileTabs } from '@/components/admin/admin-mobile-tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { FeuerwehrenTable, type FeuerwehrRow } from './feuerwehren-table';
import { RenameDroneGroupForm } from './rename-drone-group-form';
import { AddDroneGroupForm } from './add-drone-group-form';
import { DeleteDroneGroupButton } from './delete-drone-group-button';
import { toggleDroneGroupActive } from './actions';

export default async function BezirksverwaltungPage() {
  const user = await requireUser();
  if (!canAccessBezirksverwaltung(user)) {
    notFound();
  }
  const reachableScopes = await getReachableScopes(user);
  const showFeuerwehren = canManageFeuerwehrenBezirksweit(user);
  const showDrohnengruppen = canManageDrohnengruppenBezirksweit(user);

  const abschnitte = await prisma.organization.findMany({
    where: { type: 'ABSCHNITTSKOMMANDO' },
    select: { id: true, name: true, shortName: true },
    orderBy: { name: 'asc' },
  });
  const abschnittOptions = abschnitte.map((a) => ({ id: a.id, name: a.shortName ?? a.name }));
  const abschnittNameById = new Map(abschnittOptions.map((a) => [a.id, a.name]));

  const [feuerwehren, droneGroups, bezirksadmins] = await Promise.all([
    showFeuerwehren
      ? prisma.organization.findMany({
          where: { type: 'FEUERWEHR' },
          select: { id: true, name: true, shortName: true, nummer: true, parentId: true, isActive: true, feuerwehrKategorie: true },
          orderBy: { name: 'asc' },
        })
      : Promise.resolve([]),
    showDrohnengruppen
      ? prisma.droneGroup.findMany({
          select: { id: true, name: true, organizationId: true, isActive: true },
          orderBy: { name: 'asc' },
        })
      : Promise.resolve([]),
    showFeuerwehren
      ? prisma.user.findMany({
          where: { isBezirksAdmin: true },
          select: { id: true, firstName: true, lastName: true, email: true, homeOrganization: { select: { name: true, shortName: true } } },
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        })
      : Promise.resolve([]),
  ]);

  const feuerwehrRows: FeuerwehrRow[] = feuerwehren.map((f) => ({
    id: f.id,
    name: f.name,
    shortName: f.shortName,
    nummer: f.nummer,
    abschnittName: abschnittNameById.get(f.parentId ?? '') ?? '–',
    isActive: f.isActive,
    feuerwehrKategorie: f.feuerwehrKategorie,
  }));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[28px] font-bold text-ink">Bezirksverwaltung</h1>

      <div className="md:hidden">
        <GeltungsbereichSelector reachable={reachableScopes} />
      </div>
      <AdminMobileTabs items={getAdminNavItems(user)} />

      {showFeuerwehren && (
        <div className="rounded-lg bg-surface p-4 shadow-card">
          <h2 className="mb-3 text-[15px] font-semibold text-ink">Feuerwehren</h2>
          <FeuerwehrenTable feuerwehren={feuerwehrRows} abschnitte={abschnittOptions} />
        </div>
      )}

      {showDrohnengruppen && (
        <div className="rounded-lg bg-surface p-4 shadow-card">
          <h2 className="mb-3 text-[15px] font-semibold text-ink">Drohnengruppen</h2>
          <Table>
            <TableHeader>
              <TableRow className="border-b-2 border-line-strong hover:bg-transparent">
                <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Name</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Anker-Abschnitt</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {droneGroups.map((group) => {
                const boundToggle = toggleDroneGroupActive.bind(null, group.id);
                return (
                  <TableRow key={group.id} className="border-line">
                    <TableCell>
                      <RenameDroneGroupForm droneGroupId={group.id} currentName={group.name} />
                    </TableCell>
                    <TableCell className="text-ink-muted">{abschnittNameById.get(group.organizationId) ?? '–'}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={group.isActive ? 'border-transparent bg-success-subtle text-success-text' : 'border-transparent bg-danger-subtle text-danger'}
                      >
                        {group.isActive ? 'Aktiv' : 'Deaktiviert'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="inline-flex items-center gap-3">
                        <form action={boundToggle}>
                          <button type="submit" className="text-sm text-brand hover:underline">
                            {group.isActive ? 'Deaktivieren' : 'Reaktivieren'}
                          </button>
                        </form>
                        {!group.isActive && <DeleteDroneGroupButton droneGroupId={group.id} name={group.name} />}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
              {droneGroups.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-ink-muted">
                    Noch keine Drohnengruppe angelegt.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <div className="mt-3">
            <AddDroneGroupForm abschnitte={abschnittOptions} />
          </div>
        </div>
      )}

      {showFeuerwehren && (
        <div className="rounded-lg bg-surface p-4 shadow-card">
          <h2 className="mb-1 text-[15px] font-semibold text-ink">Bezirksadmins</h2>
          <p className="mb-3 text-xs text-ink-faint">Nur sichtbar - Verwaltung erfolgt über die Benutzerverwaltung.</p>
          <Table>
            <TableHeader>
              <TableRow className="border-b-2 border-line-strong hover:bg-transparent">
                <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Name</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">E-Mail</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Heimatfeuerwehr</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bezirksadmins.map((admin) => (
                <TableRow key={admin.id} className="border-line">
                  <TableCell className="text-ink">
                    {admin.lastName} {admin.firstName}
                  </TableCell>
                  <TableCell className="text-ink-muted">{admin.email}</TableCell>
                  <TableCell className="text-ink-muted">{admin.homeOrganization.shortName ?? admin.homeOrganization.name}</TableCell>
                </TableRow>
              ))}
              {bezirksadmins.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-ink-muted">
                    Keine Bezirksadmins gefunden.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
