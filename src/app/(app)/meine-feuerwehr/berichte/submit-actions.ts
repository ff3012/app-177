'use server';

import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canCreateReportFor } from '@/lib/auth/permissions';
import { NOT_DEACTIVATED_WHERE } from '@/lib/auth/user-status';
import { MATERIALS, EQUIPMENT, getKindOptionsForType } from '@/lib/heimatfeuerwehr/report-constants';
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
  vehicles: { vehicleId: string; km: number }[];
  remark: string;
  // member.vehicleId muss eine der oben in `vehicles` gewählten vehicleId sein, oder null ("ohne
  // Fahrzeug" - z. B. zu Fuß/privat angereist, weiterhin möglich auch wenn Fahrzeuge verwendet wurden).
  members: { userId: string; funktion: ReportMemberFunktion; vehicleId: string | null }[];
  quantities: { kind: 'MATERIAL' | 'EQUIPMENT'; code: string; value: number }[];
  // Übungsbericht-spezifisch (type === EXERCISE) - bei ACTIVITY/INCIDENT immer null, siehe
  // Report-Modell-Kommentar in schema.prisma.
  uebungsleiterId: string | null;
  uebungsueberwachungId: string | null;
  uebungsbeobachterId: string | null;
  uebungsortStrasse: string | null;
  uebungsortNr: string | null;
  uebungsortPlz: string | null;
  uebungsortOrt: string | null;
  weitereFeuerwehren: string | null;
  uebungsziel: string | null;
  uebungslage: string | null;
  uebungsdarstellung: string | null;
  fuerUebungVerstaendigen: string | null;
  uebungserkenntnis: string | null;
  uebungszielsetzung: string | null;
  vorschlaege: string | null;
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
  const kindOptions = getKindOptionsForType(input.type);
  const kindLabel = input.type === 'EXERCISE' ? 'Übungsart' : 'Tätigkeitsart';
  if (input.activityKinds.length === 0 && !activityOther) {
    return { error: `Mindestens eine ${kindLabel} oder "Sonstige" muss angegeben werden.` };
  }
  if (input.activityKinds.length > 1) {
    return { error: `Es kann nur eine ${kindLabel} ausgewählt werden.` };
  }
  if (input.activityKinds.length === 1 && !kindOptions.some((option) => option.code === input.activityKinds[0])) {
    return { error: `Unbekannte ${kindLabel}.` };
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

  const inputVehicleIds = input.vehicles.map((v) => v.vehicleId);
  if (new Set(inputVehicleIds).size !== inputVehicleIds.length) {
    return { error: 'Ein Fahrzeug ist mehrfach eingetragen.' };
  }
  const validVehicles = inputVehicleIds.length
    ? await prisma.vehicle.findMany({
        where: { id: { in: inputVehicleIds }, organizationId: fireDepartmentId, isActive: true },
        select: { id: true, taktischeBezeichnung: true, kennzeichen: true },
      })
    : [];
  if (validVehicles.length !== inputVehicleIds.length) {
    return { error: 'Mindestens ein ausgewähltes Fahrzeug gehört nicht zu dieser Feuerwehr.' };
  }
  if (input.vehicles.some((v) => !(v.km >= 0))) {
    return { error: 'Bitte die gefahrenen Kilometer angeben.' };
  }
  const vehiclesById = new Map(validVehicles.map((v) => [v.id, v]));

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
  if (input.members.some((m) => m.vehicleId !== null && !inputVehicleIds.includes(m.vehicleId))) {
    return { error: 'Ein Mitglied ist einem nicht ausgewählten Fahrzeug zugeordnet.' };
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

  // Übungsleiter/-überwachung/-beobachter sind optionale Mitglied-Referenzen (nicht Teil der
  // eingesetzten Mitglieder-Liste oben) - dieselbe Org+aktiv-Prüfung wie filledBy/Mitglieder, nur je
  // Feld einzeln, da nicht jedes gesetzt sein muss.
  const uebungsRoleIds = [input.uebungsleiterId, input.uebungsueberwachungId, input.uebungsbeobachterId].filter(
    (id): id is string => id !== null,
  );
  const validUebungsRoleUsers = uebungsRoleIds.length
    ? await prisma.user.findMany({
        where: { id: { in: uebungsRoleIds }, homeOrganizationId: fireDepartmentId, ...NOT_DEACTIVATED_WHERE },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  if (validUebungsRoleUsers.length !== new Set(uebungsRoleIds).size) {
    return { error: 'Übungsleiter/-überwachung/-beobachter muss zu dieser Feuerwehr gehören.' };
  }
  const uebungsRoleUsersById = new Map(validUebungsRoleUsers.map((u) => [u.id, u]));

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
          remark,
          number: nextNumber,
          year,
          submittedAt: now,
          uebungsleiterId: input.uebungsleiterId,
          uebungsueberwachungId: input.uebungsueberwachungId,
          uebungsbeobachterId: input.uebungsbeobachterId,
          uebungsortStrasse: input.uebungsortStrasse,
          uebungsortNr: input.uebungsortNr,
          uebungsortPlz: input.uebungsortPlz,
          uebungsortOrt: input.uebungsortOrt,
          weitereFeuerwehren: input.weitereFeuerwehren,
          uebungsziel: input.uebungsziel,
          uebungslage: input.uebungslage,
          uebungsdarstellung: input.uebungsdarstellung,
          fuerUebungVerstaendigen: input.fuerUebungVerstaendigen,
          uebungserkenntnis: input.uebungserkenntnis,
          uebungszielsetzung: input.uebungszielsetzung,
          vorschlaege: input.vorschlaege,
          materials: { createMany: { data: usedQuantities.map((q) => ({ kind: q.kind, code: q.code, value: q.value })) } },
        },
        select: { id: true, number: true },
      });

      // ReportVehicle-Zeilen einzeln anlegen (nicht createMany), da wir die generierte id jeder Zeile
      // brauchen, um die zugehörigen ReportMember-Zeilen darauf zeigen zu lassen (reportVehicleId) -
      // createMany gibt in Postgres keine erzeugten Zeilen/IDs zurück.
      const reportVehicleIdByVehicleId = new Map<string, string>();
      for (const v of input.vehicles) {
        const reportVehicle = await tx.reportVehicle.create({
          data: { reportId: report.id, vehicleId: v.vehicleId, km: v.km },
          select: { id: true },
        });
        reportVehicleIdByVehicleId.set(v.vehicleId, reportVehicle.id);
      }

      if (input.members.length > 0) {
        await tx.reportMember.createMany({
          data: input.members.map((m) => ({
            reportId: report.id,
            userId: m.userId,
            funktion: m.funktion,
            reportVehicleId: m.vehicleId ? reportVehicleIdByVehicleId.get(m.vehicleId)! : null,
          })),
        });
      }

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
  function vehicleLabelFor(vehicleId: string): string {
    const v = vehiclesById.get(vehicleId)!;
    return `${v.taktischeBezeichnung} (${v.kennzeichen})`;
  }
  function nameFor(userId: string | null): string | null {
    if (!userId) return null;
    const u = uebungsRoleUsersById.get(userId);
    return u ? `${u.firstName} ${u.lastName}` : null;
  }
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
    vehicles: input.vehicles.map((v) => ({ label: vehicleLabelFor(v.vehicleId), km: v.km })),
    remark,
    members: input.members.map((m) => {
      const member = membersById.get(m.userId)!;
      return {
        name: `${member.firstName} ${member.lastName}`,
        stbNr: member.stbNr,
        funktion: m.funktion,
        vehicleLabel: m.vehicleId ? vehicleLabelFor(m.vehicleId) : null,
      };
    }),
    materials: usedQuantities.filter((q) => q.kind === 'MATERIAL').map((q) => ({ code: q.code, value: q.value })),
    equipment: usedQuantities.filter((q) => q.kind === 'EQUIPMENT').map((q) => ({ code: q.code, value: q.value })),
    uebungsleiterName: nameFor(input.uebungsleiterId),
    uebungsueberwachungName: nameFor(input.uebungsueberwachungId),
    uebungsbeobachterName: nameFor(input.uebungsbeobachterId),
    uebungsortStrasse: input.uebungsortStrasse,
    uebungsortNr: input.uebungsortNr,
    uebungsortPlz: input.uebungsortPlz,
    uebungsortOrt: input.uebungsortOrt,
    weitereFeuerwehren: input.weitereFeuerwehren,
    uebungsziel: input.uebungsziel,
    uebungslage: input.uebungslage,
    uebungsdarstellung: input.uebungsdarstellung,
    fuerUebungVerstaendigen: input.fuerUebungVerstaendigen,
    uebungserkenntnis: input.uebungserkenntnis,
    uebungszielsetzung: input.uebungszielsetzung,
    vorschlaege: input.vorschlaege,
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
