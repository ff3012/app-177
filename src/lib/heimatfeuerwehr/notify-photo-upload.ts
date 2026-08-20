import { sendEmail } from '@/lib/email/mailjet';
import { escapeHtml } from '@/lib/email/escape-html';
import { PHOTO_UPLOAD_KIND_LABELS, type PHOTO_UPLOAD_KINDS } from '@/lib/validation/photo-upload.schema';

type NewPhotoUploadForNotification = {
  kind: (typeof PHOTO_UPLOAD_KINDS)[number];
  description: string;
  occurredOn: Date;
  createdByName: string;
  fireDepartment: { name: string };
};

/** GitHub Issue #19 - eine E-Mail pro Empfänger statt eines gemeinsamen To/Cc, damit kein Empfänger
 * die Adressen der anderen zu sehen bekommt (siehe Organization.photoUploadNotificationEmails). */
export async function notifyPhotoUploadCreated(
  photoUpload: NewPhotoUploadForNotification,
  recipientEmails: string[],
): Promise<void> {
  if (recipientEmails.length === 0) return;

  const kindLabel = PHOTO_UPLOAD_KIND_LABELS[photoUpload.kind];
  const dateLabel = photoUpload.occurredOn.toLocaleDateString('de-AT');
  const createdByName = photoUpload.createdByName;
  const subject = `Neuer Foto-Upload: ${kindLabel} — ${photoUpload.description}`;

  const textPart = [
    `Ein neuer Foto-Upload-Ordner wurde in ${photoUpload.fireDepartment.name} angelegt.`,
    '',
    `Anlass: ${kindLabel}`,
    `Beschreibung: ${photoUpload.description}`,
    `Datum: ${dateLabel}`,
    `Angelegt von: ${createdByName}`,
  ].join('\n');

  const htmlPart = `<p>Ein neuer Foto-Upload-Ordner wurde in ${escapeHtml(photoUpload.fireDepartment.name)} angelegt.</p><ul>
    <li><b>Anlass:</b> ${escapeHtml(kindLabel)}</li>
    <li><b>Beschreibung:</b> ${escapeHtml(photoUpload.description)}</li>
    <li><b>Datum:</b> ${escapeHtml(dateLabel)}</li>
    <li><b>Angelegt von:</b> ${escapeHtml(createdByName)}</li>
  </ul>`;

  for (const to of recipientEmails) {
    try {
      await sendEmail({ to, subject, textPart, htmlPart });
    } catch (error) {
      console.error('Benachrichtigung für neuen Foto-Upload fehlgeschlagen:', error);
    }
  }
}
