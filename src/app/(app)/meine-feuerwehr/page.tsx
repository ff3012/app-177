import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManageEventsFor, canManageHeimatfeuerwehrFor, canViewDroneModule } from '@/lib/auth/permissions';
import { getExpiryStatus, getFinnentestExpiryDate, type AtemschutzExpiryStatus } from '@/lib/heimatfeuerwehr/atemschutz-status';
import {
  NINETY_DAY_REQUIRED_FLIGHTS,
  NINETY_DAY_WINDOW_DAYS,
  getNinetyDayCutoff,
  meetsNinetyDayRule,
} from '@/lib/drone/ninety-day-rule';
import { HomeTodoList, type HomeEventCardData, type StaticTodoItemData } from '@/components/home/home-todo-list';
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
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>
  );
}

const RESERVIERUNG_STATUS_LABEL: Record<string, string> = {
  OFFEN: 'Offen zur Genehmigung',
  GENEHMIGT: 'Genehmigt',
  ABGELEHNT: 'Abgelehnt',
};

const RESERVIERUNG_STATUS_CLASS: Record<string, string> = {
  OFFEN: 'bg-amber-100 text-amber-800',
  GENEHMIGT: 'bg-green-100 text-green-800',
  ABGELEHNT: 'bg-red-100 text-red-800',
};

function ReservierungStatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${RESERVIERUNG_STATUS_CLASS[status] ?? 'bg-neutral-100 text-neutral-600'}`}>
      {RESERVIERUNG_STATUS_LABEL[status] ?? status}
    </span>
  );
}

function formatRange(startsAt: Date, endsAt: Date): string {
  const day = startsAt.toLocaleDateString('de-AT');
  const start = startsAt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  const end = endsAt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${start}–${end}`;
}

// Eigenständiges, großzügigeres Fenster nur für den "Zu erledigen"-Hinweis auf dem Startbildschirm
// (Startbildschirm-Brief.md §1: "< 60 Tage gültig") - bewusst NICHT dasselbe wie
// ATEMSCHUTZ_WARNING_DAYS (30 Tage), das die Bernstein-Badges in der Heimatfeuerwehr-Verwaltung und
// die tägliche Sachbearbeiter-Warn-Mail steuert. Ein negativer Rest (bereits abgelaufen) erfüllt die
// Bedingung ebenfalls, absichtlich - ein abgelaufener Nachweis ist mindestens so dringend.
const ATEMSCHUTZ_TODO_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

function buildAtemschutzTodo(me: {
  istAtemschutzgeraeteTraeger: boolean;
  atemschutzGueltigBis: Date | null;
  atemschutzFinnentestAm: Date | null;
}): StaticTodoItemData | null {
  if (!me.istAtemschutzgeraeteTraeger) return null;
  const now = Date.now();

  const candidates: { label: string; expiry: Date }[] = [];
  if (me.atemschutzGueltigBis && me.atemschutzGueltigBis.getTime() - now < ATEMSCHUTZ_TODO_WINDOW_MS) {
    candidates.push({ label: 'Untersuchung läuft ab', expiry: me.atemschutzGueltigBis });
  }
  const finnentestExpiry = getFinnentestExpiryDate(me.atemschutzFinnentestAm);
  if (finnentestExpiry && finnentestExpiry.getTime() - now < ATEMSCHUTZ_TODO_WINDOW_MS) {
    candidates.push({ label: 'Finnentest läuft ab', expiry: finnentestExpiry });
  }
  if (candidates.length === 0) return null;

  // Bei zwei gleichzeitig knappen Fristen zeigt der Startbildschirm nur EINEN Eintrag (die
  // dringendere) - laut Brief-Tabelle "ein Eintrag pro Quelle", nicht pro Frist.
  candidates.sort((a, b) => a.expiry.getTime() - b.expiry.getTime());
  const soonest = candidates[0];
  const days = Math.ceil((soonest.expiry.getTime() - now) / (24 * 60 * 60 * 1000));
  const detail =
    days >= 0
      ? `Noch ${days} Tag${days === 1 ? '' : 'e'} · bis ${soonest.expiry.toLocaleDateString('de-AT')}`
      : `Seit ${Math.abs(days)} Tag${Math.abs(days) === 1 ? '' : 'en'} abgelaufen · ${soonest.expiry.toLocaleDateString('de-AT')}`;

  return {
    id: 'atemschutz',
    severity: 'amber',
    eyebrow: 'Atemschutz',
    title: soonest.label,
    detail,
    href: '/meine-feuerwehr#atemschutz-status',
  };
}

export default async function MeineFeuerwehrPage() {
  const user = await requireUser();
  const now = new Date();
  const in14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const droneMember = canViewDroneModule(user);

  const [me, candidateEventsRaw, vehicles, myBookings, orgFeatures] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        firstName: true,
        istAtemschutzgeraeteTraeger: true,
        atemschutzUntersuchungAm: true,
        atemschutzGueltigBis: true,
        atemschutzFinnentestAm: true,
      },
    }),
    // Gleiche Sichtbarkeitsregel wie kalender/page.tsx (eigene Feuerwehr ODER abschnittsweit) -
    // die DROHNENGRUPPE-Kategorie wird unten zusätzlich nach canViewDroneModule gefiltert, exakt
    // wie dort. `take: 8` ist ein großzügiger Pool für "Zu erledigen" (≤14 Tage) plus die "Als
    // Nächstes"-Anzeige (Top 2), nicht die tatsächliche Anzeigegrenze.
    prisma.event.findMany({
      where: {
        OR: [
          { organizationId: user.homeOrganizationId },
          {
            isSectionWide: true,
            organization: {
              OR: [{ id: user.homeAbschnittOrganizationId }, { parentId: user.homeAbschnittOrganizationId }],
            },
          },
        ],
        endsAt: { gte: now },
      },
      orderBy: { startsAt: 'asc' },
      take: 8,
      include: { organization: { select: { shortName: true, name: true } } },
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
    prisma.organization.findUniqueOrThrow({
      where: { id: user.homeOrganizationId },
      select: { featureAtemschutz: true },
    }),
  ]);

  const candidateEvents = candidateEventsRaw.filter((event) => event.category !== 'DROHNENGRUPPE' || droneMember);
  const candidateIds = candidateEvents.map((event) => event.id);
  const ownRsvps = candidateIds.length
    ? await prisma.terminZusage.findMany({
        where: { eventId: { in: candidateIds }, userId: user.id },
        select: { eventId: true, status: true },
      })
    : [];
  const ownStatusByEvent = new Map(ownRsvps.map((rsvp) => [rsvp.eventId, rsvp.status]));

  const eventCards: HomeEventCardData[] = await Promise.all(
    candidateEvents.map(async (event) => {
      const layer = event.category === 'DROHNENGRUPPE' ? 'drohnengruppe' : event.isSectionWide ? 'abschnitt' : 'own';
      const isVehicleBooking = event.vehicleBookingId !== null;
      const canManage = canManageEventsFor(user, event.organizationId);
      // Ein automatisch aus einer Fahrzeug-Buchung erzeugter Termin hat kein Zusage-Konzept - exakt
      // dieselbe Regel wie im Kalender-Modul selbst (kalender/[eventId]/page.tsx blendet dort
      // "Meine Zusage"/Teilnehmerliste komplett aus). Weder Buttons noch Team-Tally sind hier sinnvoll.
      let tally: HomeEventCardData['tally'] = null;
      if (canManage && !isVehicleBooking) {
        const [zugesagtCount, totalEligible] = await Promise.all([
          prisma.terminZusage.count({ where: { eventId: event.id, status: 'ZUGESAGT' } }),
          prisma.user.count({ where: { homeOrganizationId: event.organizationId, isActive: true } }),
        ]);
        tally = { zugesagt: zugesagtCount, offen: Math.max(totalEligible - zugesagtCount, 0) };
      }
      return {
        id: event.id,
        title: event.title,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        allDay: event.allDay,
        location: event.location,
        organizationName: event.organization.shortName ?? event.organization.name,
        layer,
        myStatus: isVehicleBooking ? null : ownStatusByEvent.get(event.id) ?? null,
        tally,
        isVehicleBooking,
      };
    }),
  );

  const rsvpTodos = eventCards.filter(
    (event) => event.startsAt.getTime() <= in14Days.getTime() && !event.myStatus && !event.isVehicleBooking,
  );
  const rsvpTodoIds = new Set(rsvpTodos.map((event) => event.id));
  const upcomingPool = eventCards.filter((event) => !rsvpTodoIds.has(event.id)).slice(0, 4);

  const staticTodos: StaticTodoItemData[] = [];
  const atemschutzTodo = orgFeatures.featureAtemschutz ? buildAtemschutzTodo(me) : null;
  if (atemschutzTodo) staticTodos.push(atemschutzTodo);

  let droneFlightCount = 0;
  let droneRuleMet = false;
  if (droneMember) {
    droneFlightCount = await prisma.droneFlight.count({
      where: { pilotUserId: user.id, startsAt: { gte: getNinetyDayCutoff() } },
    });
    droneRuleMet = meetsNinetyDayRule(droneFlightCount);
    if (!droneRuleMet) {
      staticTodos.push({
        id: 'ninetyday',
        severity: 'amber',
        eyebrow: '90-Tage-Regel',
        title: 'Zu wenige Flüge im 90-Tage-Fenster',
        detail: `${droneFlightCount} von ${NINETY_DAY_REQUIRED_FLIGHTS} Flügen in den letzten ${NINETY_DAY_WINDOW_DAYS} Tagen`,
        href: '/drohnen',
      });
    }
  }

  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const vehicleIds = vehicles.map((vehicle) => vehicle.id);
  const todaysBookings = vehicleIds.length
    ? await prisma.vehicleBooking.findMany({
        where: { vehicleId: { in: vehicleIds }, startsAt: { lt: endOfToday }, endsAt: { gt: now } },
        select: { vehicleId: true },
      })
    : [];
  const bookedTodayVehicleIds = new Set(todaysBookings.map((booking) => booking.vehicleId));
  const vehiclesFreeToday = vehicles.length - bookedTodayVehicleIds.size;

  let standDerWehr: {
    activeMemberCount: number;
    atemschutzExpiringCount: number;
    vehiclesBookedTodayCount: number;
    bookingsThisMonthCount: number;
  } | null = null;

  if (canManageHeimatfeuerwehrFor(user, user.homeOrganizationId)) {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const [activeMemberCount, traeger, bookingsThisMonthCount] = await Promise.all([
      prisma.user.count({ where: { homeOrganizationId: user.homeOrganizationId, isActive: true } }),
      orgFeatures.featureAtemschutz
        ? prisma.user.findMany({
            where: { homeOrganizationId: user.homeOrganizationId, isActive: true, istAtemschutzgeraeteTraeger: true },
            select: { atemschutzGueltigBis: true, atemschutzFinnentestAm: true },
          })
        : Promise.resolve([]),
      prisma.vehicleBooking.count({
        where: { vehicle: { organizationId: user.homeOrganizationId }, startsAt: { gte: startOfMonth, lt: endOfMonth } },
      }),
    ]);
    const atemschutzExpiringCount = traeger.filter((member) => {
      const untersuchung = getExpiryStatus(member.atemschutzGueltigBis);
      const finnentest = getExpiryStatus(getFinnentestExpiryDate(member.atemschutzFinnentestAm));
      return (
        (untersuchung !== 'aktiv' && untersuchung !== 'keine_angabe') ||
        (finnentest !== 'aktiv' && finnentest !== 'keine_angabe')
      );
    }).length;
    standDerWehr = {
      activeMemberCount,
      atemschutzExpiringCount,
      vehiclesBookedTodayCount: bookedTodayVehicleIds.size,
      bookingsThisMonthCount,
    };
  }

  const untersuchungStatus = getExpiryStatus(me.atemschutzGueltigBis);
  const finnentestStatus = getExpiryStatus(getFinnentestExpiryDate(me.atemschutzFinnentestAm));
  const greetingDate = now.toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const vehicleStatusLabel = vehicles.length === 0 ? 'Kein Fahrzeug hinterlegt' : `${vehiclesFreeToday} von ${vehicles.length} heute frei`;
  const droneStatusLabel = droneRuleMet ? '90 Tage erfüllt' : `${droneFlightCount} von ${NINETY_DAY_REQUIRED_FLIGHTS} Flügen`;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[27px] font-bold leading-tight text-[#1c1c1e]">Servus, {me.firstName}</h1>
        <p className="mt-1 text-[15px] text-[#6c6c70]">{greetingDate}</p>
      </div>

      <HomeTodoList rsvpTodos={rsvpTodos} staticTodos={staticTodos} upcomingPool={upcomingPool} />

      <div className={droneMember ? 'grid grid-cols-2 gap-2.5' : 'grid grid-cols-1 gap-2.5'}>
        <Link href="/meine-feuerwehr/buchen" className="flex min-h-[74px] flex-col justify-center gap-1 rounded-xl bg-white p-4 shadow-sm">
          <span className="text-[15px] font-semibold text-[#1c1c1e]">Fahrzeug Reservierungen</span>
          <span className="text-[13px] text-[#6c6c70]">{vehicleStatusLabel}</span>
        </Link>
        {droneMember && (
          <Link href="/drohnen/neu" className="flex min-h-[74px] flex-col justify-center gap-1 rounded-xl bg-white p-4 shadow-sm">
            <span className="text-[15px] font-semibold text-[#1c1c1e]">Flug registrieren</span>
            <span className={`text-[13px] ${droneRuleMet ? 'text-[#1b7a52]' : 'text-[#6c6c70]'}`}>{droneStatusLabel}</span>
          </Link>
        )}
      </div>

      {standDerWehr && (
        <div className="flex flex-col gap-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[#8e8e93]">Stand der Wehr</span>
          <div className={orgFeatures.featureAtemschutz ? 'grid grid-cols-2 gap-2.5' : 'grid grid-cols-1 gap-2.5'}>
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#8e8e93]">Mitglieder</div>
              <div className="flex items-baseline gap-1.5">
                <span className="font-condensed text-[28px] font-bold leading-none text-[#1c1c1e]">{standDerWehr.activeMemberCount}</span>
                <span className="text-[14px] text-[#6c6c70]">aktiv</span>
              </div>
            </div>
            {orgFeatures.featureAtemschutz && (
              <div className="rounded-xl bg-white p-4 shadow-sm">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#8e8e93]">Atemschutz</div>
                <div className="flex items-baseline gap-1.5">
                  <span
                    className={`font-condensed text-[28px] font-bold leading-none ${
                      standDerWehr.atemschutzExpiringCount > 0 ? 'text-[#8a6113]' : 'text-[#1c1c1e]'
                    }`}
                  >
                    {standDerWehr.atemschutzExpiringCount}
                  </span>
                  <span className="text-[14px] text-[#6c6c70]">laufen ab</span>
                </div>
              </div>
            )}
          </div>
          <Link href="/admin/heimatfeuerwehr" className="flex items-center justify-between gap-3 rounded-xl bg-white p-4 shadow-sm">
            <div className="min-w-0">
              <div className="mb-0.5 text-[16px] font-semibold text-[#1c1c1e]">Fuhrpark</div>
              <div className="text-[14px] text-[#6c6c70]">
                {standDerWehr.vehiclesBookedTodayCount} Fahrzeug{standDerWehr.vehiclesBookedTodayCount === 1 ? '' : 'e'} heute ausgeborgt ·{' '}
                {standDerWehr.bookingsThisMonthCount} Buchung{standDerWehr.bookingsThisMonthCount === 1 ? '' : 'en'} im Monat
              </div>
            </div>
            <span className="flex-none text-[22px] leading-none text-[#c9c9ce]">›</span>
          </Link>
        </div>
      )}

      {orgFeatures.featureAtemschutz && (
      <div id="atemschutz-status" className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">Atemschutz</h2>
        <p className="text-sm text-neutral-700">
          Atemschutzgeräteträger: <strong className="font-medium">{me.istAtemschutzgeraeteTraeger ? 'Ja' : 'Nein'}</strong>
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
      )}

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
            <button type="submit" className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark">
              Reservieren
            </button>
          </form>
        )}
      </div>

      <div className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">Meine Reservierungen</h2>
        {myBookings.length === 0 ? (
          <p className="text-sm text-neutral-500">Keine kommenden Reservierungen.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-neutral-200">
            {myBookings.map((booking) => {
              const boundCancel = cancelVehicleBooking.bind(null, booking.id, '/meine-feuerwehr');
              return (
                <li key={booking.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span>
                    <span className="font-medium text-neutral-900">{booking.vehicle.taktischeBezeichnung}</span>{' '}
                    <span className="text-neutral-500">{formatRange(booking.startsAt, booking.endsAt)}</span>{' '}
                    <ReservierungStatusBadge status={booking.status} />
                    {booking.status === 'ABGELEHNT' && booking.rejectionReason && (
                      <span className="block text-xs text-neutral-500">Grund: {booking.rejectionReason}</span>
                    )}
                  </span>
                  {booking.status !== 'ABGELEHNT' && (
                    <form action={boundCancel}>
                      <button type="submit" className="text-red-700 hover:underline">
                        Stornieren
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
