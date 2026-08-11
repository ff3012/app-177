import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canAccessUserManagementAdmin, canManageDroneGroupFor, isBezirksAdmin } from '@/lib/auth/permissions';
import {
  getGruppenEinsatzbereitschaft,
  type EinsatzbereitschaftStatus,
  type GruppenEinsatzbereitschaft,
  type PilotEinsatzbereitschaft,
} from '@/lib/drone/einsatzbereitschaft';
import { NINETY_DAY_REQUIRED_FLIGHTS } from '@/lib/drone/ninety-day-rule';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const STATUS_LABEL: Record<EinsatzbereitschaftStatus, string> = {
  GRUEN: 'Einsatzbereit',
  GELB: 'Bald fällig',
  ROT: 'Nicht einsatzbereit',
};

const STATUS_CLASS: Record<EinsatzbereitschaftStatus, string> = {
  GRUEN: 'border-transparent bg-success-subtle text-success-text',
  GELB: 'border-transparent bg-warning-subtle text-warning-text',
  ROT: 'border-transparent bg-danger-subtle text-danger',
};

const STATUS_COUNT_CLASS: Record<EinsatzbereitschaftStatus, string> = {
  GRUEN: 'text-success-text',
  GELB: 'text-warning-text',
  ROT: 'text-danger',
};

function countByStatus(data: GruppenEinsatzbereitschaft, status: EinsatzbereitschaftStatus): number {
  return data.pilots.filter((p) => p.status === status).length;
}

function GroupTile({ data, selected }: { data: GruppenEinsatzbereitschaft; selected: boolean }) {
  return (
    <Link
      href={`/admin/drohnen/einsatzbereitschaft?group=${data.droneGroupId}`}
      className={`flex flex-col gap-2 rounded-lg border p-4 shadow-card transition-colors ${
        selected ? 'border-brand bg-surface' : 'border-transparent bg-surface hover:border-line'
      }`}
    >
      <span className="text-[15px] font-semibold text-ink">{data.droneGroupName}</span>
      <span className="text-xs text-ink-muted">
        {data.totalMembers} Mitglieder · {data.a2Count} mit A2
      </span>
      <span className="font-mono text-sm" title="Einsatzbereit / Bald fällig / Nicht einsatzbereit">
        <span className={STATUS_COUNT_CLASS.GRUEN}>{countByStatus(data, 'GRUEN')}</span>
        {' · '}
        <span className={STATUS_COUNT_CLASS.GELB}>{countByStatus(data, 'GELB')}</span>
        {' · '}
        <span className={STATUS_COUNT_CLASS.ROT}>{countByStatus(data, 'ROT')}</span>
      </span>
    </Link>
  );
}

function PilotName({ pilot, canLinkToUser }: { pilot: PilotEinsatzbereitschaft; canLinkToUser: boolean }) {
  if (!canLinkToUser) return <>{pilot.name}</>;
  return (
    <Link href={`/admin/benutzer?edit=${pilot.id}`} className="hover:underline">
      {pilot.name}
    </Link>
  );
}

function DetailSection({ data, canLinkToUser }: { data: GruppenEinsatzbereitschaft; canLinkToUser: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg bg-surface p-4 shadow-card">
          <h2 className="mb-1 text-[15px] font-semibold text-ink">Mitglieder gesamt</h2>
          <span className="font-condensed text-3xl font-bold text-ink">{data.totalMembers}</span>
        </div>
        <div className="rounded-lg bg-surface p-4 shadow-card">
          <h2 className="mb-1 text-[15px] font-semibold text-ink">Mit A2-Zertifikat</h2>
          <span className="font-condensed text-3xl font-bold text-ink">{data.a2Count}</span>
        </div>
      </div>

      <div className="rounded-lg bg-surface p-4 shadow-card">
        <h2 className="mb-1 text-[15px] font-semibold text-ink">Einsatzbereitschaft · {data.droneGroupName}</h2>
        <p className="mb-3 text-xs text-ink-faint">
          Nur Mitglieder mit abgeschlossener BOS1-Ausbildung. Mindestens {NINETY_DAY_REQUIRED_FLIGHTS} Flüge in den
          letzten 90 Tagen für Einsatzbereitschaft.
        </p>

        {data.pilots.length === 0 ? (
          <p className="text-sm text-ink-muted">Kein Mitglied dieser Gruppe hat bisher eine BOS1-Ausbildung.</p>
        ) : (
          <>
            <div className="flex flex-col divide-y divide-line border-t border-line sm:hidden">
              {data.pilots.map((pilot) => (
                <div key={pilot.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="flex flex-col">
                    <span className="text-sm text-ink">
                      <PilotName pilot={pilot} canLinkToUser={canLinkToUser} />
                    </span>
                    <span className="text-xs text-ink-faint">{pilot.flightCount} Flüge (90 Tage)</span>
                  </div>
                  <Badge variant="outline" className={STATUS_CLASS[pilot.status]}>
                    {STATUS_LABEL[pilot.status]}
                  </Badge>
                </div>
              ))}
            </div>

            <div className="hidden sm:block">
              <Table>
                <TableHeader>
                  <TableRow className="border-b-2 border-line-strong hover:bg-transparent">
                    <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Name</TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">
                      Flüge (90 Tage)
                    </TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">
                      Status
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.pilots.map((pilot) => (
                    <TableRow key={pilot.id} className="border-line">
                      <TableCell className="text-ink">
                        <PilotName pilot={pilot} canLinkToUser={canLinkToUser} />
                      </TableCell>
                      <TableCell className="font-mono text-ink-muted">{pilot.flightCount}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={STATUS_CLASS[pilot.status]}>
                          {STATUS_LABEL[pilot.status]}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default async function EinsatzbereitschaftPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string }>;
}) {
  const user = await requireUser();
  const { group } = await searchParams;

  const allGroups = await prisma.droneGroup.findMany({ orderBy: { name: 'asc' } });
  const allowedGroups = isBezirksAdmin(user) ? allGroups : allGroups.filter((g) => canManageDroneGroupFor(user, g));

  if (allowedGroups.length === 0) {
    notFound();
  }

  const selectedGroup = (group && allowedGroups.find((g) => g.id === group)) || allowedGroups[0];

  const showTiles = allowedGroups.length > 1;
  const tileData = showTiles
    ? await Promise.all(allowedGroups.map((g) => getGruppenEinsatzbereitschaft(g.id)))
    : [];
  const selectedData = showTiles
    ? tileData.find((d) => d.droneGroupId === selectedGroup.id)!
    : await getGruppenEinsatzbereitschaft(selectedGroup.id);

  const canLinkToUser = canAccessUserManagementAdmin(user);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href={`/admin/drohnen?group=${selectedGroup.id}`} className="text-sm text-brand hover:underline">
          ← Zurück zur Drohnengruppe-Verwaltung
        </Link>
        <h1 className="mt-1 text-[28px] font-bold text-ink">Einsatzbereitschaft</h1>
      </div>

      {showTiles && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {tileData.map((data) => (
            <GroupTile key={data.droneGroupId} data={data} selected={data.droneGroupId === selectedGroup.id} />
          ))}
        </div>
      )}

      <DetailSection data={selectedData} canLinkToUser={canLinkToUser} />
    </div>
  );
}
