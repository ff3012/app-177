import { sendEmail } from '@/lib/email/mailjet';
import { REPORT_TYPE_LABEL } from './report-constants';
import type { ReportForPdf } from './report-pdf';

export interface ReportSubmittedEmailContext extends ReportForPdf {
  fireDepartmentEmails: string[];
  filledByEmail: string;
}

/**
 * Bericht-Brief.md §8: Betreff/Text/Anhang. Best-effort, kein Retry (Design-Spec §1 Punkt 4) - sendet
 * einzeln an jeden konfigurierten Empfänger (gleiches "kein gemeinsames To/Cc"-Muster wie
 * notify-photo-upload.ts), Reply-To ist immer die E-Mail des Ausfüllers. Wirft nie - Aufrufer (submitReport,
 * Task 7/9) fängt trotzdem selbst try/catch ab und schreibt das Ergebnis in Report.emailSentAt/emailError.
 */
export async function sendReportSubmittedEmail(
  context: ReportSubmittedEmailContext,
  pdfBuffer: Buffer,
  pdfFileName: string,
): Promise<void> {
  if (context.fireDepartmentEmails.length === 0) return;

  const subjectVehiclePart = context.vehicleLabel ? ` · ${context.vehicleLabel}` : '';
  const subject = `${REPORT_TYPE_LABEL[context.type]} Nr. ${String(context.number).padStart(3, '0')} · ${context.startAt.toLocaleDateString('de-AT')}${subjectVehiclePart} · ${context.filledByName}`;

  const tableRows = [
    ['Ausgefüllt von', context.filledByName],
    ['Zeitraum', `${context.startAt.toLocaleString('de-AT')} – ${context.endAt.toLocaleString('de-AT')}`],
    ['Eigene Tätigkeit', context.ownActivity ? 'Ja' : 'Nein'],
    ['Tätigkeitsart', context.activityKinds.join(', ') || context.activityOther || '-'],
    ...(context.vehicleLabel ? [['Fahrzeug', `${context.vehicleLabel} (${context.vehicleKm ?? '-'} km)`]] : []),
    ['Mitglieder', context.members.map((m) => m.name).join(', ') || '-'],
    ['Bemerkung', context.remark],
  ];
  const textPart = tableRows.map(([label, value]) => `${label}: ${value}`).join('\n');
  const htmlPart = `<table>${tableRows.map(([label, value]) => `<tr><td><strong>${label}</strong></td><td>${value}</td></tr>`).join('')}</table>`;

  for (const recipient of context.fireDepartmentEmails) {
    try {
      await sendEmail({
        to: recipient,
        replyTo: context.filledByEmail,
        subject,
        textPart,
        htmlPart,
        attachments: [{ filename: pdfFileName, contentType: 'application/pdf', content: pdfBuffer }],
      });
    } catch (error) {
      console.error(`Tätigkeitsbericht-E-Mail an ${recipient} fehlgeschlagen:`, error);
    }
  }
}
