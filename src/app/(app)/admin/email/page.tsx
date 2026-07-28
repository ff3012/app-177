import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { isSiteAdmin } from '@/lib/auth/permissions';
import { getDroneFlightNotificationEmail } from '@/lib/settings';
import { TestMailjetForm } from './test-mailjet-form';
import { DroneFlightEmailForm } from './drone-flight-email-form';

export default async function EmailVerwaltungPage() {
  const user = await requireUser();
  if (!isSiteAdmin(user)) {
    return <p className="text-neutral-700">Dieser Bereich ist nur für die Abschnittskommando-Verwaltung sichtbar.</p>;
  }

  const droneFlightEmail = await getDroneFlightNotificationEmail();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900">E-Mail</h1>
        <div className="flex flex-wrap gap-4 text-sm">
          <Link href="/admin/benutzer" className="text-brand hover:underline">
            Zur Benutzerverwaltung
          </Link>
          <Link href="/admin/drohnen" className="text-brand hover:underline">
            Drohnen verwalten
          </Link>
        </div>
      </div>

      <div className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">Drohnenflug E-Mail</h2>
        <DroneFlightEmailForm initialEmail={droneFlightEmail ?? ''} />
      </div>

      <div className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">Mailjet-Integration testen</h2>
        <TestMailjetForm />
      </div>
    </div>
  );
}
