import { prisma } from '@/lib/db/prisma';
import { sendEmail } from '@/lib/email/mailjet';
import { escapeHtml } from '@/lib/email/escape-html';
import { NOT_DEACTIVATED_WHERE } from '@/lib/auth/user-status';

function baseUrl(): string {
  return process.env.AUTH_URL?.replace(/\/$/, '') ?? '';
}

export interface RegistrationEmailContext {
  firstName: string;
  lastName: string;
  stbNr: string;
  dienstgradLabel: string | null;
  email: string;
  organizationId: string;
  organizationLabel: string;
}

/**
 * Bestätigt dem Antragsteller den Eingang seiner Registrierung. Best-effort wie jeder andere
 * E-Mail-Versand in diesem Modul, wirft nie.
 */
export async function sendRegistrationConfirmationEmail(ctx: RegistrationEmailContext): Promise<void> {
  try {
    await sendEmail({
      to: ctx.email,
      toName: `${ctx.firstName} ${ctx.lastName}`,
      subject: 'Deine Registrierung wird geprüft',
      textPart: `Hallo ${ctx.firstName},\n\ndeine Registrierung bei ${ctx.organizationLabel} ist eingegangen und wird von einem Admin geprüft. Sobald sie freigegeben ist, erhältst du eine E-Mail mit einem Link, über den du dein Passwort festlegen kannst.\n\nDiese E-Mail wurde automatisch versendet, bitte nicht direkt darauf antworten.\n\nBezirksfeuerwehrkommando St. Pölten`,
      htmlPart: `<p>Hallo ${escapeHtml(ctx.firstName)},</p><p>deine Registrierung bei ${escapeHtml(ctx.organizationLabel)} ist eingegangen und wird von einem Admin geprüft. Sobald sie freigegeben ist, erhältst du eine E-Mail mit einem Link, über den du dein Passwort festlegen kannst.</p><p>Diese E-Mail wurde automatisch versendet, bitte nicht direkt darauf antworten.</p><p>Bezirksfeuerwehrkommando St. Pölten</p>`,
    });
  } catch (error) {
    console.error('Fehler beim Senden der Registrierungs-Bestätigungs-E-Mail:', error);
  }
}

/**
 * Benachrichtigt alle ADMIN-Mitglieder der gewählten Feuerwehr über eine neue Registrierung. Hat die
 * Feuerwehr aktuell keinen eigenen Admin, geht dieselbe Mail stattdessen an alle Bezirksadmins - eine
 * Anfrage darf nie ins Leere laufen. Eine E-Mail PRO Empfänger, nie ein gemeinsames To/Cc - dieselbe
 * Regel wie sendVehicleBookingApprovalRequest. Jeder Versand einzeln try/catch-abgesichert, die
 * Funktion selbst wirft nie. Kein Ein-Klick-Genehmigen-Link - die Mail verlinkt auf die eingeloggte
 * Benutzerverwaltung, siehe docs/superpowers/specs/2026-08-30-registrierung-design.md.
 */
export async function notifyOrganizationAdminsOfRegistration(ctx: RegistrationEmailContext): Promise<void> {
  const adminMemberships = await prisma.membership.findMany({
    where: { organizationId: ctx.organizationId, role: 'ADMIN', user: NOT_DEACTIVATED_WHERE },
    select: { user: { select: { email: true, firstName: true, lastName: true } } },
  });

  let recipients = adminMemberships.map((m) => m.user);
  if (recipients.length === 0) {
    recipients = await prisma.user.findMany({
      where: { isBezirksAdmin: true, ...NOT_DEACTIVATED_WHERE },
      select: { email: true, firstName: true, lastName: true },
    });
  }
  if (recipients.length === 0) return;

  const link = `${baseUrl()}/admin/benutzer`;
  const subject = `Neue Registrierung: ${ctx.firstName} ${ctx.lastName} (${ctx.organizationLabel})`;
  const textPart = [
    `${ctx.firstName} ${ctx.lastName} hat sich für ${ctx.organizationLabel} registriert:`,
    '',
    `Standesbuchnummer: ${ctx.stbNr}`,
    ctx.dienstgradLabel ? `Dienstgrad: ${ctx.dienstgradLabel}` : null,
    `E-Mail: ${ctx.email}`,
    '',
    `Zur Prüfung: ${link}`,
  ]
    .filter((line) => line !== null)
    .join('\n');
  const htmlPart = [
    `<p>${escapeHtml(ctx.firstName)} ${escapeHtml(ctx.lastName)} hat sich für ${escapeHtml(ctx.organizationLabel)} registriert:</p>`,
    '<ul>',
    `<li>Standesbuchnummer: ${escapeHtml(ctx.stbNr)}</li>`,
    ctx.dienstgradLabel ? `<li>Dienstgrad: ${escapeHtml(ctx.dienstgradLabel)}</li>` : '',
    `<li>E-Mail: ${escapeHtml(ctx.email)}</li>`,
    '</ul>',
    `<p><a href="${link}">Zur Prüfung in der Benutzerverwaltung</a></p>`,
  ].join('');

  for (const to of recipients) {
    try {
      await sendEmail({ to: to.email, toName: `${to.firstName} ${to.lastName}`, subject, textPart, htmlPart });
    } catch (error) {
      console.error('Fehler beim Senden der Registrierungs-Admin-Benachrichtigung:', error);
    }
  }
}
