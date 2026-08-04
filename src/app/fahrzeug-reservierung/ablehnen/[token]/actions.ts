'use server';

import { redirect } from 'next/navigation';
import { decideVehicleBooking } from '@/lib/heimatfeuerwehr/vehicle-booking-decision';

const MAX_REASON_LENGTH = 500;

/**
 * Nimmt das Ablehnen-Formular entgegen (booking-decision-view.tsx, "pending"-Zweig) - anders als
 * Genehmigen ist Ablehnen kein reiner Auto-GET mehr, sondern braucht diesen expliziten
 * POST-Schritt, damit der Fahrzeug-Admin vorher optional einen Grund eintragen kann. Läuft nach
 * dem eigentlichen Ablehnen immer auf dieselbe Seite zurück - die zeigt dann (über
 * previewVehicleBookingRejection) den "bereits entschieden"-Zustand mit dem gespeicherten Grund an.
 */
export async function submitRejection(token: string, formData: FormData): Promise<void> {
  const rawReason = formData.get('reason');
  const reason = typeof rawReason === 'string' ? rawReason.trim().slice(0, MAX_REASON_LENGTH) : '';

  await decideVehicleBooking(token, 'ABGELEHNT', reason || null);

  redirect(`/fahrzeug-reservierung/ablehnen/${token}`);
}
