import { sendEmail } from '@/lib/email/mailjet';
import { escapeHtml } from '@/lib/email/escape-html';
import type { NotificationInput } from './notification-input';

export interface NotificationMailContext {
  organizationName: string;
  senderName: string;
  /** Nur als Reply-To (wie bei den Berichten); null = kein Reply-To. */
  senderEmail: string | null;
  sentAt: Date;
  input: NotificationInput;
}

const sentAtFormat = new Intl.DateTimeFormat('de-AT', {
  timeZone: 'Europe/Vienna',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function germanDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}.${month}.${year}`;
}

type Line = { label: string; value: string };

/** Betreff, Text und HTML der Meldung (rein, ohne Versand). Alle Werte werden im HTML maskiert. */
export function buildNotificationMail(ctx: NotificationMailContext): { subject: string; textPart: string; htmlPart: string } {
  const { organizationName, senderName, sentAt, input } = ctx;

  let subject: string;
  let intro: string;
  let lines: Line[];
  if (input.form === 'DRINKS') {
    subject = `Getränkeautomat: Produkte fehlen – ${organizationName}`;
    intro = `Meldung zum Getränkeautomat in ${organizationName}.`;
    lines = [{ label: 'Fehlende Produkte', value: input.products.join(', ') }];
    if (input.note) lines.push({ label: 'Anmerkung', value: input.note });
  } else {
    subject = `${input.acute === true ? 'AKUT: ' : ''}Schadensmeldung: ${input.equipment} – ${organizationName}`;
    intro = `Schadensmeldung in ${organizationName}.`;
    lines = [
      { label: 'Datum', value: germanDate(input.occurredOn) },
      { label: 'Gerät / Ausrüstung', value: input.equipment },
      { label: 'Akut', value: input.acute === true ? 'Ja' : input.acute === false ? 'Nein' : 'nicht angegeben' },
      { label: 'Beschreibung', value: input.description },
    ];
  }
  const meta: Line[] = [
    { label: 'Gemeldet von', value: senderName },
    { label: 'Zeitpunkt', value: sentAtFormat.format(sentAt) },
  ];
  const all = [...meta, ...lines];

  const textPart = [intro, '', ...all.map((line) => `${line.label}: ${line.value}`)].join('\n');
  const htmlPart = `<p>${escapeHtml(intro)}</p><ul>${all
    .map((line) => `<li><b>${escapeHtml(line.label)}:</b> ${escapeHtml(line.value).replace(/\n/g, '<br>')}</li>`)
    .join('')}</ul>`;
  return { subject, textPart, htmlPart };
}

/**
 * Sendet die Meldung als eine E-Mail je Empfänger (kein gemeinsames An/Cc, damit kein Empfänger die Adressen der
 * anderen sieht). Einzelne Fehler werden pro Empfänger abgefangen und ohne Adresse/Inhalt protokolliert.
 */
export async function sendNotificationMails(
  ctx: NotificationMailContext,
  recipients: string[],
): Promise<{ attempted: number; failed: number }> {
  const { subject, textPart, htmlPart } = buildNotificationMail(ctx);
  let failed = 0;
  for (const to of recipients) {
    try {
      await sendEmail({ to, subject, textPart, htmlPart, replyTo: ctx.senderEmail ?? undefined });
    } catch {
      failed += 1;
      console.error('Meldung: Versand an einen Empfänger fehlgeschlagen.');
    }
  }
  return { attempted: recipients.length, failed };
}
