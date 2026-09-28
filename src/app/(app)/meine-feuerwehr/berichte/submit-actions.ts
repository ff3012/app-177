'use server';

import { prisma } from '@/lib/db/prisma';
import { loadReportForEdit, assertReportIsEditable } from '@/lib/heimatfeuerwehr/report-access';
import { getNextReportNumber } from '@/lib/heimatfeuerwehr/report-sequence';
import { generateReportPdf, reportPdfFileName, type ReportForPdf } from '@/lib/heimatfeuerwehr/report-pdf';
import { putReportPdf } from '@/lib/storage/report-pdf-s3';
import { sendReportSubmittedEmail } from '@/lib/heimatfeuerwehr/notify-report-submitted';

/**
 * Abgabe-Transaktion (Bericht-Brief.md §6, Design-Spec §7): serverseitige Pflichtfeldprüfung, dann
 * Nummer/Jahr vergeben und status auf SUBMITTED setzen - alles in einer prisma.$transaction, damit ein
 * gleichzeitiger zweiter Abgabe-Versuch derselben Feuerwehr/desselben Jahres nie zwei Berichte mit
 * derselben Nummer erzeugen kann. PDF-Erzeugung/S3-Upload/E-Mail passieren NICHT hier (siehe Task 9) -
 * das sind keine DB-Operationen und dürfen die Transaktion nicht offen halten.
 */
export async function submitReport(reportId: string): Promise<{ error?: string }> {
  const report = await loadReportForEdit(reportId);
  assertReportIsEditable(report);

  if (report.ownActivity === null) {
    return { error: '"Eigene Tätigkeit" muss angegeben werden.' };
  }
  if (report.activityKinds.length === 0 && !report.activityOther?.trim()) {
    return { error: 'Mindestens eine Tätigkeitsart oder "Sonstige" muss angegeben werden.' };
  }
  if (!report.remark?.trim()) {
    return { error: 'Eine Bemerkung ist erforderlich.' };
  }
  if (report.vehicleId !== null && report.vehicleKm === null) {
    return { error: 'Bitte die gefahrenen Kilometer angeben.' };
  }

  const now = new Date();
  const year = now.getFullYear();

  await prisma.$transaction(async (tx) => {
    const number = await getNextReportNumber(tx, report.fireDepartmentId, year);
    await tx.report.update({
      where: { id: reportId },
      data: { number, year, status: 'SUBMITTED', submittedAt: now },
    });
  });

  // Ab hier: keine DB-Transaktion mehr offen. PDF/S3/E-Mail sind bewusst NICHT Teil der Transaktion
  // oben (Design-Spec §7) - ein Fehler hier darf die bereits abgegebene Nummer nie zurückrollen.
  const [fullReport, fireDepartment] = await Promise.all([
    prisma.report.findUniqueOrThrow({
      where: { id: reportId },
      include: {
        filledBy: { select: { firstName: true, lastName: true, stbNr: true, email: true } },
        vehicle: { select: { taktischeBezeichnung: true, kennzeichen: true } },
        members: { include: { user: { select: { firstName: true, lastName: true, stbNr: true } } } },
        materials: true,
      },
    }),
    prisma.organization.findUniqueOrThrow({
      where: { id: report.fireDepartmentId },
      select: { name: true, reportRecipients: true },
    }),
  ]);

  const pdfData: ReportForPdf = {
    number: fullReport.number!,
    year: fullReport.year!,
    type: fullReport.type,
    fireDepartmentName: fireDepartment.name,
    filledByName: `${fullReport.filledBy.firstName} ${fullReport.filledBy.lastName}`,
    filledByStbNr: fullReport.filledBy.stbNr,
    startAt: fullReport.startAt,
    endAt: fullReport.endAt,
    ownActivity: fullReport.ownActivity!,
    activityKinds: fullReport.activityKinds,
    activityOther: fullReport.activityOther,
    vehicleLabel: fullReport.vehicle ? `${fullReport.vehicle.taktischeBezeichnung} (${fullReport.vehicle.kennzeichen})` : null,
    vehicleKm: fullReport.vehicleKm,
    remark: fullReport.remark!,
    members: fullReport.members.map((m) => ({ name: `${m.user.firstName} ${m.user.lastName}`, stbNr: m.user.stbNr, funktion: m.funktion })),
    materials: fullReport.materials.filter((m) => m.kind === 'MATERIAL').map((m) => ({ code: m.code, value: Number(m.value) })),
    equipment: fullReport.materials.filter((m) => m.kind === 'EQUIPMENT').map((m) => ({ code: m.code, value: Number(m.value) })),
  };

  const pdfFileName = reportPdfFileName(pdfData.number, now);
  const storageKey = `${report.fireDepartmentId}/${pdfFileName}`;

  try {
    const pdfBuffer = await generateReportPdf(pdfData);
    await putReportPdf(storageKey, pdfBuffer);
    await sendReportSubmittedEmail(
      { ...pdfData, fireDepartmentEmails: fireDepartment.reportRecipients, filledByEmail: fullReport.filledBy.email },
      pdfBuffer,
      pdfFileName,
    );
    await prisma.report.update({ where: { id: reportId }, data: { emailSentAt: now, emailError: null } });
  } catch (error) {
    await prisma.report.update({
      where: { id: reportId },
      data: { emailError: error instanceof Error ? error.message : 'Unbekannter Fehler' },
    });
  }

  return {};
}
