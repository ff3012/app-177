'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { dismissReportReminder } from '@/app/(app)/meine-feuerwehr/actions';

export interface VehicleReportReminderData {
  bookingId: string;
  vehicleId: string;
  vehicleLabel: string;
  startsAt: string;
  endsAt: string;
}

/**
 * "Zu erledigen"-Karte auf der Startseite: "Erstelle einen Tätigkeitsbericht für die Fahrzeug
 * Reservierung", ab Start-Zeitpunkt der Buchung. Kein Entwurf-Konzept - beide Buttons rufen
 * dieselbe dismissReportReminder auf (blendet die Karte dauerhaft aus), "Bericht erstellen"
 * navigiert zusätzlich zum Assistenten, vorbefüllt mit Fahrzeug/Zeitraum dieser Buchung.
 */
export function VehicleReportReminderCard({ reminder }: { reminder: VehicleReportReminderData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleCreateReport() {
    startTransition(async () => {
      await dismissReportReminder(reminder.bookingId);
      const params = new URLSearchParams({
        type: 'ACTIVITY',
        vehicleId: reminder.vehicleId,
        startAt: reminder.startsAt,
        endAt: reminder.endsAt,
      });
      router.push(`/meine-feuerwehr/berichte/neu?${params.toString()}`);
    });
  }

  function handleDone() {
    startTransition(async () => {
      await dismissReportReminder(reminder.bookingId);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-white p-4 shadow-sm">
      <p className="text-[14px] text-[#1c1c1e]">
        Erstelle einen Tätigkeitsbericht für die Fahrzeug Reservierung
        <span className="block text-[13px] text-neutral-500">
          {reminder.vehicleLabel} · {new Date(reminder.startsAt).toLocaleDateString('de-AT')} ·{' '}
          {new Date(reminder.startsAt).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={handleCreateReport}
          className="h-10 rounded-lg bg-[#1b7a52] text-sm font-semibold text-white disabled:opacity-60"
        >
          Bericht erstellen
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={handleDone}
          className="h-10 rounded-lg bg-[#c26a1d] text-sm font-semibold text-white disabled:opacity-60"
        >
          Erledigt
        </button>
      </div>
    </div>
  );
}
