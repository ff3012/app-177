import { prisma } from '@/lib/db/prisma';
import { sendVehicleBookingDecisionEmail } from './notify-vehicle-booking';

interface BookingForDecision {
  id: string;
  userId: string;
  startsAt: Date;
  endsAt: Date;
  details: string | null;
  vehicle: {
    organizationId: string;
    taktischeBezeichnung: string;
    kennzeichen: string;
    organization: { name: string; shortName: string | null; fahrzeugReservierungEmail: string | null };
  };
  user: { firstName: string; lastName: string; email: string };
}

async function loadBookingForDecision(token: string): Promise<BookingForDecision | null> {
  return prisma.vehicleBooking.findUnique({
    where: { approvalToken: token },
    include: {
      vehicle: {
        include: { organization: { select: { name: true, shortName: true, fahrzeugReservierungEmail: true } } },
      },
      user: { select: { firstName: true, lastName: true, email: true } },
    },
  });
}

function buildEmailContext(booking: BookingForDecision, approvalToken: string) {
  return {
    approvalToken,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    details: booking.details ?? '',
    vehicleTaktischeBezeichnung: booking.vehicle.taktischeBezeichnung,
    vehicleKennzeichen: booking.vehicle.kennzeichen,
    organizationLabel: booking.vehicle.organization.shortName ?? booking.vehicle.organization.name,
    requesterName: `${booking.user.firstName} ${booking.user.lastName}`,
    requesterEmail: booking.user.email,
  };
}

export type VehicleBookingDecisionOutcome =
  | { kind: 'invalid' }
  | { kind: 'already_decided'; status: 'GENEHMIGT' | 'ABGELEHNT' }
  | {
      kind: 'decided';
      status: 'GENEHMIGT' | 'ABGELEHNT';
      vehicleLabel: string;
      requesterName: string;
      range: { startsAt: Date; endsAt: Date };
      details: string | null;
    };

/**
 * Trifft die Genehmigen/Ablehnen-Entscheidung für eine Fahrzeug-Reservierung - aufgerufen direkt
 * beim Laden der jeweiligen Seite (GET), nicht mehr über einen zusätzlichen Bestätigen-Klick auf
 * einer Zwischenseite (siehe CLAUDE.md "Fahrzeug-Reservierungen"-Abschnitt). Bewusste Abweichung
 * vom sonst in dieser Codebase etablierten "expliziter Klick statt Auto-GET"-Muster (Aktivierung/
 * Passwort-Reset/Login-Link) - auf
 * ausdrücklichen Wunsch, damit ein einziger Klick auf den E-Mail-Link reicht. Das bedeutet: ein
 * E-Mail-Link-Scanner, der Links vorab automatisch abruft (z. B. Microsoft Safe Links, Mimecast),
 * KÖNNTE die Entscheidung theoretisch selbst auslösen, bevor der Mensch den Link überhaupt öffnet -
 * ein bewusst akzeptiertes Risiko für diesen Anwendungsfall (interne Freigabe, kein Passwort-Reset).
 *
 * Der Statuswechsel bleibt trotzdem atomar (updateMany mit status: 'OFFEN' in der WHERE-Klausel,
 * dasselbe TOCTOU-Muster wie consumeToken() in lib/auth/tokens.ts) - genau EIN Aufruf gewinnt, egal
 * ob die Konkurrenz durch einen echten Doppelklick, einen Link-Scanner-Prefetch gefolgt vom
 * menschlichen Klick, oder sonst eine gleichzeitige Anfrage entsteht. Nur der Gewinner legt den
 * Termin an (bei GENEHMIGT) und verschickt die Ergebnis-Mail; jeder weitere Aufruf für denselben
 * Token bekommt lediglich den bereits gespeicherten Status zurück, ohne irgendetwas erneut zu tun.
 */
export async function decideVehicleBooking(
  token: string,
  decision: 'GENEHMIGT' | 'ABGELEHNT',
): Promise<VehicleBookingDecisionOutcome> {
  const claimed = await prisma.vehicleBooking.updateMany({
    where: { approvalToken: token, status: 'OFFEN' },
    data: { status: decision },
  });

  if (claimed.count === 0) {
    const existing = await prisma.vehicleBooking.findUnique({ where: { approvalToken: token }, select: { status: true } });
    if (!existing || existing.status === 'OFFEN') return { kind: 'invalid' };
    return { kind: 'already_decided', status: existing.status as 'GENEHMIGT' | 'ABGELEHNT' };
  }

  const booking = await loadBookingForDecision(token);
  if (!booking) return { kind: 'invalid' };

  if (decision === 'GENEHMIGT') {
    await prisma.event.create({
      data: {
        title: `Fahrzeug: ${booking.vehicle.taktischeBezeichnung} (${booking.user.firstName} ${booking.user.lastName})`,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        organizationId: booking.vehicle.organizationId,
        isSectionWide: false,
        category: 'ALLGEMEIN',
        createdById: booking.userId,
        vehicleBookingId: booking.id,
      },
    });
  }

  try {
    await sendVehicleBookingDecisionEmail(buildEmailContext(booking, token), decision, booking.vehicle.organization.fahrzeugReservierungEmail);
  } catch (error) {
    console.error(`Ergebnis-E-Mail (${decision === 'GENEHMIGT' ? 'genehmigt' : 'abgelehnt'}) für Fahrzeug-Reservierung fehlgeschlagen:`, error);
  }

  // Kein revalidatePath() hier: diese Funktion läuft während des Renderns einer öffentlichen Seite
  // (GET), nicht in einer Server Action/einem Route Handler - Next.js verbietet revalidatePath()
  // explizit während des Renderns ("used during render which is unsupported"). Nicht nötig ist es
  // ohnehin: /meine-feuerwehr, /kalender und /admin/heimatfeuerwehr werden bei jedem echten
  // Seitenaufruf (frischer Tab, externer Link, harter Reload) dynamisch neu von der DB gerendert -
  // nur eine bereits im Client-Router-Cache liegende Ansicht könnte kurz veraltet bleiben, bis sie
  // neu geladen wird.

  return {
    kind: 'decided',
    status: decision,
    vehicleLabel: `${booking.vehicle.taktischeBezeichnung} (${booking.vehicle.kennzeichen})`,
    requesterName: `${booking.user.firstName} ${booking.user.lastName}`,
    range: { startsAt: booking.startsAt, endsAt: booking.endsAt },
    details: booking.details,
  };
}
