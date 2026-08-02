import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { getExpiryStatus, getFinnentestExpiryDate, type AtemschutzExpiryStatus } from '@/lib/heimatfeuerwehr/atemschutz-status';
import { cancelVehicleBooking } from './actions';

const STATUS_LABEL: Record<AtemschutzExpiryStatus, string> = {
  aktiv: 'Aktiv',
  laeuft_bald_ab: 'Läuft bald ab',
  abgelaufen: 'Abgelaufen',
  keine_angabe: 'Keine Angabe',
};

const STATUS_CLASS: Record<AtemschutzExpiryStatus, string> = {
  aktiv: 'bg-green-100 text-green-800',
  laeuft_bald_ab: 'bg-amber-100 text-amber-800',
  abgelaufen: 'bg-red-100 text-red-800',
  keine_angabe: 'bg-neutral-100 text-neutral-600',
};

function StatusBadge({ status }: { status: AtemschutzExpiryStatus }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_CLASS[status]}`}>
      {STATUS_LABEL[status]}
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
      select: { id: true, taktischeBezeichnung: true, kennzeichen: true },
    }),
    prisma.vehicleBooking.findMany({
      where: { userId: user.id, endsAt: { gte: now } },
      orderBy: { startsAt: 'asc' },
      include: { vehicle: true },
    }),
  ]);

  const untersuchungStatus = getExpiryStatus(me.atemschutzGueltigBis);
  const finnentestStatus = getExpiryStatus(getFinnentestExpiryDate(me.atemschutzFinnentestAm));

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
              Untersuchung <StatusBadge status={untersuchungStatus} />
              <span className="text-neutral-500">
                {me.atemschutzUntersuchungAm
                  ? `zuletzt am ${me.atemschutzUntersuchungAm.toLocaleDateString('de-AT')}`
                  : 'noch kein Termin erfasst'}
                {me.atemschutzGueltigBis && `, gültig bis ${me.atemschutzGueltigBis.toLocaleDateString('de-AT')}`}
              </span>
            </p>
            <p className="flex flex-wrap items-center gap-2">
              Finnentest <StatusBadge status={finnentestStatus} />
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
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">Fuhrpark</h2>
        {vehicles.length === 0 ? (
          <p className="text-sm text-neutral-500">Für deine Feuerwehr sind noch keine Fahrzeuge hinterlegt.</p>
        ) : (
          <form action="/meine-feuerwehr/buchen" method="get" className="flex flex-wrap items-center gap-3">
            <select name="vehicleId" className="rounded border border-neutral-300 px-3 py-2 text-sm">
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.taktischeBezeichnung} ({vehicle.kennzeichen})
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark"
            >
              Ausborgen
            </button>
          </form>
        )}
      </div>

      <div className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">Meine Buchungen</h2>
        {myBookings.length === 0 ? (
          <p className="text-sm text-neutral-500">Keine kommenden Buchungen.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-neutral-200">
            {myBookings.map((booking) => {
              const boundCancel = async () => cancelVehicleBooking(booking.id);
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
