import { getSystemCheckNotificationEmail } from '@/lib/settings';
import { sendEmail } from '@/lib/email/mailjet';
import { escapeHtml } from '@/lib/email/escape-html';
import { buildSystemCheckRows } from '@/lib/system/system-check-rows';
import type { SystemCheckResult } from '@/lib/system/system-check';

/**
 * Vom täglichen Cron-Job (siehe /api/cron/system-check) aufgerufen. Empfänger ist admin-konfigurierbar
 * über /admin/email ("System Check E-Mail", analog zur "Drohnenflug E-Mail") statt hardcodiert - liest
 * daher wie notifyDroneFlightCreated() die Adresse aus AppSettings und no-opt, wenn keine gesetzt ist,
 * statt einen Fehler zu werfen. Fängt Versandfehler ebenso ab (ein Mailjet-Ausfall darf den täglichen
 * Check selbst nicht zum Fehlschlagen bringen). Die Tabelle (ein Check pro Zeile, mit Ergebnis) nutzt
 * dieselben Zeilen/Labels wie die Status-Seite, über das gemeinsame buildSystemCheckRows().
 */
export async function notifySystemCheckResult(result: SystemCheckResult): Promise<void> {
  const recipient = await getSystemCheckNotificationEmail();
  if (!recipient) return;

  const rows = buildSystemCheckRows(result);
  const allOk = rows.every((row) => row.ok);
  const checkedAtFormatted = new Date(result.checkedAt).toLocaleString('de-AT');

  const htmlRows = rows
    .map(
      (row) =>
        '<tr>' +
        `<td style="padding:6px 12px;border:1px solid #ddd;">${escapeHtml(row.label)}</td>` +
        `<td style="padding:6px 12px;border:1px solid #ddd;color:${row.ok ? '#15803d' : '#b91c1c'};font-weight:600;">${row.ok ? 'OK' : 'FEHLER'}</td>` +
        `<td style="padding:6px 12px;border:1px solid #ddd;">${escapeHtml(row.detail)}</td>` +
        '</tr>',
    )
    .join('');

  try {
    await sendEmail({
      to: recipient,
      subject: `Systemcheck App-177: ${allOk ? 'Alles OK' : 'Fehler erkannt'} (${checkedAtFormatted})`,
      textPart: [
        `Täglicher Systemcheck App-177 - ${checkedAtFormatted}`,
        '',
        ...rows.map((row) => `${row.ok ? 'OK    ' : 'FEHLER'} - ${row.label}: ${row.detail}`),
        '',
        'Feuerwehr Abschnitt Purkersdorf',
      ].join('\n'),
      htmlPart: [
        `<p>Täglicher Systemcheck App-177 - ${escapeHtml(checkedAtFormatted)}</p>`,
        '<table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;">',
        '<tr>',
        '<th style="padding:6px 12px;border:1px solid #ddd;text-align:left;">Check</th>',
        '<th style="padding:6px 12px;border:1px solid #ddd;text-align:left;">Ergebnis</th>',
        '<th style="padding:6px 12px;border:1px solid #ddd;text-align:left;">Details</th>',
        '</tr>',
        htmlRows,
        '</table>',
        '<p>Feuerwehr Abschnitt Purkersdorf</p>',
      ].join(''),
    });
  } catch (error) {
    console.error('Systemcheck-E-Mail-Versand fehlgeschlagen:', error);
  }
}
