import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { computeVehicleTodayStatus, type VehicleTodayStatus } from '@/lib/heimatfeuerwehr/vehicle-today-status';

function formatTime(date: Date): string {
  return date.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
}

/** Farben/Text je Status (Fahrzeug-reservieren-Brief.md §2, Statustabelle) - wortgetreue Hex-Werte. */
function statusDisplay(status: VehicleTodayStatus): { color: string; textColor: string; label: string } {
  switch (status.kind) {
    case 'frei':
      return { color: '#22a06b', textColor: '#1b7a52', label: 'Heute frei' };
    case 'ab':
      return { color: '#f0a92c', textColor: '#8a6113', label: `ab ${formatTime(status.time)} belegt` };
    case 'bis':
      return { color: '#f0a92c', textColor: '#8a6113', label: `bis ${formatTime(status.time)} belegt` };
    case 'belegt':
      return { color: '#c62828', textColor: '#a33530', label: 'heute belegt' };
  }
}

/**
 * "Fahrzeug wählen" (Fahrzeug-reservieren-Brief.md §2) - Zweispalten-Raster, ein Button pro Fahrzeug
 * mit nur Bezeichnung + heutigem Status, kein Kennzeichen/Typ/Marke. Tap führt zum bestehenden
 * Reservierungsformular mit vorbelegtem Fahrzeug (§3) - der eigentliche Reservierungsprozess
 * (Überschneidungsprüfung, Speichern) ist hier unverändert, diese Seite ist nur ein neuer Einstieg.
 *
 * Außer-Dienst-Fahrzeuge (isActive: false) werden bewusst mit abgefragt und angezeigt (nicht aus der
 * Query gefiltert) - §5's Abnahmekriterium "Außer-Dienst-Fahrzeuge sind sichtbar, aber nicht
 * antippbar" verlangt das explizit, auch wenn §2's Fließtext knapper von "Status aktiv" spricht.
 */
export default async function FahrzeugWaehlenPage() {
  const user = await requireUser();
  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const vehicles = await prisma.vehicle.findMany({
    where: { organizationId: user.homeOrganizationId },
    orderBy: [{ sortOrder: 'asc' }, { taktischeBezeichnung: 'asc' }],
    select: { id: true, taktischeBezeichnung: true, isActive: true },
  });

  // Eine Abfrage für alle aktiven Fahrzeuge auf einmal, kein N+1 (§4).
  const activeVehicleIds = vehicles.filter((v) => v.isActive).map((v) => v.id);
  const bookings = activeVehicleIds.length
    ? await prisma.vehicleBooking.findMany({
        where: {
          vehicleId: { in: activeVehicleIds },
          status: { not: 'ABGELEHNT' },
          startsAt: { lt: endOfToday },
          endsAt: { gt: now },
        },
        select: { vehicleId: true, startsAt: true, endsAt: true },
      })
    : [];
  const bookingsByVehicle = new Map<string, { startsAt: Date; endsAt: Date }[]>();
  for (const booking of bookings) {
    const list = bookingsByVehicle.get(booking.vehicleId) ?? [];
    list.push(booking);
    bookingsByVehicle.set(booking.vehicleId, list);
  }

  const weekday = now.toLocaleDateString('de-AT', { weekday: 'long' });
  const dateLabel = now.toLocaleDateString('de-AT', { day: 'numeric', month: 'long' });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/meine-feuerwehr" className="text-sm font-medium text-brand">
          ‹ Meine Feuerwehr
        </Link>
        <h1 className="mt-2 text-[26px] font-bold text-[#1c1c1e]">Fahrzeug wählen</h1>
        <p className="text-[14px] text-[#6c6c70]">
          Status für heute, {weekday} {dateLabel}.
        </p>
      </div>

      {vehicles.length === 0 ? (
        <p className="text-sm text-neutral-500">Für deine Feuerwehr sind noch keine Fahrzeuge hinterlegt.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            {vehicles.map((vehicle) => {
              if (!vehicle.isActive) {
                return (
                  <div
                    key={vehicle.id}
                    aria-disabled="true"
                    className="flex min-h-[104px] flex-col overflow-hidden rounded-2xl bg-white opacity-60 shadow-sm"
                  >
                    <div className="h-1 bg-neutral-300" />
                    <div className="flex flex-1 flex-col justify-between p-4">
                      <span className="break-words text-2xl font-bold leading-tight text-[#1c1c1e]">
                        {vehicle.taktischeBezeichnung}
                      </span>
                      <span className="flex items-center gap-1.5 text-sm font-semibold text-neutral-400">
                        <span className="h-2 w-2 rounded-full bg-neutral-400" />
                        außer Dienst
                      </span>
                    </div>
                  </div>
                );
              }

              const status = computeVehicleTodayStatus(bookingsByVehicle.get(vehicle.id) ?? [], now, endOfToday);
              const { color, textColor, label } = statusDisplay(status);
              return (
                <Link
                  key={vehicle.id}
                  href={`/meine-feuerwehr/buchen?vehicleId=${vehicle.id}`}
                  className="flex min-h-[104px] flex-col overflow-hidden rounded-2xl bg-white shadow-sm"
                >
                  <div className="h-1" style={{ backgroundColor: color }} />
                  <div className="flex flex-1 flex-col justify-between p-4">
                    <span className="break-words text-2xl font-bold leading-tight text-[#1c1c1e]">
                      {vehicle.taktischeBezeichnung}
                    </span>
                    <span className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: textColor }}>
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                      {label}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
          <p className="text-xs text-neutral-500">
            Der Status gilt für heute. Freie Zeiten für andere Tage wählst du im nächsten Schritt.
          </p>
        </>
      )}
    </div>
  );
}
