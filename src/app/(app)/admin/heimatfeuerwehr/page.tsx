import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canAccessHeimatfeuerwehrAdmin, isSiteAdmin } from '@/lib/auth/permissions';
import { getAdminNavItems } from '@/lib/admin/nav-items';
import { cancelVehicleBooking } from '@/app/(app)/meine-feuerwehr/actions';
import {
  getExpiryStatus,
  getFinnentestExpiryDate,
  type AtemschutzExpiryStatus,
} from '@/lib/heimatfeuerwehr/atemschutz-status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AdminMobileTabs } from '@/components/admin/admin-mobile-tabs';
import { OrgSelect } from './org-select';
import { VehicleFormDialog } from './vehicle-form-dialog';
import { VehicleRowActions } from './vehicle-row-actions';
import { AtemschutzEditDialog } from './atemschutz-edit-dialog';
import { AtemschutzSachbearbeiterForm } from './atemschutz-sachbearbeiter-form';

function toDateInputValue(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : '';
}

function formatBookingRange(startsAt: Date, endsAt: Date): string {
  const day = startsAt.toLocaleDateString('de-AT');
  const start = startsAt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  const end = endsAt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${start}–${end}`;
}

const EXPIRY_BADGE_LABEL: Record<AtemschutzExpiryStatus, string> = {
  aktiv: 'Aktiv',
  laeuft_bald_ab: 'Läuft bald ab',
  abgelaufen: 'Abgelaufen',
  keine_angabe: '–',
};

const EXPIRY_BADGE_CLASS: Record<AtemschutzExpiryStatus, string> = {
  aktiv: 'border-transparent bg-success-subtle text-success-text',
  laeuft_bald_ab: 'border-transparent bg-warning-subtle text-warning-text',
  abgelaufen: 'border-transparent bg-danger-subtle text-danger',
  keine_angabe: 'border-transparent bg-surface-sunken text-ink-faint',
};

function ExpiryBadge({ status }: { status: AtemschutzExpiryStatus }) {
  return (
    <Badge variant="outline" className={EXPIRY_BADGE_CLASS[status]}>
      {EXPIRY_BADGE_LABEL[status]}
    </Badge>
  );
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
  const selectedOrg = allowedOrgs.find((o) => o.id === selectedOrgId)!;

  const [vehicles, members, allBookings] = await Promise.all([
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
    prisma.vehicleBooking.findMany({
      where: { vehicle: { organizationId: selectedOrgId } },
      orderBy: { startsAt: 'desc' },
      include: {
        vehicle: { select: { taktischeBezeichnung: true } },
        user: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[28px] font-bold text-ink">Heimatfeuerwehr</h1>

      <AdminMobileTabs items={getAdminNavItems(user)} />

      {allowedOrgs.length > 1 && <OrgSelect organizations={allowedOrgs} selectedId={selectedOrgId} />}

      <div className="rounded-lg bg-surface p-4 shadow-card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-ink">Fuhrpark</h2>
          <div className="flex items-center gap-3">
            <a
              href={`/admin/heimatfeuerwehr/fuhrpark-export?org=${selectedOrgId}`}
              className="text-sm font-medium text-brand hover:underline"
            >
              Excel Export
            </a>
            <a
              href={`/admin/heimatfeuerwehr/fuhrpark-import?org=${selectedOrgId}`}
              className="text-sm font-medium text-brand hover:underline"
            >
              Excel Import
            </a>
            <VehicleFormDialog mode="create" organizationId={selectedOrgId} trigger={<Button size="sm">Neues Fahrzeug</Button>} />
          </div>
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
                    <VehicleRowActions vehicle={vehicle} />
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
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-ink">Atemschutz</h2>
          <a
            href={`/admin/heimatfeuerwehr/atemschutz-export?org=${selectedOrgId}`}
            className="text-sm font-medium text-brand hover:underline"
          >
            Excel Export
          </a>
        </div>
        <p className="mb-3 text-xs text-ink-faint">
          "Läuft bald ab" bedeutet: Untersuchung oder Finnentest laufen innerhalb der nächsten 30 Tage ab.
        </p>
        <AtemschutzSachbearbeiterForm
          organizationId={selectedOrgId}
          initialEmail={selectedOrg.atemschutzSachbearbeiterEmail ?? ''}
        />
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
              const untersuchungStatus = getExpiryStatus(member.atemschutzGueltigBis);
              const finnentestStatus = getExpiryStatus(getFinnentestExpiryDate(member.atemschutzFinnentestAm));
              return (
                <TableRow key={member.id} className="border-line">
                  <TableCell className="font-medium text-ink">
                    {member.lastName} {member.firstName}
                  </TableCell>
                  <TableCell className="text-ink-muted">{member.istAtemschutzgeraeteTraeger ? 'Ja' : 'Nein'}</TableCell>
                  <TableCell>
                    {member.istAtemschutzgeraeteTraeger ? (
                      <ExpiryBadge status={untersuchungStatus} />
                    ) : (
                      <span className="text-ink-faint">–</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {member.istAtemschutzgeraeteTraeger ? (
                      <ExpiryBadge status={finnentestStatus} />
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

      <div className="rounded-lg bg-surface p-4 shadow-card">
        <h2 className="mb-3 text-[15px] font-semibold text-ink">Fahrzeug-Buchungen</h2>
        <Table>
          <TableHeader>
            <TableRow className="border-b-2 border-line-strong hover:bg-transparent">
              <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">
                Fahrzeug
              </TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">
                Zeitraum
              </TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">
                Gebucht von
              </TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">
                Status
              </TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {allBookings.map((booking) => {
              const past = booking.endsAt.getTime() < Date.now();
              const boundCancel = cancelVehicleBooking.bind(null, booking.id, `/admin/heimatfeuerwehr?org=${selectedOrgId}`);
              return (
                <TableRow key={booking.id} className="border-line">
                  <TableCell className="font-medium text-ink">{booking.vehicle.taktischeBezeichnung}</TableCell>
                  <TableCell className="text-ink-muted">{formatBookingRange(booking.startsAt, booking.endsAt)}</TableCell>
                  <TableCell className="text-ink-muted">
                    {booking.user.firstName} {booking.user.lastName}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        past
                          ? 'border-transparent bg-surface-sunken text-ink-faint'
                          : 'border-transparent bg-success-subtle text-success-text'
                      }
                    >
                      {past ? 'Vergangen' : 'Kommend'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <form action={boundCancel}>
                      <button type="submit" className="text-sm text-danger hover:underline">
                        Löschen
                      </button>
                    </form>
                  </TableCell>
                </TableRow>
              );
            })}
            {allBookings.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-ink-muted">
                  Keine Fahrzeug-Buchungen für diese Feuerwehr.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
