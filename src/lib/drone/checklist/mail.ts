import { escapeHtml } from '@/lib/email/escape-html';
import { sendEmail } from '@/lib/email/mailjet';
import { calcBuffers, formatMeters } from './buffers';
import type { ChecklistData } from './data';
import { grundlageText } from './labels';
import { viennaDateParts } from './columns';

const PURPOSE_LABEL = { EINSATZ: 'Einsatz', TRAINING: 'Training' } as const;

function umlautsToAscii(value: string): string {
  return value
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe')
    .replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss');
}

/** "Checkliste_Drohnenflug_{YYYY-MM-DD}_{Fluggebiet}.pdf" - Datum in Wiener Ortszeit, Sonderzeichen -> "_". */
export function checklistPdfFileName(flightAt: Date, area: string | null): string {
  const { datum } = viennaDateParts(flightAt);
  const safeArea =
    umlautsToAscii(area?.trim() ?? '')
      .replace(/[^A-Za-z0-9-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'ohne_Fluggebiet';
  return `Checkliste_Drohnenflug_${datum}_${safeArea}.pdf`;
}

/** "Checkliste Drohnenflug · {Einsatz|Training} · {Fluggebiet} · {TT.MM.JJJJ HH:MM}" */
export function checklistMailSubject(c: { purpose: string | null; area: string | null; flightAt: Date }): string {
  const { datum, zeit } = viennaDateParts(c.flightAt);
  const [y, m, d] = datum.split('-');
  const purpose = c.purpose === 'EINSATZ' || c.purpose === 'TRAINING' ? PURPOSE_LABEL[c.purpose] : 'Flug';
  return `Checkliste Drohnenflug · ${purpose} · ${c.area?.trim() || 'ohne Fluggebiet'} · ${d}.${m}.${y} ${zeit}`;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Gültige, eindeutige, getrimmte Adressen - ungültige Einträge werden still ausgelassen. */
export function resolveMailRecipients(emails: string[]): string[] {
  const seen = new Set<string>();
  for (const email of emails) {
    const trimmed = email.trim();
    if (EMAIL_PATTERN.test(trimmed)) seen.add(trimmed);
  }
  return [...seen];
}

export interface ChecklistMailContext {
  groupName: string;
  pilotName: string;
  droneNames: string[];
  grundlage: ChecklistData['grundlage'];
  openKat?: ChecklistData['openKat'];
  bescheid?: string;
  hoehe: number | undefined;
  flightCount: number;
  openComments: { label: string; comment: string }[];
  link: string;
}

/** Text und HTML der Benachrichtigungs-Mail (das PDF hängt als Anhang daran). */
export function buildChecklistMail(ctx: ChecklistMailContext): { text: string; html: string } {
  const buffers = ctx.hoehe && ctx.hoehe > 0 ? calcBuffers(ctx.hoehe) : null;
  const rows: [string, string][] = [
    ['Drohnengruppe', ctx.groupName],
    ['Pilot', ctx.pilotName],
    ['Fluggerät', ctx.droneNames.join(', ') || '-'],
    ['Grundlage', grundlageText({ grundlage: ctx.grundlage, openKat: ctx.openKat, bescheid: ctx.bescheid })],
    ['Flughöhe', ctx.hoehe ? `${String(ctx.hoehe).replace('.', ',')} m` : '-'],
    ...(buffers ? ([['Abstand Menschenansammlungen', `${formatMeters(buffers.abstandMenschenansammlungen)} m`]] as [string, string][]) : []),
    ['Erfasste Flüge', String(ctx.flightCount)],
  ];

  const textLines = rows.map(([label, value]) => `${label}: ${value}`);
  if (ctx.openComments.length > 0) {
    textLines.push('', 'Offene Punkte mit Kommentar:');
    for (const item of ctx.openComments) textLines.push(`- ${item.label}: ${item.comment}`);
  }
  textLines.push('', `Checkliste ansehen: ${ctx.link}`, 'Das PDF der Checkliste ist angehängt.');

  const htmlRows = rows
    .map(([label, value]) => `<tr><td><strong>${escapeHtml(label)}</strong></td><td>${escapeHtml(value)}</td></tr>`)
    .join('');
  const htmlComments =
    ctx.openComments.length > 0
      ? `<p><strong>Offene Punkte mit Kommentar</strong></p><ul>${ctx.openComments
          .map((item) => `<li>${escapeHtml(item.label)}: ${escapeHtml(item.comment).replace(/\n/g, '<br>')}</li>`)
          .join('')}</ul>`
      : '';
  const html = `<table>${htmlRows}</table>${htmlComments}<p><a href="${escapeHtml(ctx.link)}">Checkliste ansehen</a></p><p>Das PDF der Checkliste ist angehängt.</p>`;
  return { text: textLines.join('\n'), html };
}

export type MailMode = 'log' | 'live';

/** MAIL_MODE=log schreibt die Mail ins Log statt zu senden (Testbetrieb). Ohne Angabe wird live gesendet -
 * der Testbetrieb muss ausdrücklich eingeschaltet werden, damit ein vergessenes Setzen in Produktion nie
 * still alle Mails verschluckt. */
export function getMailMode(): MailMode {
  return process.env.MAIL_MODE?.trim().toLowerCase() === 'log' ? 'log' : 'live';
}

export interface ChecklistMail {
  subject: string;
  text: string;
  html: string;
  fileName: string;
  pdf: Buffer;
}

export interface MailSendResult {
  mode: MailMode;
  attempted: number;
  failed: number;
  /** Adressen, an die tatsächlich gesendet wurde (im log-Modus leer). */
  sentTo: string[];
}

type Sender = (params: Parameters<typeof sendEmail>[0]) => Promise<void>;

/** Eine eigene Mail je Empfänger (kein gemeinsames To/Cc). Wirft nie für einzelne Empfänger-Fehler. */
export async function sendChecklistMails(recipients: string[], mail: ChecklistMail, sender: Sender = sendEmail): Promise<MailSendResult> {
  const mode = getMailMode();
  if (mode === 'log') {
    for (const to of recipients) {
      console.log(
        `[MAIL_MODE=log] Checkliste-Mail an ${to} | Betreff: ${mail.subject} | Anhang: ${mail.fileName} (${mail.pdf.length} Bytes)\n${mail.text}`,
      );
    }
    return { mode, attempted: recipients.length, failed: 0, sentTo: [] };
  }
  const sentTo: string[] = [];
  let failed = 0;
  for (const to of recipients) {
    try {
      await sender({
        to,
        subject: mail.subject,
        textPart: mail.text,
        htmlPart: mail.html,
        attachments: [{ filename: mail.fileName, contentType: 'application/pdf', content: mail.pdf }],
      });
      sentTo.push(to);
    } catch (error) {
      console.error(`Checkliste-Mail an ${to} fehlgeschlagen:`, error);
      failed += 1;
    }
  }
  return { mode, attempted: recipients.length, failed, sentTo };
}
