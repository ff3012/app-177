import { requireUser } from '@/lib/auth/session';
import { isSiteAdmin } from '@/lib/auth/permissions';
import { getDroneFlightNotificationEmail, getSystemCheckNotificationEmail } from '@/lib/settings';
import { AdminNav } from '@/components/layout/admin-nav';
import { TestMailjetForm } from './test-mailjet-form';
import { DroneFlightEmailForm } from './drone-flight-email-form';
import { SystemCheckEmailForm } from './system-check-email-form';

export default async function EmailVerwaltungPage() {
  const user = await requireUser();
  if (!isSiteAdmin(user)) {
    return <p className="text-neutral-700">Dieser Bereich ist nur für die Abschnittskommando-Verwaltung sichtbar.</p>;
  }

  const [droneFlightEmail, systemCheckEmail] = await Promise.all([
    getDroneFlightNotificationEmail(),
    getSystemCheckNotificationEmail(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-3 text-lg font-semibold text-neutral-900">Verwaltung</h1>
        <AdminNav />
      </div>

      <div className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">Drohnenflug E-Mail</h2>
        <DroneFlightEmailForm initialEmail={droneFlightEmail ?? ''} />
      </div>

      <div className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">System Check E-Mail</h2>
        <SystemCheckEmailForm initialEmail={systemCheckEmail ?? ''} />
      </div>

      <div className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">Mailjet-Integration testen</h2>
        <TestMailjetForm />
      </div>
    </div>
  );
}
