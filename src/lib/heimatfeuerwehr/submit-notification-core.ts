import { prisma } from '@/lib/db/prisma';
import { NOT_DEACTIVATED_WHERE } from '@/lib/auth/user-status';
import { isNotificationForm, notificationFormState } from './notification-form-constants';
import { getNotificationFormSettings } from './notification-form-settings';
import { validateNotificationInput, viennaToday } from './notification-input';
import { sendNotificationMails } from './notify-notification-form';

export interface SubmitNotificationResult {
  ok?: true;
  error?: string;
}

const UNAVAILABLE = 'Dieses Formular ist nicht verfügbar.';
const SEND_FAILED = 'Die Meldung konnte nicht gesendet werden. Bitte erneut versuchen.';

function formOf(input: unknown): unknown {
  return typeof input === 'object' && input !== null && !Array.isArray(input) ? (input as { form?: unknown }).form : undefined;
}

/**
 * Geteilter Kern der Meldeformulare (App, Sitzung, und Kiosk, Link). Der Aufrufer prüft die Berechtigung und liefert
 * organizationId und senderId - alles Übrige prüft diese Funktion serverseitig: Formular verfügbar (eingeschaltet UND
 * mindestens ein Empfänger), Absender aktives Mitglied genau dieser Feuerwehr, Felder. Es wird NICHTS gespeichert;
 * gesendet wird eine Mail je Empfänger. Scheitert der Versand an allen Empfängern, ist das ein Fehler (der Nutzer kann
 * es erneut versuchen), ein Teilausfall gilt als gesendet. Wirft nie nach außen.
 */
export async function submitNotificationCore(params: {
  organizationId: string;
  senderId: string;
  input: unknown;
  now?: Date;
}): Promise<SubmitNotificationResult> {
  const { organizationId, senderId, input } = params;
  const now = params.now ?? new Date();

  try {
    const form = formOf(input);
    if (!isNotificationForm(form)) return { error: UNAVAILABLE };

    const setting = (await getNotificationFormSettings(organizationId))[form];
    if (notificationFormState(setting) !== 'available') return { error: UNAVAILABLE };

    const sender = await prisma.user.findFirst({
      where: { id: senderId, homeOrganizationId: organizationId, ...NOT_DEACTIVATED_WHERE },
      select: { firstName: true, lastName: true, email: true },
    });
    if (!sender) return { error: 'Das ausgewählte Mitglied gehört nicht zu dieser Feuerwehr.' };

    const validated = validateNotificationInput(input, { products: setting.products, today: viennaToday(now) });
    if (!validated.ok) return { error: validated.error };

    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } });
    const result = await sendNotificationMails(
      {
        organizationName: organization.name,
        senderName: `${sender.firstName} ${sender.lastName}`,
        senderEmail: sender.email,
        sentAt: now,
        input: validated.value,
      },
      setting.recipients,
    );
    if (result.attempted > 0 && result.failed === result.attempted) return { error: SEND_FAILED };
    return { ok: true };
  } catch (error) {
    console.error('Meldung konnte nicht verarbeitet werden:', error instanceof Error ? error.message : 'unbekannter Fehler');
    return { error: SEND_FAILED };
  }
}
