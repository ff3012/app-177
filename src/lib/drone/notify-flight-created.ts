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

/**
 * `notificationEmails` kommt jetzt vom Aufrufer (DroneGroup.flightNotificationEmails der Gruppe, zu
 * der der Flug gehört) statt hier selbst aus der (mittlerweile entfernten) AppSettings-Singleton-
 * Spalte gelesen zu werden - jeder Aufrufer hat die DroneGroup-Zeile ohnehin schon für andere Zwecke
 * geladen, siehe CLAUDE.md. War ursprünglich eine einzelne optionale Adresse, jetzt ein Array (siehe
 * Kommentar auf DroneGroup.flightNotificationEmails) - eine E-Mail PRO Empfänger statt eines
 * gemeinsamen To/Cc, dieselbe Regel wie notifyPhotoUploadCreated, damit kein Empfänger die Adressen
 * der anderen zu sehen bekommt. Jeder Versand ist einzeln try/catch-abgesichert.
 */
export async function notifyDroneFlightCreated(
  flight: NewFlightForNotification,
  notificationEmails: string[],
): Promise<void> {
  if (notificationEmails.length === 0) return;

  const dateLabel = flight.startsAt.toLocaleString('de-AT', { dateStyle: 'medium', timeStyle: 'short' });
  const purposeLabel = PURPOSE_LABEL[flight.purpose] ?? flight.purpose;
  const pilotName = `${flight.pilotUser.firstName} ${flight.pilotUser.lastName}`;
  const registeredByName = `${flight.registeredBy.firstName} ${flight.registeredBy.lastName}`;

  const subject = `Neuer Drohnenflug: ${pilotName} am ${dateLabel}`;
  const textPart = [
    'Ein neuer Drohnenflug wurde registriert.',
    '',
    `Datum/Uhrzeit: ${dateLabel}`,
    `Pilot: ${pilotName}`,
    `Ort: ${flight.location}`,
    `Drohne: ${flight.drone.name}`,
    `Zweck: ${purposeLabel}`,
    `Erfasst von: ${registeredByName}`,
  ].join('\n');
  const htmlPart = `<p>Ein neuer Drohnenflug wurde registriert.</p><ul>
    <li><b>Datum/Uhrzeit:</b> ${escapeHtml(dateLabel)}</li>
    <li><b>Pilot:</b> ${escapeHtml(pilotName)}</li>
    <li><b>Ort:</b> ${escapeHtml(flight.location)}</li>
    <li><b>Drohne:</b> ${escapeHtml(flight.drone.name)}</li>
    <li><b>Zweck:</b> ${escapeHtml(purposeLabel)}</li>
    <li><b>Erfasst von:</b> ${escapeHtml(registeredByName)}</li>
  </ul>`;

  for (const to of notificationEmails) {
    try {
      await sendEmail({ to, subject, textPart, htmlPart });
    } catch (error) {
      console.error('Benachrichtigung für neuen Drohnenflug fehlgeschlagen:', error);
    }
  }
}
