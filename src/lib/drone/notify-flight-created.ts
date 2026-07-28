import { getDroneFlightNotificationEmail } from '@/lib/settings';
import { sendEmail } from '@/lib/email/mailjet';
import { escapeHtml } from '@/lib/email/escape-html';

const PURPOSE_LABEL: Record<string, string> = {
  UEBUNG: 'Übung',
  EINSATZ: 'Einsatz',
};

type NewFlightForNotification = {
  startsAt: Date;
  location: string;
  purpose: string;
  drone: { name: string };
  pilotUser: { firstName: string; lastName: string };
  registeredBy: { firstName: string; lastName: string };
};

export async function notifyDroneFlightCreated(flight: NewFlightForNotification): Promise<void> {
  const recipient = await getDroneFlightNotificationEmail();
  if (!recipient) return;

  const dateLabel = flight.startsAt.toLocaleString('de-AT', { dateStyle: 'medium', timeStyle: 'short' });
  const purposeLabel = PURPOSE_LABEL[flight.purpose] ?? flight.purpose;
  const pilotName = `${flight.pilotUser.firstName} ${flight.pilotUser.lastName}`;
  const registeredByName = `${flight.registeredBy.firstName} ${flight.registeredBy.lastName}`;

  try {
    await sendEmail({
      to: recipient,
      subject: `Neuer Drohnenflug: ${pilotName} am ${dateLabel}`,
      textPart: [
        'Ein neuer Drohnenflug wurde registriert.',
        '',
        `Datum/Uhrzeit: ${dateLabel}`,
        `Pilot: ${pilotName}`,
        `Ort: ${flight.location}`,
        `Drohne: ${flight.drone.name}`,
        `Zweck: ${purposeLabel}`,
        `Erfasst von: ${registeredByName}`,
      ].join('\n'),
      htmlPart: `<p>Ein neuer Drohnenflug wurde registriert.</p><ul>
        <li><b>Datum/Uhrzeit:</b> ${escapeHtml(dateLabel)}</li>
        <li><b>Pilot:</b> ${escapeHtml(pilotName)}</li>
        <li><b>Ort:</b> ${escapeHtml(flight.location)}</li>
        <li><b>Drohne:</b> ${escapeHtml(flight.drone.name)}</li>
        <li><b>Zweck:</b> ${escapeHtml(purposeLabel)}</li>
        <li><b>Erfasst von:</b> ${escapeHtml(registeredByName)}</li>
      </ul>`,
    });
  } catch (error) {
    console.error('Benachrichtigung für neuen Drohnenflug fehlgeschlagen:', error);
  }
}
