import { sendEmail } from '@/lib/email/mailjet';
import { escapeHtml } from '@/lib/email/escape-html';

function baseUrl(): string {
  return process.env.AUTH_URL?.replace(/\/$/, '') ?? '';
}

function formatRange(startsAt: Date, endsAt: Date): string {
  const day = startsAt.toLocaleDateString('de-AT');
  const start = startsAt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  const end = endsAt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${start}–${end}`;
}

interface BookingEmailContext {
  approvalToken: string;
  startsAt: Date;
  endsAt: Date;
  details: string;
  vehicleTaktischeBezeichnung: string;
  vehicleKennzeichen: string;
  organizationLabel: string;
  requesterName: string;
  requesterEmail: string;
}

/**
 * Freigabe-Anfrage an die für die Feuerwehr hinterlegten fahrzeugReservierungEmails, mit zwei
 * Buttons (GENEHMIGT / NICHT GENEHMIGT) - beides plain <a>-Links, die einen bestätigenden
 * Zwischenschritt öffnen (kein Auto-GET), exakt dieselbe Sicherheitsüberlegung wie bei
 * Aktivierungs-/Passwort-Reset-/Login-Links (ein E-Mail-Link-Scanner darf die Entscheidung nicht
 * versehentlich selbst treffen, indem er beim Öffnen der Mail automatisch alle Links abruft).
 *
 * Eine E-Mail PRO Empfänger (nie ein gemeinsames To/Cc) - dieselbe Regel wie
 * notifyPhotoUploadCreated, damit kein Empfänger die Adressen der anderen zu sehen bekommt. Jeder
 * Versand ist einzeln try/catch-abgesichert, damit eine fehlgeschlagene Adresse die übrigen nicht
 * verhindert; die Funktion selbst wirft nie.
 */
export async function sendVehicleBookingApprovalRequest(ctx: BookingEmailContext, toEmails: string[]): Promise<void> {
  const genehmigenLink = `${baseUrl()}/fahrzeug-reservierung/genehmigen/${ctx.approvalToken}`;
  const ablehnenLink = `${baseUrl()}/fahrzeug-reservierung/ablehnen/${ctx.approvalToken}`;
  const range = formatRange(ctx.startsAt, ctx.endsAt);

  const subject = `Neue Fahrzeug-Reservierung: ${ctx.vehicleTaktischeBezeichnung} (${ctx.organizationLabel})`;
  const textPart = [
    `${ctx.requesterName} hat eine Fahrzeug-Reservierung eingereicht:`,
    '',
    `Fahrzeug: ${ctx.vehicleTaktischeBezeichnung} (${ctx.vehicleKennzeichen})`,
    `Zeitraum: ${range}`,
    ctx.details ? `Details: ${ctx.details}` : null,
    '',
    `Genehmigen: ${genehmigenLink}`,
    `Nicht genehmigen: ${ablehnenLink}`,
  ]
    .filter((line) => line !== null)
    .join('\n');
  const htmlPart = [
    `<p>${escapeHtml(ctx.requesterName)} hat eine Fahrzeug-Reservierung eingereicht:</p>`,
    '<ul>',
    `<li>Fahrzeug: ${escapeHtml(ctx.vehicleTaktischeBezeichnung)} (${escapeHtml(ctx.vehicleKennzeichen)})</li>`,
    `<li>Zeitraum: ${escapeHtml(range)}</li>`,
    ctx.details ? `<li>Details: ${escapeHtml(ctx.details)}</li>` : '',
    '</ul>',
    '<p>',
    `<a href="${genehmigenLink}" style="display:inline-block;background:#22a06b;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin-right:12px;">GENEHMIGT</a>`,
    `<a href="${ablehnenLink}" style="display:inline-block;background:#c62828;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">NICHT GENEHMIGT</a>`,
    '</p>',
  ].join('');

  for (const to of toEmails) {
    try {
      await sendEmail({ to, subject, textPart, htmlPart });
    } catch (error) {
      console.error('Freigabe-Anfrage-E-Mail für Fahrzeug-Reservierung fehlgeschlagen:', error);
    }
  }
}

/**
 * Ergebnis-Mail an den Ausborger (An:) mit Cc an die Freigabe-Adressen der Feuerwehr, damit sie
 * die getroffene Entscheidung ebenfalls sehen - genau wie vom Nutzer gefordert ("CC an die
 * hinterlegte email für Fahrzeug Reservierung"). Anders als bei der Freigabe-Anfrage oben bewusst
 * EIN gemeinsames Cc statt einer Schleife: das Sende-Ziel (To) ist immer derselbe eine Ausborger,
 * eine Schleife würde ihm die Ergebnis-Mail mehrfach zustellen. Die Freigabe-Adressen kennen sich
 * ohnehin bereits untereinander (dieselbe Feuerwehr-Verwaltungsrunde) - kein Privacy-Problem wie bei
 * fremden Foto-Upload-Empfängern.
 */
export async function sendVehicleBookingDecisionEmail(
  ctx: BookingEmailContext,
  decision: 'GENEHMIGT' | 'ABGELEHNT',
  ccEmails: string[],
  rejectionReason: string | null = null,
): Promise<void> {
  const range = formatRange(ctx.startsAt, ctx.endsAt);
  const decisionLabel = decision === 'GENEHMIGT' ? 'genehmigt' : 'abgelehnt';
  const showReason = decision === 'ABGELEHNT' && !!rejectionReason;

  await sendEmail({
    to: ctx.requesterEmail,
    toName: ctx.requesterName,
    cc: ccEmails.length > 0 ? ccEmails : undefined,
    subject: `Deine Fahrzeug-Reservierung wurde ${decisionLabel}: ${ctx.vehicleTaktischeBezeichnung}`,
    textPart: [
      `Deine Fahrzeug-Reservierung wurde ${decisionLabel}.`,
      '',
      `Fahrzeug: ${ctx.vehicleTaktischeBezeichnung} (${ctx.vehicleKennzeichen})`,
      `Zeitraum: ${range}`,
      showReason ? `Grund: ${rejectionReason}` : null,
      '',
      decision === 'GENEHMIGT'
        ? 'Die Reservierung ist jetzt im Kalender deiner Feuerwehr sichtbar.'
        : 'Das Fahrzeug ist für diesen Zeitraum weiterhin frei zum Reservieren.',
    ]
      .filter((line) => line !== null)
      .join('\n'),
    htmlPart: [
      `<p>Deine Fahrzeug-Reservierung wurde <strong>${decisionLabel}</strong>.</p>`,
      '<ul>',
      `<li>Fahrzeug: ${escapeHtml(ctx.vehicleTaktischeBezeichnung)} (${escapeHtml(ctx.vehicleKennzeichen)})</li>`,
      `<li>Zeitraum: ${escapeHtml(range)}</li>`,
      showReason ? `<li>Grund: ${escapeHtml(rejectionReason)}</li>` : '',
      '</ul>',
      `<p>${
        decision === 'GENEHMIGT'
          ? 'Die Reservierung ist jetzt im Kalender deiner Feuerwehr sichtbar.'
          : 'Das Fahrzeug ist für diesen Zeitraum weiterhin frei zum Reservieren.'
      }</p>`,
    ].join(''),
  });
}

interface AdminBookingEmailContext {
  startsAt: Date;
  endsAt: Date;
  details: string;
  vehicleTaktischeBezeichnung: string;
  vehicleKennzeichen: string;
  organizationLabel: string;
  adminName: string;
  driverName: string;
  driverEmail: string;
}

/**
 * Rein informative E-Mail an die für die Feuerwehr hinterlegten fahrzeugReservierungEmails, wenn
 * ein Admin stellvertretend für ein anderes Mitglied gebucht hat - keine Genehmigen/Ablehnen-Links,
 * da hier nichts zu entscheiden ist (die Reservierung ist bereits GENEHMIGT). Eine E-Mail PRO
 * Empfänger, nie ein gemeinsames To/Cc - dieselbe Regel wie sendVehicleBookingApprovalRequest. Jeder
 * Versand einzeln try/catch-abgesichert, die Funktion selbst wirft nie. Kein Versand, falls
 * toEmails leer ist (gleiches Verhalten wie beim bestehenden Genehmigungs-Anfrage-Pfad).
 */
export async function sendVehicleBookingAdminInfoEmail(ctx: AdminBookingEmailContext, toEmails: string[]): Promise<void> {
  if (toEmails.length === 0) return;

  const range = formatRange(ctx.startsAt, ctx.endsAt);
  const subject = `Fahrzeug reserviert: ${ctx.vehicleTaktischeBezeichnung} (${ctx.organizationLabel})`;
  const textPart = [
    `${ctx.adminName} hat eine Fahrzeug-Reservierung für ${ctx.driverName} angelegt (bereits genehmigt):`,
    '',
    `Fahrzeug: ${ctx.vehicleTaktischeBezeichnung} (${ctx.vehicleKennzeichen})`,
    `Zeitraum: ${range}`,
    ctx.details ? `Details: ${ctx.details}` : null,
  ]
    .filter((line) => line !== null)
    .join('\n');
  const htmlPart = [
    `<p>${escapeHtml(ctx.adminName)} hat eine Fahrzeug-Reservierung für ${escapeHtml(ctx.driverName)} angelegt (bereits genehmigt):</p>`,
    '<ul>',
    `<li>Fahrzeug: ${escapeHtml(ctx.vehicleTaktischeBezeichnung)} (${escapeHtml(ctx.vehicleKennzeichen)})</li>`,
    `<li>Zeitraum: ${escapeHtml(range)}</li>`,
    ctx.details ? `<li>Details: ${escapeHtml(ctx.details)}</li>` : '',
    '</ul>',
  ].join('');

  for (const to of toEmails) {
    try {
      await sendEmail({ to, subject, textPart, htmlPart });
    } catch (error) {
      console.error('Info-E-Mail für stellvertretende Fahrzeug-Reservierung fehlgeschlagen:', error);
    }
  }
}

/**
 * Benachrichtigt das Mitglied, für das ein Admin stellvertretend gebucht hat - verhindert, dass
 * jemand erst im Kalender entdeckt, dass für ihn ein Fahrzeug reserviert wurde. Best-effort wie
 * jeder andere E-Mail-Versand in diesem Modul, wirft nie. Enthält bewusst KEIN `details` - dieses
 * Feld ist laut der bestehenden Konvention (siehe VehicleBooking.details in
 * meine-feuerwehr/CLAUDE.md) admin-only, der Fahrer sieht es an keiner anderen Stelle der App.
 */
export async function sendVehicleBookingDriverNotificationEmail(ctx: AdminBookingEmailContext): Promise<void> {
  const range = formatRange(ctx.startsAt, ctx.endsAt);

  try {
    await sendEmail({
      to: ctx.driverEmail,
      toName: ctx.driverName,
      subject: `Für dich wurde ein Fahrzeug reserviert: ${ctx.vehicleTaktischeBezeichnung}`,
      textPart: [
        `${ctx.adminName} hat für dich eine Fahrzeug-Reservierung angelegt.`,
        '',
        `Fahrzeug: ${ctx.vehicleTaktischeBezeichnung} (${ctx.vehicleKennzeichen})`,
        `Zeitraum: ${range}`,
        '',
        'Die Reservierung ist bereits genehmigt und im Kalender deiner Feuerwehr sichtbar.',
      ].join('\n'),
      htmlPart: [
        `<p>${escapeHtml(ctx.adminName)} hat für dich eine Fahrzeug-Reservierung angelegt.</p>`,
        '<ul>',
        `<li>Fahrzeug: ${escapeHtml(ctx.vehicleTaktischeBezeichnung)} (${escapeHtml(ctx.vehicleKennzeichen)})</li>`,
        `<li>Zeitraum: ${escapeHtml(range)}</li>`,
        '</ul>',
        '<p>Die Reservierung ist bereits genehmigt und im Kalender deiner Feuerwehr sichtbar.</p>',
      ].join(''),
    });
  } catch (error) {
    console.error('Benachrichtigungs-E-Mail an Fahrer für stellvertretende Fahrzeug-Reservierung fehlgeschlagen:', error);
  }
}
