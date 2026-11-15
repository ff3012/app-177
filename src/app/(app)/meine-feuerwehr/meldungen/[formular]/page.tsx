import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canCreateReportFor } from '@/lib/auth/permissions';
import { formFromSlug, notificationFormState } from '@/lib/heimatfeuerwehr/notification-form-constants';
import { getNotificationFormSetting } from '@/lib/heimatfeuerwehr/notification-form-settings';
import { MeldungClient } from './meldung-client';

/** Meldeformular (Getränkeautomat/Schadensmeldung) für angemeldete Mitglieder. 404, wenn das Formular unbekannt, abgeschaltet oder ohne Empfänger ist. */
export default async function MeldungPage({ params }: { params: Promise<{ formular: string }> }) {
  const user = await requireUser();
  assertPermission(canCreateReportFor(user, user.homeOrganizationId));

  const { formular } = await params;
  const form = formFromSlug(formular);
  if (!form) notFound();

  const setting = await getNotificationFormSetting(user.homeOrganizationId, form);
  if (notificationFormState(setting) !== 'available') notFound();

  return <MeldungClient form={form} products={setting.products} />;
}
