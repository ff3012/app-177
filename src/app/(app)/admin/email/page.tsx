import { getDroneFlightNotificationEmail, getSystemCheckNotificationEmail } from '@/lib/settings';
import { AdminMobileTabs } from '@/components/admin/admin-mobile-tabs';
import { TestMailjetForm } from './test-mailjet-form';
import { DroneFlightEmailForm } from './drone-flight-email-form';
import { SystemCheckEmailForm } from './system-check-email-form';

// Admin-Gate läuft in admin/layout.tsx per notFound() - siehe Kommentar dort.
export default async function EmailVerwaltungPage() {
  const [droneFlightEmail, systemCheckEmail] = await Promise.all([
    getDroneFlightNotificationEmail(),
    getSystemCheckNotificationEmail(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[28px] font-bold text-ink">E-Mail</h1>

      <AdminMobileTabs />

      {/* Einspaltiges Formular, max. 640px (Verwaltung-Brief.md) - anders als die volle Breite der
          Tabellen-Seiten, da hier nur kurze Einzeilen-Formulare stehen und volle Breite unnötig
          lange Zeilenlängen erzeugen würde. */}
      <div className="flex max-w-[640px] flex-col gap-4">
        <div className="rounded-lg bg-surface p-4 shadow-card">
          <h2 className="mb-3 text-[15px] font-semibold text-ink">Drohnenflug E-Mail</h2>
          <DroneFlightEmailForm initialEmail={droneFlightEmail ?? ''} />
        </div>

        <div className="rounded-lg bg-surface p-4 shadow-card">
          <h2 className="mb-3 text-[15px] font-semibold text-ink">System Check E-Mail</h2>
          <SystemCheckEmailForm initialEmail={systemCheckEmail ?? ''} />
        </div>

        <div className="rounded-lg bg-surface p-4 shadow-card">
          <h2 className="mb-3 text-[15px] font-semibold text-ink">Mailjet-Integration testen</h2>
          <TestMailjetForm />
        </div>
      </div>
    </div>
  );
}
