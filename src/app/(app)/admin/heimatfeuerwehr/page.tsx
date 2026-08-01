import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canAccessHeimatfeuerwehrAdmin, isSiteAdmin } from '@/lib/auth/permissions';
import { getAdminNavItems } from '@/lib/admin/nav-items';
import { isFinnentestActive, isUntersuchungActive } from '@/lib/heimatfeuerwehr/atemschutz-status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AdminMobileTabs } from '@/components/admin/admin-mobile-tabs';
import { OrgSelect } from './org-select';
import { VehicleFormDialog } from './vehicle-form-dialog';
import { AtemschutzEditDialog } from './atemschutz-edit-dialog';
import { toggleVehicleActive } from './actions';

function toDateInputValue(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : '';
}

// Admin-Gate läuft in admin/layout.tsx (isSiteAdmin ODER canAccessHeimatfeuerwehrAdmin) - diese
// Seite prüft zusätzlich, ob für die AUSGEWÄHLTE Organisation tatsächlich Rechte bestehen, siehe
// CLAUDE.md "Sicherheits-Härtung".
export default async function HeimatfeuerwehrVerwaltungPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const user = await requireUser();
  if (!canAccessHeimatfeuerwehrAdmin(user)) {
    notFound();
  }

  const { org } = await searchParams;

  const allowedOrgs = isSiteAdmin(user)
    ? await prisma.organization.findMany({ where: { type: 'FEUERWEHR' }, orderBy: { name: 'asc' } })
    : await prisma.organization.findMany({
        where: { id: { in: user.feuerwehrAdminOrgIds } },
        orderBy: { name: 'asc' },
      });

  if (allowedOrgs.length === 0) {
    notFound();
  }

  const selectedOrgId = org && allowedOrgs.some((o) => o.id === org) ? org : allowedOrgs[0].id;

  const [vehicles, members] = await Promise.all([
    prisma.vehicle.findMany({
      where: { organizationId: selectedOrgId },
      orderBy: { taktischeBezeichnung: 'asc' },
    }),
    prisma.user.findMany({
      where: { homeOrganizationId: selectedOrgId, isActive: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        istAtemschutzgeraeteTraeger: true,
        atemschutzUntersuchungAm: true,
        atemschutzGueltigBis: true,
        atemschutzFinnentestAm: true,
      },
    }),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[28px] font-bold text-ink">Heimatfeuerwehr</h1>

      <AdminMobileTabs items={getAdminNavItems(user)} />

      {allowedOrgs.length > 1 && <OrgSelect organizations={allowedOrgs} selectedId={selectedOrgId} />}

      <div className="rounded-lg bg-surface p-4 shadow-card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-ink">Fuhrpark</h2>
          <VehicleFormDialog mode="create" organizationId={selectedOrgId} trigger={<Button size="sm">Neues Fahrzeug</Button>} />
        </div>
        <Table>
          <TableHeader>
            <TableRow className="border-b-2 border-line-strong hover:bg-transparent">
              <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">
                Taktische Bezeichnung
              </TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">
                Kennzeichen
              </TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">
                Marke
              </TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Typ</TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">
                Status
              </TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {vehicles.map((vehicle) => {
              const boundToggle = toggleVehicleActive.bind(null, vehicle.id);
              return (
                <TableRow key={vehicle.id} className="border-line">
                  <TableCell className="font-medium text-ink">{vehicle.taktischeBezeichnung}</TableCell>
                  <TableCell className="text-ink-muted">{vehicle.kennzeichen}</TableCell>
                  <TableCell className="text-ink-muted">{vehicle.marke}</TableCell>
                  <TableCell className="text-ink-muted">{vehicle.typ}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        vehicle.isActive
                          ? 'border-transparent bg-success-subtle text-success-text'
                          : 'border-transparent bg-danger-subtle text-danger'
                      }
                    >
                      {vehicle.isActive ? 'Aktiv' : 'Deaktiviert'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-3">
                      <VehicleFormDialog
                        mode="edit"
                        target={vehicle}
                        trigger={
                          <button type="button" className="text-sm text-brand hover:underline">
                            Bearbeiten
                          </button>
                        }
                      />
                      <form action={boundToggle}>
                        <button type="submit" className="text-sm text-brand hover:underline">
                          {vehicle.isActive ? 'Deaktivieren' : 'Aktivieren'}
                        </button>
                      </form>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {vehicles.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-ink-muted">
                  Noch keine Fahrzeuge angelegt.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="rounded-lg bg-surface p-4 shadow-card">
        <h2 className="mb-3 text-[15px] font-semibold text-ink">Atemschutz</h2>
        <Table>
          <TableHeader>
            <TableRow className="border-b-2 border-line-strong hover:bg-transparent">
              <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Name</TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">
                Atemschutzgeräteträger
              </TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">
                Untersuchung
              </TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">
                Finnentest
              </TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => {
              const untersuchungActive = isUntersuchungActive(member.atemschutzGueltigBis);
              const finnentestActive = isFinnentestActive(member.atemschutzFinnentestAm);
              return (
                <TableRow key={member.id} className="border-line">
                  <TableCell className="font-medium text-ink">
                    {member.lastName} {member.firstName}
                  </TableCell>
                  <TableCell className="text-ink-muted">{member.istAtemschutzgeraeteTraeger ? 'Ja' : 'Nein'}</TableCell>
                  <TableCell>
                    {member.istAtemschutzgeraeteTraeger ? (
                      <Badge
                        variant="outline"
                        className={
                          untersuchungActive
                            ? 'border-transparent bg-success-subtle text-success-text'
                            : 'border-transparent bg-danger-subtle text-danger'
                        }
                      >
                        {untersuchungActive ? 'Aktiv' : 'Abgelaufen'}
                      </Badge>
                    ) : (
                      <span className="text-ink-faint">–</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {member.istAtemschutzgeraeteTraeger ? (
                      <Badge
                        variant="outline"
                        className={
                          finnentestActive
                            ? 'border-transparent bg-success-subtle text-success-text'
                            : 'border-transparent bg-danger-subtle text-danger'
                        }
                      >
                        {finnentestActive ? 'Aktiv' : 'Abgelaufen'}
                      </Badge>
                    ) : (
                      <span className="text-ink-faint">–</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <AtemschutzEditDialog
                      target={{
                        userId: member.id,
                        name: `${member.firstName} ${member.lastName}`,
                        istAtemschutzgeraeteTraeger: member.istAtemschutzgeraeteTraeger,
                        atemschutzUntersuchungAm: toDateInputValue(member.atemschutzUntersuchungAm),
                        atemschutzGueltigBis: toDateInputValue(member.atemschutzGueltigBis),
                        atemschutzFinnentestAm: toDateInputValue(member.atemschutzFinnentestAm),
                      }}
                      trigger={
                        <button type="button" className="text-sm text-brand hover:underline">
                          Bearbeiten
                        </button>
                      }
                    />
                  </TableCell>
                </TableRow>
              );
            })}
            {members.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-ink-muted">
                  Keine Mitglieder in dieser Feuerwehr.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
