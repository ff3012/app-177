'use server';

import { prisma } from '@/lib/db/prisma';
import { loadReportForEdit, assertReportIsEditable } from '@/lib/heimatfeuerwehr/report-access';
import { getNextReportNumber } from '@/lib/heimatfeuerwehr/report-sequence';

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

  return {};
}
