import { prisma } from '@/lib/db/prisma';
import { putReportPdf } from '@/lib/storage/report-pdf-s3';
import { checklistDataSchema, type ChecklistData } from './data';
import {
  buildChecklistMail,
  checklistMailSubject,
  checklistPdfFileName,
  resolveMailRecipients,
  sendChecklistMails,
} from './mail';
import { generateChecklistPdf, type ChecklistPdfData } from './pdf';


function fullName(user: { firstName: string; lastName: string } | undefined | null): string | null {
  return user ? `${user.firstName} ${user.lastName}` : null;
}

/** Lädt eine Checkliste samt aufgelösten Namen für PDF und Mail - null, wenn es sie nicht gibt. */
export async function loadChecklistPdfData(id: string): Promise<ChecklistPdfData | null> {
  const checklist = await prisma.droneChecklist.findUnique({
    where: { id },
    include: {
      droneGroup: { select: { name: true } },
      drones: { include: { drone: { select: { name: true } } } },
      submittedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (!checklist) return null;

  const parsed = checklistDataSchema.safeParse(checklist.data);
  const data: ChecklistData = parsed.success ? parsed.data : {};
  const userIds = [...new Set([data.pilot, data.teamleiter, data.abschnittsleiter, ...(data.helfer ?? []), ...(data.pilotWechsel ?? []).map((w) => w.pilot)].filter((v): v is string => !!v))];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } })
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  const nameOf = (userId: string | undefined) => (userId ? fullName(byId.get(userId)) : null);

  const confirmedBy =
    data.bestaetigt && checklist.submittedBy
      ? { name: fullName(checklist.submittedBy)!, forPilot: checklist.submittedBy.id !== data.pilot }
      : null;

  return {
    id: checklist.id,
    groupName: checklist.droneGroup.name,
    flightAt: checklist.flightAt,
    data,
    pilotName: nameOf(data.pilot),
    teamleiterName: nameOf(data.teamleiter),
    abschnittsleiterName: nameOf(data.abschnittsleiter),
    wechselPilotNames: (data.pilotWechsel ?? []).map((w) => nameOf(w.pilot)),
    helferNames: (data.helfer ?? []).map((helperId) => nameOf(helperId)).filter((n): n is string => !!n),
    droneNames: checklist.drones.map((row) => row.drone.name).sort(),
    submittedAt: checklist.submittedAt,
    confirmedBy,
  };
}

export type DeliveryOutcome = 'sent' | 'logged' | 'failed' | 'no-recipients' | 'not-submitted' | 'not-found';

export interface DeliveryResult {
  outcome: DeliveryOutcome;
}

interface DeliveryDeps {
  send?: Parameters<typeof sendChecklistMails>[2];
  baseUrl?: string;
}

/** Speicherort des archivierten PDFs. Eigenes Präfix im Berichte-Bucket - der 14-Tage-Cron für
 * Tätigkeitsberichte löscht nur Schlüssel, die er selbst aus Report-Zeilen berechnet, und trifft dieses
 * Präfix daher nie. */
export function checklistPdfStorageKey(droneGroupId: string, checklistId: string): string {
  return `checklisten/${droneGroupId}/${checklistId}.pdf`;
}

/**
 * Erzeugt das PDF, legt es best-effort im Speicher ab und versendet die Benachrichtigungs-Mails an die
 * AKTUELL hinterlegten Adressen der Gruppe. Läuft nach dem Commit des Abgebens und nach "Erneut senden";
 * wirft nie - jedes Ergebnis landet in mailedTo/mailedAt/mailError, der Status bleibt SUBMITTED.
 */
export async function deliverChecklist(id: string, deps: DeliveryDeps = {}): Promise<DeliveryResult> {
  try {
    const checklist = await prisma.droneChecklist.findUnique({
      where: { id },
      include: { droneGroup: { select: { id: true, flightNotificationEmails: true } } },
    });
    if (!checklist) return { outcome: 'not-found' };
    if (checklist.status !== 'SUBMITTED') return { outcome: 'not-submitted' };

    const recipients = resolveMailRecipients(checklist.droneGroup.flightNotificationEmails);
    if (recipients.length === 0) {
      await prisma.droneChecklist.update({
        where: { id },
        data: { mailedTo: null, mailedAt: null, mailError: 'Keine Benachrichtigungs-Adresse' },
      });
      return { outcome: 'no-recipients' };
    }

    const pdfData = await loadChecklistPdfData(id);
    if (!pdfData) return { outcome: 'not-found' };
    const pdf = await generateChecklistPdf(pdfData);
    const fileName = checklistPdfFileName(checklist.flightAt, checklist.area);

    // Archivierung ist best-effort: ohne S3-Konfiguration (lokale Entwicklung) fehlt nur pdfKey, das PDF
    // lässt sich jederzeit aus den gespeicherten Daten neu erzeugen.
    try {
      const key = checklistPdfStorageKey(checklist.droneGroupId, id);
      await putReportPdf(key, pdf);
      await prisma.droneChecklist.update({ where: { id }, data: { pdfKey: key } });
    } catch (error) {
      console.error(`Checkliste ${id}: PDF konnte nicht archiviert werden:`, error instanceof Error ? error.message : error);
    }

    const d = pdfData.data;
    const openComments = [
      d.kommentar15?.trim() ? { label: 'Vorflugkontrolle Nr. 15–16', comment: d.kommentar15.trim() } : null,
      d.kommentar17?.trim() ? { label: 'Betriebskontrolle Nr. 17', comment: d.kommentar17.trim() } : null,
    ].filter((v): v is { label: string; comment: string } => v !== null);
    const baseUrl = (deps.baseUrl ?? process.env.AUTH_URL ?? '').replace(/\/$/, '');
    const { text, html } = buildChecklistMail({
      groupName: pdfData.groupName,
      pilotName: pdfData.pilotName ?? '-',
      droneNames: pdfData.droneNames,
      grundlage: d.grundlage,
      openKat: d.openKat,
      bescheid: d.bescheid,
      hoehe: d.hoehe,
      flightCount: d.fluege?.length ?? 0,
      openComments,
      link: `${baseUrl}/drohnen/checkliste/${id}/fertig`,
    });

    const result = await sendChecklistMails(
      recipients,
      { subject: checklistMailSubject(checklist), text, html, fileName, pdf },
      deps.send,
    );

    if (result.mode === 'log') {
      await prisma.droneChecklist.update({
        where: { id },
        data: { mailedTo: recipients.join(', '), mailedAt: null, mailError: 'Testbetrieb (MAIL_MODE=log): nicht versendet' },
      });
      return { outcome: 'logged' };
    }
    if (result.failed > 0) {
      await prisma.droneChecklist.update({
        where: { id },
        data: {
          mailedTo: result.sentTo.length ? result.sentTo.join(', ') : null,
          mailedAt: null,
          mailError: `${result.failed} von ${result.attempted} E-Mails fehlgeschlagen`,
        },
      });
      return { outcome: 'failed' };
    }
    await prisma.droneChecklist.update({
      where: { id },
      data: { mailedTo: result.sentTo.join(', '), mailedAt: new Date(), mailError: null },
    });
    return { outcome: 'sent' };
  } catch (error) {
    console.error(`Checkliste ${id}: Zustellung fehlgeschlagen:`, error);
    try {
      await prisma.droneChecklist.update({
        where: { id },
        data: { mailedAt: null, mailError: error instanceof Error ? error.message.slice(0, 200) : 'Unbekannter Fehler' },
      });
    } catch {
      // Selbst das Protokollieren des Fehlers darf nie werfen.
    }
    return { outcome: 'failed' };
  }
}
