import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { isSiteAdmin } from '@/lib/auth/permissions';
import { getAdminNavItems } from '@/lib/admin/nav-items';
import { getDroneFlightNotificationEmail, getSystemCheckNotificationEmail } from '@/lib/settings';
import { AdminMobileTabs } from '@/components/admin/admin-mobile-tabs';
import { TestMailjetForm } from './test-mailjet-form';
import { DroneFlightEmailForm } from './drone-flight-email-form';
import { SystemCheckEmailForm } from './system-check-email-form';

// admin/layout.tsx's Gate deckt seit "Heimatfeuerwehr" auch reine Feuerwehr-Admins ab - diese
// Seite bleibt Site-Admin-only, daher die eigene Prüfung hier (Sicherheits-Härtung, siehe
// CLAUDE.md).
export default async function EmailVerwaltungPage() {
  const user = await requireUser();
  if (!isSiteAdmin(user)) {
    notFound();
  }

  const [droneFlightEmail, systemCheckEmail] = await Promise.all([
    getDroneFlightNotificationEmail(),
    getSystemCheckNotificationEmail(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[28px] font-bold text-ink">E-Mail</h1>

      <AdminMobileTabs items={getAdminNavItems(user)} />

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
