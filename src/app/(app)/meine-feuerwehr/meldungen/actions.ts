'use server';

import { requireUser } from '@/lib/auth/session';
import { assertPermission, canCreateReportFor } from '@/lib/auth/permissions';
import { submitNotificationCore, type SubmitNotificationResult } from '@/lib/heimatfeuerwehr/submit-notification-core';

/**
 * Meldung (Getränkeautomat/Schadensmeldung) aus der App: angemeldetes Mitglied der Heimatfeuerwehr, Absender ist der
 * Benutzer selbst. Prüfung und Versand liegen im gemeinsamen Kern (submitNotificationCore).
 */
export async function submitNotification(input: unknown): Promise<SubmitNotificationResult> {
  const user = await requireUser();
  assertPermission(canCreateReportFor(user, user.homeOrganizationId));
  return submitNotificationCore({ organizationId: user.homeOrganizationId, senderId: user.id, input });
}
