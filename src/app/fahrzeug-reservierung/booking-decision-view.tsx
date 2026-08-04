import { decideVehicleBooking } from '@/lib/heimatfeuerwehr/vehicle-booking-decision';

const STATUS_LABEL: Record<string, string> = {
  GENEHMIGT: 'genehmigt',
  ABGELEHNT: 'abgelehnt',
};

function formatRange(startsAt: Date, endsAt: Date): string {
  const day = startsAt.toLocaleDateString('de-AT');
  const start = startsAt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  const end = endsAt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${start}–${end}`;
}

/**
 * Von beiden Genehmigen-/Ablehnen-Routen genutzt (fahrzeug-reservierung/{genehmigen,ablehnen}/[token])
 * - vollständig session-los, der Token selbst ist die Berechtigung. Trifft die Entscheidung direkt
 * beim Laden (ein Klick auf den E-Mail-Link reicht) statt einen zusätzlichen Bestätigen-Schritt zu
 * verlangen - siehe den ausführlichen Kommentar auf decideVehicleBooking() für die bewusste
 * Abweichung vom sonst üblichen "expliziter Klick statt Auto-GET"-Muster und wie der atomare
 * Statuswechsel trotzdem doppelte Verarbeitung verhindert.
 */
export async function BookingDecisionView({ token, mode }: { token: string; mode: 'genehmigen' | 'ablehnen' }) {
  const decision = mode === 'genehmigen' ? 'GENEHMIGT' : 'ABGELEHNT';
  const outcome = await decideVehicleBooking(token, decision);

  let content: React.ReactNode;

  if (outcome.kind === 'invalid') {
    content = <p className="text-neutral-700">Dieser Link ist ungültig.</p>;
  } else if (outcome.kind === 'already_decided') {
    content = (
      <p className="text-neutral-700">
        Diese Reservierung wurde bereits entschieden (Status: {STATUS_LABEL[outcome.status] ?? outcome.status}).
      </p>
    );
  } else {
    content = (
      <>
        <h1 className="mb-1 text-lg font-semibold text-neutral-900">
          Fahrzeug-Reservierung {STATUS_LABEL[outcome.status]}
        </h1>
        <p className="mb-6 text-sm text-neutral-500">
          {outcome.status === 'GENEHMIGT'
            ? 'Die Reservierung erscheint jetzt im Kalender der Feuerwehr.'
            : 'Das Fahrzeug bleibt für diesen Zeitraum frei zum Reservieren.'}
        </p>
        <dl className="flex flex-col gap-2 text-sm text-neutral-700">
          <div>
            <dt className="font-medium text-neutral-900">Fahrzeug</dt>
            <dd>{outcome.vehicleLabel}</dd>
          </div>
          <div>
            <dt className="font-medium text-neutral-900">Reserviert von</dt>
            <dd>{outcome.requesterName}</dd>
          </div>
          <div>
            <dt className="font-medium text-neutral-900">Zeitraum</dt>
            <dd>{formatRange(outcome.range.startsAt, outcome.range.endsAt)}</dd>
          </div>
          {outcome.details && (
            <div>
              <dt className="font-medium text-neutral-900">Details</dt>
              <dd className="whitespace-pre-wrap">{outcome.details}</dd>
            </div>
          )}
        </dl>
      </>
    );
  }

  return (
    <div className="pt-safe flex min-h-screen items-center justify-center bg-[#f6f6f7] px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow">{content}</div>
    </div>
  );
}
