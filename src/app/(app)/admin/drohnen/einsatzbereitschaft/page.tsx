import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canAccessUserManagementAdmin, canManageDroneGroupFor, isBezirksAdmin } from '@/lib/auth/permissions';
import {
  getGruppenEinsatzbereitschaft,
  type EinsatzbereitschaftStatus,
  type GruppenEinsatzbereitschaft,
} from '@/lib/drone/einsatzbereitschaft';
import { NINETY_DAY_REQUIRED_FLIGHTS } from '@/lib/drone/ninety-day-rule';
import { AusbildungTable } from './ausbildung-table';
import { PilotsTable } from './pilots-table';

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
        <h2 className="mb-1 text-[15px] font-semibold text-ink">Ausbildungsstand</h2>
        <p className="mb-3 text-xs text-ink-faint">
          Jedes Mitglied zählt bei der Stufe, auf der es gerade steht (höchste erreichte Stufe) - Einsatzbereit ist,
          wer BOS1 erreicht hat.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div>
            <h3 className="mb-1 text-xs font-medium uppercase tracking-[.06em] text-ink-faint">Nur A1/A3</h3>
            <span className="font-condensed text-2xl font-bold text-ink">{data.ausbildungsstand.nurA1a3}</span>
          </div>
          <div>
            <h3 className="mb-1 text-xs font-medium uppercase tracking-[.06em] text-ink-faint">Nur A2</h3>
            <span className="font-condensed text-2xl font-bold text-ink">{data.ausbildungsstand.nurA2}</span>
          </div>
          <div>
            <h3 className="mb-1 text-xs font-medium uppercase tracking-[.06em] text-ink-faint">Nur Stützpunkt</h3>
            <span className="font-condensed text-2xl font-bold text-ink">{data.ausbildungsstand.nurStuetzpunkt}</span>
          </div>
          <div>
            <h3 className="mb-1 text-xs font-medium uppercase tracking-[.06em] text-ink-faint">Nur BOS1</h3>
            <span className="font-condensed text-2xl font-bold text-success-text">{data.ausbildungsstand.nurBos1}</span>
          </div>
          <div>
            <h3 className="mb-1 text-xs font-medium uppercase tracking-[.06em] text-ink-faint">Nur BOS2</h3>
            <span className="font-condensed text-2xl font-bold text-success-text">{data.ausbildungsstand.nurBos2}</span>
          </div>
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
          <PilotsTable pilots={data.pilots} canLinkToUser={canLinkToUser} />
        )}
      </div>

      <div className="rounded-lg bg-surface p-4 shadow-card">
        <h2 className="mb-1 text-[15px] font-semibold text-ink">Ausbildung · {data.droneGroupName}</h2>
        <p className="mb-3 text-xs text-ink-faint">
          Alle Mitglieder der Gruppe mit dem Datum der jeweils absolvierten Ausbildung ("–" = noch nicht absolviert).
        </p>
        {data.members.length === 0 ? (
          <p className="text-sm text-ink-muted">Diese Gruppe hat noch keine Mitglieder.</p>
        ) : (
          <AusbildungTable members={data.members} canLinkToUser={canLinkToUser} />
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
