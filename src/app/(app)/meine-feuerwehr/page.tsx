import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { isFinnentestActive, isUntersuchungActive } from '@/lib/heimatfeuerwehr/atemschutz-status';
import { cancelVehicleBooking } from './actions';

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-medium ${
        active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
      }`}
    >
      {active ? 'Aktiv' : 'Abgelaufen'}
    </span>
  );
}

function formatRange(startsAt: Date, endsAt: Date): string {
  const day = startsAt.toLocaleDateString('de-AT');
  const start = startsAt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  const end = endsAt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${start}–${end}`;
}

export default async function MeineFeuerwehrPage() {
  const user = await requireUser();
  const now = new Date();

  const [me, vehicles, myBookings] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        istAtemschutzgeraeteTraeger: true,
        atemschutzUntersuchungAm: true,
        atemschutzGueltigBis: true,
        atemschutzFinnentestAm: true,
      },
    }),
    prisma.vehicle.findMany({
      where: { organizationId: user.homeOrganizationId, isActive: true },
      orderBy: { taktischeBezeichnung: 'asc' },
      include: {
        bookings: {
          where: { endsAt: { gte: now } },
          orderBy: { startsAt: 'asc' },
          include: { user: { select: { firstName: true, lastName: true } } },
        },
      },
    }),
    prisma.vehicleBooking.findMany({
      where: { userId: user.id, endsAt: { gte: now } },
      orderBy: { startsAt: 'asc' },
      include: { vehicle: true },
    }),
  ]);

  const untersuchungActive = isUntersuchungActive(me.atemschutzGueltigBis);
  const finnentestActive = isFinnentestActive(me.atemschutzFinnentestAm);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold text-neutral-900">Meine Feuerwehr</h1>

      <div className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">Atemschutz</h2>
        <p className="text-sm text-neutral-700">
          Atemschutzgeräteträger:{' '}
          <strong className="font-medium">{me.istAtemschutzgeraeteTraeger ? 'Ja' : 'Nein'}</strong>
        </p>
        {me.istAtemschutzgeraeteTraeger && (
          <div className="mt-3 flex flex-col gap-2 text-sm text-neutral-700">
            <p className="flex flex-wrap items-center gap-2">
              Untersuchung <StatusBadge active={untersuchungActive} />
              <span className="text-neutral-500">
                {me.atemschutzUntersuchungAm
                  ? `zuletzt am ${me.atemschutzUntersuchungAm.toLocaleDateString('de-AT')}`
                  : 'noch kein Termin erfasst'}
                {me.atemschutzGueltigBis && `, gültig bis ${me.atemschutzGueltigBis.toLocaleDateString('de-AT')}`}
              </span>
            </p>
            <p className="flex flex-wrap items-center gap-2">
              Finnentest <StatusBadge active={finnentestActive} />
              <span className="text-neutral-500">
                {me.atemschutzFinnentestAm
                  ? `zuletzt am ${me.atemschutzFinnentestAm.toLocaleDateString('de-AT')}`
                  : 'noch kein Termin erfasst'}
              </span>
            </p>
          </div>
        )}
      </div>

      <div className="rounded-lg bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-900">Fuhrpark</h2>
          <Link
            href="/meine-feuerwehr/buchen"
            className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark"
          >
            Fahrzeug ausborgen
          </Link>
        </div>
        <div className="flex flex-col gap-3">
          {vehicles.map((vehicle) => (
            <div key={vehicle.id} className="rounded border border-neutral-200 p-3">
              <p className="font-medium text-neutral-900">{vehicle.taktischeBezeichnung}</p>
              <p className="text-xs text-neutral-500">
                {vehicle.marke} {vehicle.typ} · {vehicle.kennzeichen}
              </p>
              {vehicle.bookings.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-1 text-xs text-neutral-600">
                  {vehicle.bookings.map((booking) => (
                    <li key={booking.id}>
                      {formatRange(booking.startsAt, booking.endsAt)} – {booking.user.firstName}{' '}
                      {booking.user.lastName}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-neutral-400">Keine Buchungen</p>
              )}
            </div>
          ))}
          {vehicles.length === 0 && (
            <p className="text-sm text-neutral-500">Für deine Feuerwehr sind noch keine Fahrzeuge hinterlegt.</p>
          )}
        </div>
      </div>

      <div className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">Meine Buchungen</h2>
        {myBookings.length === 0 ? (
          <p className="text-sm text-neutral-500">Keine kommenden Buchungen.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-neutral-200">
            {myBookings.map((booking) => {
              const boundCancel = cancelVehicleBooking.bind(null, booking.id);
              return (
                <li key={booking.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span>
                    <span className="font-medium text-neutral-900">{booking.vehicle.taktischeBezeichnung}</span>{' '}
                    <span className="text-neutral-500">{formatRange(booking.startsAt, booking.endsAt)}</span>
                  </span>
                  <form action={boundCancel}>
                    <button type="submit" className="text-red-700 hover:underline">
                      Stornieren
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
