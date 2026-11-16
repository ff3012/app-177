import { escapeHtml } from '@/lib/email/escape-html';

const FALLBACK_APP_URL = 'https://app-17.bfkdo-stpoelten.at';

/** Link zur App (AUTH_URL, sonst die feste Adresse), immer mit Schrägstrich am Ende. */
export function appUrl(): string {
  return `${process.env.AUTH_URL?.replace(/\/$/, '') || FALLBACK_APP_URL}/`;
}

const NO_REPLY_NOTE = 'Dies ist eine automatische E-Mail, bitte nicht darauf antworten.';

/**
 * Gemeinsamer Fuß der Benachrichtigungs-E-Mails (Meldungen, Tätigkeits-/Übungsberichte): Gruß, App-Link,
 * Hinweis "automatische E-Mail" und die Zeile "Ergeht an:" mit allen Empfängeradressen. Das HTML ist maskiert.
 */
export function buildMailFooter(recipientEmails: string[]): { text: string; html: string } {
  const url = appUrl();
  const recipientLine = `Ergeht an: ${recipientEmails.join(', ')}`;
  const text = ['Vielen Dank', 'App-17', url, '', NO_REPLY_NOTE, '', recipientLine].join('\n');
  const html =
    `<p>Vielen Dank<br>App-17<br><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>` +
    `<p>${escapeHtml(NO_REPLY_NOTE)}</p>` +
    `<p>${escapeHtml(recipientLine)}</p>`;
  return { text, html };
}
