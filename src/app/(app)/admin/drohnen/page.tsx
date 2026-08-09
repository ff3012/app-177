import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManageDroneGroupFor, isBezirksAdmin } from '@/lib/auth/permissions';
import { CopyLinkButton } from '@/components/ui/copy-link-button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AdminMobileTabs } from '@/components/admin/admin-mobile-tabs';
import { getAdminNavItems } from '@/lib/admin/nav-items';
import { listDrohnengruppeMembers } from '@/lib/drone/members';
import { getNinetyDayCutoff, meetsNinetyDayRule } from '@/lib/drone/ninety-day-rule';
import { GroupSelect } from './group-select';
import { AddDroneForm } from './add-drone-form';
import { RenameDroneForm } from './rename-drone-form';
import { UploadDocumentForm } from './upload-document-form';
import { DroneGroupEmailForm } from './drone-group-email-form';
import { createDrone, toggleDroneActive, regenerateQuickRegisterLink, uploadDroneDocument, deleteDroneDocument } from './actions';

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function baseUrl(): string {
  return process.env.AUTH_URL?.replace(/\/$/, '') ?? '';
}

// admin/layout.tsx's Gate deckt (seit "Heimatfeuerwehr") auch reine Feuerwehr-/Abschnitt-Admins ab -
// diese Seite braucht deshalb keine eigene pauschale isSiteAdmin-Sperre mehr (anders als
// benutzer/email/status): der Zugriff ist jetzt PRO GRUPPE über canManageDroneGroupFor geregelt
// (Bezirksadmin, Admin des Abschnitts, an dem die Gruppe verankert ist, oder Admin dieser
// Drohnengruppe selbst) - wer für KEINE einzige Gruppe berechtigt ist, bekommt notFound().
export default async function DrohnenVerwaltungPage({
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
  const canSeeMembers = true; // wer diese Seite für eine Gruppe sieht, darf deren Compliance-Daten sehen

  const [drones, documents, members, flightCounts] = await Promise.all([
    prisma.drone.findMany({ where: { droneGroupId: selectedGroup.id }, orderBy: { sortOrder: 'asc' } }),
    prisma.droneDocument.findMany({
      where: { droneGroupId: selectedGroup.id },
      select: {
        id: true,
        title: true,
        filename: true,
        sizeBytes: true,
        createdAt: true,
        uploadedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    listDrohnengruppeMembers(selectedGroup.id),
    prisma.droneFlight.groupBy({
      by: ['pilotUserId'],
      where: { startsAt: { gte: getNinetyDayCutoff() }, pilotUser: { droneMembership: { droneGroupId: selectedGroup.id } } },
      _count: { _all: true },
    }),
  ]);
  const quickRegisterLink = selectedGroup.qrToken ? `${baseUrl()}/drohnen-schnell/${selectedGroup.qrToken}` : null;
  const countByPilot = new Map(flightCounts.map((c) => [c.pilotUserId, c._count._all]));

  const boundRegenerateLink = regenerateQuickRegisterLink.bind(null, selectedGroup.id);
  const boundCreateDrone = createDrone.bind(null, selectedGroup.id);
  const boundUploadDocument = uploadDroneDocument.bind(null, selectedGroup.id);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[28px] font-bold text-ink">Drohnengruppe</h1>

      <AdminMobileTabs items={getAdminNavItems(user)} />

      {allowedGroups.length > 1 && (
        <GroupSelect groups={allowedGroups.map((g) => ({ id: g.id, name: g.name }))} selectedId={selectedGroup.id} />
      )}

      {canSeeMembers && (
        <div className="rounded-lg bg-surface p-4 shadow-card">
          <h2 className="mb-1 text-[15px] font-semibold text-ink">Mitglieder · 90-Tage-Status</h2>
          <p className="mb-3 text-xs text-ink-faint">
            Mindestens 3 Flüge in den letzten 90 Tagen. Rolle/Mitgliedschaft ändern über die{' '}
            <Link href="/admin/benutzer" className="text-brand hover:underline">
              Benutzerverwaltung
            </Link>
            .
          </p>
          <Table>
            <TableHeader>
              <TableRow className="border-b-2 border-line-strong hover:bg-transparent">
                <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Name</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">
                  Flüge (90 Tage)
                </TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => {
                const count = countByPilot.get(member.id) ?? 0;
                const met = meetsNinetyDayRule(count);
                return (
                  <TableRow key={member.id} className="border-line">
                    <TableCell>
                      <Link href={`/admin/benutzer?edit=${member.id}`} className="text-ink hover:underline">
                        {member.lastName} {member.firstName}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-ink-muted">{count}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          met
                            ? 'border-transparent bg-success-subtle text-success-text'
                            : 'border-transparent bg-danger-subtle text-danger'
                        }
                      >
                        {met ? 'Erfüllt' : 'Offen'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
              {members.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-ink-muted">
                    Keine Mitglieder dieser Drohnengruppe hinterlegt.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="rounded-lg bg-surface p-4 shadow-card">
        <h2 className="mb-3 text-[15px] font-semibold text-ink">Drohnen</h2>
        <Table>
          <TableHeader>
            <TableRow className="border-b-2 border-line-strong hover:bg-transparent">
              <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Name</TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {drones.map((drone) => {
              const boundToggle = toggleDroneActive.bind(null, drone.id);
              return (
                <TableRow key={drone.id} className="border-line">
                  <TableCell>
                    <RenameDroneForm droneId={drone.id} currentName={drone.name} />
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        drone.isActive
                          ? 'border-transparent bg-success-subtle text-success-text'
                          : 'border-transparent bg-danger-subtle text-danger'
                      }
                    >
                      {drone.isActive ? 'Aktiv' : 'Deaktiviert'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <form action={boundToggle}>
                      <button type="submit" className="text-sm text-brand hover:underline">
                        {drone.isActive ? 'Deaktivieren' : 'Aktivieren'}
                      </button>
                    </form>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div className="mt-3">
          <AddDroneForm action={boundCreateDrone} />
        </div>
      </div>

      <div className="rounded-lg bg-surface p-4 shadow-card">
        <h2 className="mb-1 text-[15px] font-semibold text-ink">QR-Code Schnellerfassung</h2>
        <p className="mb-3 text-sm text-ink-muted">
          Dieser Link führt ohne Anmeldung direkt zum Formular „Flug registrieren" für die Gruppe „{selectedGroup.name}"
          – gedacht, um ihn als QR-Code auszudrucken. Wer den Link/QR-Code kennt, kann damit ausschließlich neue Flüge
          für diese Gruppe anlegen; andere Daten sind darüber nicht einsehbar. Ein neu erzeugter Link macht den alten
          QR-Code sofort ungültig.
        </p>

        {quickRegisterLink && (
          <div className="mb-3 flex items-start gap-2">
            <p className="flex-1 break-all rounded-md border border-line bg-surface-sunken px-3 py-2 text-sm text-ink">
              {quickRegisterLink}
            </p>
            <CopyLinkButton text={quickRegisterLink} />
          </div>
        )}

        <form action={boundRegenerateLink}>
          <button type="submit" className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover">
            {quickRegisterLink ? 'Link neu erzeugen' : 'Link erzeugen'}
          </button>
        </form>
      </div>

      <div className="rounded-lg bg-surface p-4 shadow-card">
        <h2 className="mb-1 text-[15px] font-semibold text-ink">Benachrichtigung</h2>
        <p className="mb-3 text-sm text-ink-muted">
          Empfängeradresse für die Benachrichtigung bei jedem neu registrierten Flug dieser Gruppe.
        </p>
        <DroneGroupEmailForm droneGroupId={selectedGroup.id} initialEmail={selectedGroup.flightNotificationEmail ?? ''} />
      </div>

      <div className="rounded-lg bg-surface p-4 shadow-card">
        <h2 className="mb-1 text-[15px] font-semibold text-ink">Unterlagen für Mitglieder</h2>
        <p className="mb-3 text-sm text-ink-muted">
          PDFs, die für alle Mitglieder der Gruppe „{selectedGroup.name}" unter „Unterlagen" zum Download bereitstehen.
        </p>

        <UploadDocumentForm action={boundUploadDocument} />

        {documents.length > 0 && (
          <ul className="mt-4 flex flex-col divide-y divide-line border-t border-line">
            {documents.map((doc) => {
              const boundDelete = deleteDroneDocument.bind(null, doc.id);
              return (
                <li key={doc.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div>
                    <p className="font-medium text-ink">{doc.title}</p>
                    <p className="text-xs text-ink-faint">
                      {doc.filename} · {formatBytes(doc.sizeBytes)} · {doc.uploadedBy.firstName} {doc.uploadedBy.lastName} ·{' '}
                      {doc.createdAt.toLocaleDateString('de-AT')}
                    </p>
                  </div>
                  <form action={boundDelete}>
                    <button type="submit" className="shrink-0 text-danger hover:underline">
                      Löschen
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
