import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { computeVehicleTodayStatus, type VehicleTodayStatus } from '@/lib/heimatfeuerwehr/vehicle-today-status';

interface VehicleForTile {
  id: string;
  taktischeBezeichnung: string;
  isActive: boolean;
}

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

/** Zieht bis zu `limit` zuletzt vom Benutzer selbst reservierte, noch aktive Fahrzeuge - neueste
 * zuerst, ohne Duplikate. Exakt dasselbe "Zuletzt verwendet"-Muster wie ActivityKindPicker/
 * getRecentActivityKinds (neu/page.tsx), nur über VehicleBooking statt Report.activityKinds. Ein
 * inzwischen außer Dienst gestelltes oder gelöschtes Fahrzeug fällt automatisch heraus (gefiltert
 * gegen die bereits geladene, aktive Fahrzeugliste), statt als toter Schnellzugriff stehen zu bleiben. */
function getRecentVehicleIds(bookings: { vehicleId: string }[], activeVehicleIds: Set<string>, limit: number): string[] {
  const seen = new Set<string>();
  for (const booking of bookings) {
    if (!activeVehicleIds.has(booking.vehicleId)) continue;
    seen.add(booking.vehicleId);
    if (seen.size >= limit) break;
  }
  return [...seen];
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
 *
 * "Zuletzt verwendet" (Follow-up-Wunsch): die bis zu 3 zuletzt vom Benutzer selbst reservierten
 * Fahrzeuge erscheinen zusätzlich in einer eigenen Sektion oben - ein häufig genutztes Fahrzeug
 * taucht damit automatisch als Schnellzugriff auf, sobald es auch das zuletzt verwendete ist.
 * Erscheint bewusst ZUSÄTZLICH, nicht als Ersatz - dieselbe Kachel steht danach unverändert auch
 * weiter unten in "Alle Fahrzeuge" (identisch zum Duplikat-Verhalten von ActivityKindPicker).
 */
export default async function FahrzeugWaehlenPage() {
  const user = await requireUser();
  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const [vehicles, recentBookings] = await Promise.all([
    prisma.vehicle.findMany({
      where: { organizationId: user.homeOrganizationId },
      orderBy: [{ sortOrder: 'asc' }, { taktischeBezeichnung: 'asc' }],
      select: { id: true, taktischeBezeichnung: true, isActive: true },
    }),
    prisma.vehicleBooking.findMany({
      where: { userId: user.id, status: { not: 'ABGELEHNT' } },
      orderBy: { startsAt: 'desc' },
      take: 20,
      select: { vehicleId: true },
    }),
  ]);

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

  const recentVehicleIds = getRecentVehicleIds(recentBookings, new Set(activeVehicleIds), 3);
  const vehiclesById = new Map(vehicles.map((v) => [v.id, v]));
  const recentVehicles = recentVehicleIds.map((id) => vehiclesById.get(id)!).filter(Boolean);

  const weekday = now.toLocaleDateString('de-AT', { weekday: 'long' });
  const dateLabel = now.toLocaleDateString('de-AT', { day: 'numeric', month: 'long' });

  function renderTile(vehicle: VehicleForTile) {
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
          <span className="break-words text-2xl font-bold leading-tight text-[#1c1c1e]">{vehicle.taktischeBezeichnung}</span>
          <span className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: textColor }}>
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
            {label}
          </span>
        </div>
      </Link>
    );
  }

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
          {recentVehicles.length > 0 && (
            <div className="flex flex-col gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Zuletzt verwendet</h2>
              <div className="grid grid-cols-2 gap-2.5">{recentVehicles.map(renderTile)}</div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {recentVehicles.length > 0 && (
              <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Alle Fahrzeuge</h2>
            )}
            <div className="grid grid-cols-2 gap-2.5">{vehicles.map(renderTile)}</div>
          </div>

          <p className="text-xs text-neutral-500">
            Der Status gilt für heute. Freie Zeiten für andere Tage wählst du im nächsten Schritt.
          </p>
        </>
      )}
    </div>
  );
}
