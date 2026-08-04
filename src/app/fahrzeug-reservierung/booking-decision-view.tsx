import {
  decideVehicleBooking,
  previewVehicleBookingRejection,
  type VehicleBookingDecisionOutcome,
} from '@/lib/heimatfeuerwehr/vehicle-booking-decision';
import { submitRejection } from './ablehnen/[token]/actions';

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

function renderOutcome(outcome: VehicleBookingDecisionOutcome): React.ReactNode {
  if (outcome.kind === 'invalid') {
    return <p className="text-neutral-700">Dieser Link ist ungültig.</p>;
  }

  if (outcome.kind === 'already_decided') {
    return (
      <>
        <p className="text-neutral-700">
          Diese Reservierung wurde bereits entschieden (Status: {STATUS_LABEL[outcome.status] ?? outcome.status}).
        </p>
        {outcome.status === 'ABGELEHNT' && outcome.rejectionReason && (
          <p className="mt-2 text-sm text-neutral-500 whitespace-pre-wrap">Grund: {outcome.rejectionReason}</p>
        )}
      </>
    );
  }

  return (
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
        {outcome.status === 'ABGELEHNT' && outcome.rejectionReason && (
          <div>
            <dt className="font-medium text-neutral-900">Grund</dt>
            <dd className="whitespace-pre-wrap">{outcome.rejectionReason}</dd>
          </div>
        )}
      </dl>
    </>
  );
}

/**
 * Von beiden Genehmigen-/Ablehnen-Routen genutzt (fahrzeug-reservierung/{genehmigen,ablehnen}/[token])
 * - vollständig session-los, der Token selbst ist die Berechtigung.
 *
 * Genehmigen trifft die Entscheidung weiterhin direkt beim Laden (ein Klick auf den E-Mail-Link
 * reicht) - siehe den ausführlichen Kommentar auf decideVehicleBooking() für die bewusste
 * Abweichung vom sonst üblichen "expliziter Klick statt Auto-GET"-Muster und wie der atomare
 * Statuswechsel trotzdem doppelte Verarbeitung verhindert.
 *
 * Ablehnen zeigt stattdessen zuerst einen Zwischenschritt (previewVehicleBookingRejection) mit
 * einem Formular, in dem der Fahrzeug-Admin optional einen Grund hinterlassen kann, bevor die
 * Ablehnung tatsächlich verarbeitet wird (submitRejection) - der Ausborger sieht diesen Grund dann
 * in der Ergebnis-Mail und in "Meine Reservierungen".
 */
export async function BookingDecisionView({ token, mode }: { token: string; mode: 'genehmigen' | 'ablehnen' }) {
  let content: React.ReactNode;

  if (mode === 'genehmigen') {
    const outcome = await decideVehicleBooking(token, 'GENEHMIGT');
    content = renderOutcome(outcome);
  } else {
    const preview = await previewVehicleBookingRejection(token);
    if (preview.kind === 'pending') {
      const boundSubmit = submitRejection.bind(null, token);
      content = (
        <>
          <h1 className="mb-1 text-lg font-semibold text-neutral-900">Fahrzeug-Reservierung ablehnen</h1>
          <p className="mb-4 text-sm text-neutral-500">
            Du kannst optional einen Grund angeben, warum das Fahrzeug in diesem Zeitraum nicht reserviert werden
            kann - der Ausborger erhält ihn mit der Ergebnis-Mail.
          </p>
          <dl className="mb-5 flex flex-col gap-2 text-sm text-neutral-700">
            <div>
              <dt className="font-medium text-neutral-900">Fahrzeug</dt>
              <dd>{preview.vehicleLabel}</dd>
            </div>
            <div>
              <dt className="font-medium text-neutral-900">Reserviert von</dt>
              <dd>{preview.requesterName}</dd>
            </div>
            <div>
              <dt className="font-medium text-neutral-900">Zeitraum</dt>
              <dd>{formatRange(preview.range.startsAt, preview.range.endsAt)}</dd>
            </div>
            {preview.details && (
              <div>
                <dt className="font-medium text-neutral-900">Details</dt>
                <dd className="whitespace-pre-wrap">{preview.details}</dd>
              </div>
            )}
          </dl>
          <form action={boundSubmit} className="flex flex-col gap-3">
            <label htmlFor="reason" className="text-sm font-medium text-neutral-900">
              Grund (optional)
            </label>
            <textarea
              id="reason"
              name="reason"
              rows={4}
              maxLength={500}
              placeholder="z. B. Fahrzeug ist zu diesem Zeitpunkt bereits im Einsatz"
              className="rounded border border-neutral-300 p-2 text-sm text-neutral-900 focus:border-brand focus:outline-none"
            />
            <button
              type="submit"
              className="rounded bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800"
            >
              Reservierung ablehnen
            </button>
          </form>
        </>
      );
    } else {
      content = renderOutcome(preview);
    }
  }

  return (
    <div className="pt-safe flex min-h-screen items-center justify-center bg-[#f6f6f7] px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow">{content}</div>
    </div>
  );
}
