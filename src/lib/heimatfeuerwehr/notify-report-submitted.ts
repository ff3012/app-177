import { sendEmail } from '@/lib/email/mailjet';
import { escapeHtml } from '@/lib/email/escape-html';
import { ACTIVITY_KINDS, REPORT_TYPE_LABEL } from './report-constants';
import type { ReportForPdf } from './report-pdf';

export interface ReportSubmittedEmailContext extends ReportForPdf {
  fireDepartmentEmails: string[];
  filledByEmail: string;
}

export interface ReportSubmittedEmailResult {
  /** Anzahl der konfigurierten Empfänger, an die ein Versand versucht wurde (0 = keine konfiguriert). */
  attempted: number;
  /** Anzahl der Empfänger, bei denen der Versand fehlgeschlagen ist. */
  failed: number;
}

/** "Tätigkeitsart"-Zeile: Codes -> lesbare Bezeichnungen (dieselbe Quelle wie Formular und PDF), plus
 * "Sonstige" IMMER zusätzlich, wenn vorhanden - nicht nur, wenn kein Code gewählt wurde. */
export function formatActivityKindText(activityKinds: string[], activityOther: string | null): string {
  const kindLabels = activityKinds.map((code) => ACTIVITY_KINDS.find((k) => k.code === code)?.label ?? code);
  const otherTrimmed = activityOther?.trim();
  return (
    [...kindLabels, otherTrimmed ? `Sonstige: ${otherTrimmed}` : null]
      .filter((v): v is string => Boolean(v))
      .join(', ') || '-'
  );
}

/**
 * Bericht-Brief.md §8: Betreff/Text/Anhang. Best-effort, kein Retry (Design-Spec §1 Punkt 4) - sendet
 * einzeln an jeden konfigurierten Empfänger (gleiches "kein gemeinsames To/Cc"-Muster wie
 * notify-photo-upload.ts), Reply-To ist immer die E-Mail des Ausfüllers. Wirft nie für einzelne
 * Empfänger-Fehler, meldet aber über den Rückgabewert, was tatsächlich passiert ist - der Aufrufer
 * (submitReport) schreibt daraus Report.emailSentAt/emailError, damit die Verwaltung nicht "Gesendet"
 * anzeigt, obwohl nichts (oder nicht alles) rausging.
 */
export async function sendReportSubmittedEmail(
  context: ReportSubmittedEmailContext,
  pdfBuffer: Buffer,
  pdfFileName: string,
): Promise<ReportSubmittedEmailResult> {
  if (context.fireDepartmentEmails.length === 0) return { attempted: 0, failed: 0 };

  const subjectVehiclePart = context.vehicleLabel ? ` · ${context.vehicleLabel}` : '';
  const subject = `${REPORT_TYPE_LABEL[context.type]} Nr. ${String(context.number).padStart(3, '0')} · ${context.startAt.toLocaleDateString('de-AT')}${subjectVehiclePart} · ${context.filledByName}`;

  const tableRows: [string, string][] = [
    ['Ausgefüllt von', context.filledByName],
    ['Zeitraum', `${context.startAt.toLocaleString('de-AT')} – ${context.endAt.toLocaleString('de-AT')}`],
    ['Eigene Tätigkeit', context.ownActivity ? 'Ja' : 'Nein'],
    ['Tätigkeitsart', formatActivityKindText(context.activityKinds, context.activityOther)],
    ...(context.vehicleLabel ? [['Fahrzeug', `${context.vehicleLabel} (${context.vehicleKm ?? '-'} km)`] as [string, string]] : []),
    ['Mitglieder', context.members.map((m) => m.name).join(', ') || '-'],
    ['Bemerkung', context.remark],
  ];
  const textPart = tableRows.map(([label, value]) => `${label}: ${value}`).join('\n');
  // Jeder Wert wird escaped (src/lib/email/CLAUDE.md) - Bemerkung, "Sonstige"-Freitext, Namen und
  // Fahrzeugbezeichnung sind benutzerkontrolliert. Die Labels sind feste Literale, escapen schadet aber nicht.
  const htmlPart = `<table>${tableRows
    .map(([label, value]) => `<tr><td><strong>${escapeHtml(label)}</strong></td><td>${escapeHtml(value).replace(/\n/g, '<br>')}</td></tr>`)
    .join('')}</table>`;

  let failed = 0;
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
      failed += 1;
    }
  }
  return { attempted: context.fireDepartmentEmails.length, failed };
}
