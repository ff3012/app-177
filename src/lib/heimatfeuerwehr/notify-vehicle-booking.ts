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
 * Freigabe-Anfrage an die für die Feuerwehr hinterlegte fahrzeugReservierungEmail, mit zwei
 * Buttons (GENEHMIGT / NICHT GENEHMIGT) - beides plain <a>-Links, die einen bestätigenden
 * Zwischenschritt öffnen (kein Auto-GET), exakt dieselbe Sicherheitsüberlegung wie bei
 * Aktivierungs-/Passwort-Reset-/Login-Links (ein E-Mail-Link-Scanner darf die Entscheidung nicht
 * versehentlich selbst treffen, indem er beim Öffnen der Mail automatisch alle Links abruft).
 */
export async function sendVehicleBookingApprovalRequest(ctx: BookingEmailContext, toEmail: string): Promise<void> {
  const genehmigenLink = `${baseUrl()}/fahrzeug-reservierung/genehmigen/${ctx.approvalToken}`;
  const ablehnenLink = `${baseUrl()}/fahrzeug-reservierung/ablehnen/${ctx.approvalToken}`;
  const range = formatRange(ctx.startsAt, ctx.endsAt);

  await sendEmail({
    to: toEmail,
    subject: `Neue Fahrzeug-Reservierung: ${ctx.vehicleTaktischeBezeichnung} (${ctx.organizationLabel})`,
    textPart: [
      `${ctx.requesterName} hat eine Fahrzeug-Reservierung eingereicht:`,
      '',
      `Fahrzeug: ${ctx.vehicleTaktischeBezeichnung} (${ctx.vehicleKennzeichen})`,
      `Zeitraum: ${range}`,
      ctx.details ? `Details: ${ctx.details}` : null,
      '',
      `Genehmigen: ${genehmigenLink}`,
      `Nicht genehmigen: ${ablehnenLink}`,
      '',
      'Abschnittsfeuerwehrkommando Purkersdorf',
    ]
      .filter((line) => line !== null)
      .join('\n'),
    htmlPart: [
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
      '<p>Abschnittsfeuerwehrkommando Purkersdorf</p>',
    ].join(''),
  });
}

/**
 * Ergebnis-Mail an den Ausborger (An:) mit Cc an die Freigabe-Adresse der Feuerwehr, damit sie
 * die getroffene Entscheidung ebenfalls sieht - genau wie vom Nutzer gefordert ("CC an die
 * hinterlegte email für Fahrzeug Reservierung").
 */
export async function sendVehicleBookingDecisionEmail(
  ctx: BookingEmailContext,
  decision: 'GENEHMIGT' | 'ABGELEHNT',
  ccEmail: string | null,
): Promise<void> {
  const range = formatRange(ctx.startsAt, ctx.endsAt);
  const decisionLabel = decision === 'GENEHMIGT' ? 'genehmigt' : 'abgelehnt';

  await sendEmail({
    to: ctx.requesterEmail,
    toName: ctx.requesterName,
    cc: ccEmail ? [ccEmail] : undefined,
    subject: `Deine Fahrzeug-Reservierung wurde ${decisionLabel}: ${ctx.vehicleTaktischeBezeichnung}`,
    textPart: [
      `Deine Fahrzeug-Reservierung wurde ${decisionLabel}.`,
      '',
      `Fahrzeug: ${ctx.vehicleTaktischeBezeichnung} (${ctx.vehicleKennzeichen})`,
      `Zeitraum: ${range}`,
      '',
      decision === 'GENEHMIGT'
        ? 'Die Reservierung ist jetzt im Kalender deiner Feuerwehr sichtbar.'
        : 'Das Fahrzeug ist für diesen Zeitraum weiterhin frei zum Reservieren.',
      '',
      'Abschnittsfeuerwehrkommando Purkersdorf',
    ].join('\n'),
    htmlPart: [
      `<p>Deine Fahrzeug-Reservierung wurde <strong>${decisionLabel}</strong>.</p>`,
      '<ul>',
      `<li>Fahrzeug: ${escapeHtml(ctx.vehicleTaktischeBezeichnung)} (${escapeHtml(ctx.vehicleKennzeichen)})</li>`,
      `<li>Zeitraum: ${escapeHtml(range)}</li>`,
      '</ul>',
      `<p>${
        decision === 'GENEHMIGT'
          ? 'Die Reservierung ist jetzt im Kalender deiner Feuerwehr sichtbar.'
          : 'Das Fahrzeug ist für diesen Zeitraum weiterhin frei zum Reservieren.'
      }</p>`,
      '<p>Abschnittsfeuerwehrkommando Purkersdorf</p>',
    ].join(''),
  });
}
