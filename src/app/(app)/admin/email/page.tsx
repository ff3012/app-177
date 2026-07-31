import { getDroneFlightNotificationEmail, getSystemCheckNotificationEmail } from '@/lib/settings';
import { TestMailjetForm } from './test-mailjet-form';
import { DroneFlightEmailForm } from './drone-flight-email-form';
import { SystemCheckEmailForm } from './system-check-email-form';

// Admin-Gate läuft jetzt in admin/layout.tsx per notFound() - siehe Kommentar dort.
export default async function EmailVerwaltungPage() {
  const [droneFlightEmail, systemCheckEmail] = await Promise.all([
    getDroneFlightNotificationEmail(),
    getSystemCheckNotificationEmail(),
  ]);

  return (
    <div className="flex flex-col gap-6">
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
