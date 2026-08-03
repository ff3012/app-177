import { prisma } from '@/lib/db/prisma';
import { approveVehicleBooking, rejectVehicleBooking } from '@/app/(app)/meine-feuerwehr/actions';

const STATUS_LABEL: Record<string, string> = {
  OFFEN: 'Offen',
  GENEHMIGT: 'Genehmigt',
  ABGELEHNT: 'Abgelehnt',
};

function formatRange(startsAt: Date, endsAt: Date): string {
  const day = startsAt.toLocaleDateString('de-AT');
  const start = startsAt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  const end = endsAt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${start}–${end}`;
}

/**
 * Von beiden Genehmigen-/Ablehnen-Routen genutzt (fahrzeug-reservierung/{genehmigen,ablehnen}/[token])
 * - vollständig session-los, der Token selbst ist die Berechtigung. Erfordert einen expliziten
 * Klick auf den Bestätigen-Button statt den Link automatisch beim Öffnen zu verarbeiten (kein
 * Auto-GET) - dieselbe Überlegung wie bei /login/token/[token]: ein E-Mail-Link-Scanner darf die
 * Entscheidung nicht versehentlich selbst treffen, indem er beim Prüfen der Mail automatisch alle
 * enthaltenen Links abruft.
 */
export async function BookingDecisionView({ token, mode }: { token: string; mode: 'genehmigen' | 'ablehnen' }) {
  const booking = await prisma.vehicleBooking.findUnique({
    where: { approvalToken: token },
    include: {
      vehicle: { select: { taktischeBezeichnung: true, kennzeichen: true } },
      user: { select: { firstName: true, lastName: true } },
    },
  });

  let content: React.ReactNode;

  if (!booking) {
    content = <p className="text-neutral-700">Dieser Link ist ungültig.</p>;
  } else if (booking.status !== 'OFFEN') {
    content = (
      <p className="text-neutral-700">
        Diese Reservierung wurde bereits entschieden (Status: {STATUS_LABEL[booking.status] ?? booking.status}).
      </p>
    );
  } else {
    const boundAction = mode === 'genehmigen' ? approveVehicleBooking.bind(null, token) : rejectVehicleBooking.bind(null, token);
    content = (
      <>
        <h1 className="mb-1 text-lg font-semibold text-neutral-900">
          Fahrzeug-Reservierung {mode === 'genehmigen' ? 'genehmigen' : 'ablehnen'}
        </h1>
        <p className="mb-6 text-sm text-neutral-500">
          {mode === 'genehmigen'
            ? 'Nach der Genehmigung erscheint die Reservierung im Kalender der Feuerwehr.'
            : 'Das Fahrzeug bleibt für diesen Zeitraum frei zum Reservieren.'}
        </p>
        <dl className="mb-6 flex flex-col gap-2 text-sm text-neutral-700">
          <div>
            <dt className="font-medium text-neutral-900">Fahrzeug</dt>
            <dd>
              {booking.vehicle.taktischeBezeichnung} ({booking.vehicle.kennzeichen})
            </dd>
          </div>
          <div>
            <dt className="font-medium text-neutral-900">Reserviert von</dt>
            <dd>
              {booking.user.firstName} {booking.user.lastName}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-neutral-900">Zeitraum</dt>
            <dd>{formatRange(booking.startsAt, booking.endsAt)}</dd>
          </div>
          {booking.details && (
            <div>
              <dt className="font-medium text-neutral-900">Details</dt>
              <dd className="whitespace-pre-wrap">{booking.details}</dd>
            </div>
          )}
        </dl>
        <form action={boundAction}>
          <button
            type="submit"
            className={`w-full rounded px-4 py-2 font-medium text-white hover:opacity-90 ${
              mode === 'genehmigen' ? 'bg-green-600' : 'bg-red-700'
            }`}
          >
            {mode === 'genehmigen' ? 'Ja, Reservierung genehmigen' : 'Ja, Reservierung ablehnen'}
          </button>
        </form>
      </>
    );
  }

  return (
    <div className="pt-safe flex min-h-screen items-center justify-center bg-[#f6f6f7] px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow">{content}</div>
    </div>
  );
}
