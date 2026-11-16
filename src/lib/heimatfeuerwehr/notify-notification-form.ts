import { sendEmail } from '@/lib/email/mailjet';
import { escapeHtml } from '@/lib/email/escape-html';
import { buildMailFooter } from './mail-footer';
import type { NotificationInput } from './notification-input';

export interface NotificationMailContext {
  organizationName: string;
  /** Kurzname der Feuerwehr für den Einleitungssatz ("Feuerwehr Ambach"). */
  organizationShortName: string;
  senderName: string;
  /** Nur als Reply-To (wie bei den Berichten); null = kein Reply-To. */
  senderEmail: string | null;
  sentAt: Date;
  input: NotificationInput;
  /** Vorname dieses Empfängers, falls die Adresse einem aktiven Mitglied gehört; sonst null ("Hallo,"). */
  recipientFirstName: string | null;
  /** Alle Empfängeradressen der Meldung (Zeile "Ergeht an"). */
  recipientEmails: string[];
}

export interface NotificationRecipient {
  email: string;
  firstName: string | null;
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
  const { organizationName, organizationShortName, senderName, sentAt, input, recipientFirstName, recipientEmails } = ctx;

  let subject: string;
  let what: string;
  let lines: Line[];
  if (input.form === 'DRINKS') {
    subject = `Getränkeautomat: Produkte fehlen – ${organizationName}`;
    what = 'eine neue Meldung zum Getränkeautomat';
    lines = [{ label: 'Fehlende Produkte', value: input.products.join(', ') }];
    if (input.note) lines.push({ label: 'Anmerkung', value: input.note });
  } else {
    subject = `${input.acute === true ? 'AKUT: ' : ''}Schadensmeldung: ${input.equipment} – ${organizationName}`;
    what = 'eine neue Schadensmeldung';
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

  const greeting = recipientFirstName ? `Hallo ${recipientFirstName},` : 'Hallo,';
  const intro = `${what} in Feuerwehr ${organizationShortName} ist eingegangen.`;
  const footer = buildMailFooter(recipientEmails);

  const textPart = [greeting, '', intro, '', ...all.map((line) => `${line.label}: ${line.value}`), '', footer.text].join('\n');

  const htmlPart =
    `<p>${escapeHtml(greeting)}</p>` +
    `<p>${escapeHtml(intro)}</p>` +
    `<ul>${all
      .map((line) => `<li><b>${escapeHtml(line.label)}:</b> ${escapeHtml(line.value).replace(/\n/g, '<br>')}</li>`)
      .join('')}</ul>` +
    footer.html;
  return { subject, textPart, htmlPart };
}

/**
 * Sendet die Meldung als eine E-Mail je Empfänger (kein gemeinsames An/Cc; die Empfängerliste steht nur als Text im
 * Inhalt). Einzelne Fehler werden pro Empfänger abgefangen und ohne Adresse/Inhalt protokolliert.
 */
export async function sendNotificationMails(
  ctx: Omit<NotificationMailContext, 'recipientFirstName' | 'recipientEmails'>,
  recipients: NotificationRecipient[],
): Promise<{ attempted: number; failed: number }> {
  const recipientEmails = recipients.map((recipient) => recipient.email);
  let failed = 0;
  for (const recipient of recipients) {
    const { subject, textPart, htmlPart } = buildNotificationMail({ ...ctx, recipientFirstName: recipient.firstName, recipientEmails });
    try {
      await sendEmail({ to: recipient.email, subject, textPart, htmlPart, replyTo: ctx.senderEmail ?? undefined });
    } catch {
      failed += 1;
      console.error('Meldung: Versand an einen Empfänger fehlgeschlagen.');
    }
  }
  return { attempted: recipients.length, failed };
}
