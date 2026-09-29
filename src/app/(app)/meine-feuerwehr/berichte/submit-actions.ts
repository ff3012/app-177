'use server';

import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canCreateReportFor } from '@/lib/auth/permissions';
import { NOT_DEACTIVATED_WHERE } from '@/lib/auth/user-status';
import { ACTIVITY_KINDS, MATERIALS, EQUIPMENT } from '@/lib/heimatfeuerwehr/report-constants';
import { getNextReportNumber } from '@/lib/heimatfeuerwehr/report-sequence';
import { generateReportPdf, reportPdfFileName, reportPdfStorageKey, type ReportForPdf } from '@/lib/heimatfeuerwehr/report-pdf';
import { putReportPdf } from '@/lib/storage/report-pdf-s3';
import { sendReportSubmittedEmail } from '@/lib/heimatfeuerwehr/notify-report-submitted';
import type { ReportType, ReportMemberFunktion } from '@prisma/client';

export interface SubmitReportInput {
  type: ReportType;
  filledById: string;
  startAt: string;
  endAt: string;
  ownActivity: boolean;
  activityKinds: string[];
  activityOther: string | null;
  vehicleId: string | null;
  vehicleKm: number | null;
  remark: string;
  members: { userId: string; funktion: ReportMemberFunktion }[];
  quantities: { kind: 'MATERIAL' | 'EQUIPMENT'; code: string; value: number }[];
}

const FUNKTIONEN: ReportMemberFunktion[] = ['KOMMANDANT', 'FAHRER', 'MANNSCHAFT'];

/**
 * Legt einen Tätigkeitsbericht in EINEM atomaren Schritt an und gibt ihn sofort ab - kein
 * Entwurf-Konzept mehr (siehe Report-Modell-Kommentar in prisma/schema.prisma): die Zeile existiert
 * erst ab hier, mit number/year/submittedAt bereits gesetzt. Der Aufrufer (ReportWizard) hat alle
 * Eingaben rein clientseitig gesammelt, daher MUSS diese Funktion jede einzelne Angabe serverseitig
 * neu prüfen - anders als früher gibt es keine vorherige Autospeicherung, die schon etwas geprüft
 * hätte. Ein doppelter Klick/zwei parallele Tabs könnten theoretisch zwei separate Berichte erzeugen
 * (kein Entwurf-Datensatz mehr, an dem ein atomarer Status-Guard ansetzen könnte) - das clientseitige
 * Deaktivieren des Buttons nach dem ersten Klick ist der einzige Schutz dagegen, bewusst akzeptiert.
 */
export async function submitReport(input: SubmitReportInput): Promise<{ error?: string; reportId?: string }> {
  const user = await requireUser();
  assertPermission(canCreateReportFor(user, user.homeOrganizationId));
  const fireDepartmentId = user.homeOrganizationId;

  if (typeof input.ownActivity !== 'boolean') {
    return { error: '"Eigene Tätigkeit" muss angegeben werden.' };
  }
  const activityOther = input.activityOther?.trim() || null;
  if (input.activityKinds.length === 0 && !activityOther) {
    return { error: 'Mindestens eine Tätigkeitsart oder "Sonstige" muss angegeben werden.' };
  }
  if (input.activityKinds.length > 1) {
    return { error: 'Es kann nur eine Tätigkeitsart ausgewählt werden.' };
  }
  if (input.activityKinds.length === 1 && !ACTIVITY_KINDS.some((option) => option.code === input.activityKinds[0])) {
    return { error: 'Unbekannte Tätigkeitsart.' };
  }
  const remark = input.remark.trim();
  if (!remark) {
    return { error: 'Eine Bemerkung ist erforderlich.' };
  }
  const startAt = new Date(input.startAt);
  const endAt = new Date(input.endAt);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
    return { error: 'Das Ende muss nach dem Beginn liegen.' };
  }

  let vehicle: { taktischeBezeichnung: string; kennzeichen: string } | null = null;
  if (input.vehicleId !== null) {
    if (input.vehicleKm === null) {
      return { error: 'Bitte die gefahrenen Kilometer angeben.' };
    }
    vehicle = await prisma.vehicle.findFirst({
      where: { id: input.vehicleId, organizationId: fireDepartmentId, isActive: true },
      select: { taktischeBezeichnung: true, kennzeichen: true },
    });
    if (!vehicle) {
      return { error: 'Das ausgewählte Fahrzeug gehört nicht zu dieser Feuerwehr.' };
    }
  }

  const filledBy = await prisma.user.findFirst({
    where: { id: input.filledById, homeOrganizationId: fireDepartmentId, ...NOT_DEACTIVATED_WHERE },
    select: { id: true, firstName: true, lastName: true, stbNr: true, email: true },
  });
  if (!filledBy) {
    return { error: 'Das ausgewählte Mitglied gehört nicht zu dieser Feuerwehr.' };
  }

  const memberIds = input.members.map((m) => m.userId);
  if (new Set(memberIds).size !== memberIds.length) {
    return { error: 'Ein Mitglied ist mehrfach eingetragen.' };
  }
  if (input.members.some((m) => !FUNKTIONEN.includes(m.funktion))) {
    return { error: 'Unbekannte Funktion.' };
  }
  const validMembers = memberIds.length
    ? await prisma.user.findMany({
        where: { id: { in: memberIds }, homeOrganizationId: fireDepartmentId, ...NOT_DEACTIVATED_WHERE },
        select: { id: true, firstName: true, lastName: true, stbNr: true },
      })
    : [];
  if (validMembers.length !== memberIds.length) {
    return { error: 'Mindestens ein eingesetztes Mitglied gehört nicht zu dieser Feuerwehr.' };
  }

  for (const quantity of input.quantities) {
    const options = quantity.kind === 'MATERIAL' ? MATERIALS : EQUIPMENT;
    if (!options.some((option) => option.code === quantity.code)) {
      return { error: 'Unbekannter Material-/Gerätecode.' };
    }
    if (!(quantity.value >= 0)) {
      return { error: 'Mengenangaben müssen 0 oder größer sein.' };
    }
  }
  const usedQuantities = input.quantities.filter((q) => q.value > 0);

  const now = new Date();
  const year = now.getFullYear();

  let reportId: string;
  let number: number;
  try {
    const created = await prisma.$transaction(async (tx) => {
      const nextNumber = await getNextReportNumber(tx, fireDepartmentId, year);
      const report = await tx.report.create({
        data: {
          type: input.type,
          fireDepartmentId,
          filledById: filledBy.id,
          createdById: user.id,
          startAt,
          endAt,
          ownActivity: input.ownActivity,
          activityKinds: input.activityKinds,
          activityOther,
          vehicleId: input.vehicleId,
          vehicleKm: input.vehicleId !== null ? input.vehicleKm : null,
          remark,
          number: nextNumber,
          year,
          submittedAt: now,
          members: { createMany: { data: input.members.map((m) => ({ userId: m.userId, funktion: m.funktion })) } },
          materials: { createMany: { data: usedQuantities.map((q) => ({ kind: q.kind, code: q.code, value: q.value })) } },
        },
        select: { id: true, number: true },
      });
      return report;
    });
    reportId = created.id;
    number = created.number;
  } catch (error) {
    console.error('Bericht konnte nicht angelegt werden:', error);
    return { error: 'Der Bericht konnte nicht abgegeben werden. Bitte erneut versuchen.' };
  }

  // Ab hier: keine DB-Transaktion mehr offen. PDF/S3/E-Mail sind bewusst NICHT Teil der Transaktion
  // oben - ein Fehler hier darf die bereits abgegebene Nummer nie zurückrollen.
  const fireDepartment = await prisma.organization.findUniqueOrThrow({
    where: { id: fireDepartmentId },
    select: { name: true, reportRecipients: true, wappenImageData: true, wappenImageMimeType: true },
  });
  const wappenDataUri =
    fireDepartment.wappenImageData && fireDepartment.wappenImageMimeType
      ? `data:${fireDepartment.wappenImageMimeType};base64,${Buffer.from(fireDepartment.wappenImageData).toString('base64')}`
      : null;

  const membersById = new Map(validMembers.map((m) => [m.id, m]));
  const pdfData: ReportForPdf = {
    number,
    year,
    type: input.type,
    fireDepartmentName: fireDepartment.name,
    wappenDataUri,
    filledByName: `${filledBy.firstName} ${filledBy.lastName}`,
    filledByStbNr: filledBy.stbNr,
    startAt,
    endAt,
    ownActivity: input.ownActivity,
    activityKinds: input.activityKinds,
    activityOther,
    vehicleLabel: vehicle ? `${vehicle.taktischeBezeichnung} (${vehicle.kennzeichen})` : null,
    vehicleKm: input.vehicleId !== null ? input.vehicleKm : null,
    remark,
    members: input.members.map((m) => {
      const member = membersById.get(m.userId)!;
      return { name: `${member.firstName} ${member.lastName}`, stbNr: member.stbNr, funktion: m.funktion };
    }),
    materials: usedQuantities.filter((q) => q.kind === 'MATERIAL').map((q) => ({ code: q.code, value: q.value })),
    equipment: usedQuantities.filter((q) => q.kind === 'EQUIPMENT').map((q) => ({ code: q.code, value: q.value })),
  };

  const pdfFileName = reportPdfFileName(pdfData.number, now);
  const storageKey = reportPdfStorageKey(fireDepartmentId, pdfData.number, now);

  try {
    const pdfBuffer = await generateReportPdf(pdfData);
    await putReportPdf(storageKey, pdfBuffer);
    const emailResult = await sendReportSubmittedEmail(
      { ...pdfData, fireDepartmentEmails: fireDepartment.reportRecipients, filledByEmail: filledBy.email },
      pdfBuffer,
      pdfFileName,
    );
    // Nur dann "Gesendet", wenn wirklich etwas versucht wurde UND nichts fehlschlug. Keine Empfänger
    // konfiguriert = "nicht zutreffend" (beide Felder bleiben null), kein Fehler. Teil-/Totalausfall =
    // emailError mit Anzahl, emailSentAt bleibt null.
    if (emailResult.attempted > 0) {
      await prisma.report.update({
        where: { id: reportId },
        data:
          emailResult.failed === 0
            ? { emailSentAt: now, emailError: null }
            : { emailSentAt: null, emailError: `${emailResult.failed} von ${emailResult.attempted} E-Mails fehlgeschlagen` },
      });
    }
  } catch (error) {
    await prisma.report.update({
      where: { id: reportId },
      data: { emailError: error instanceof Error ? error.message : 'Unbekannter Fehler' },
    });
  }

  return { reportId };
}
