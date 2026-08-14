import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManageFlight, canRegisterFlight, canViewDroneModule } from '@/lib/auth/permissions';
import { NOT_DEACTIVATED_WHERE } from '@/lib/auth/user-status';
import {
  NINETY_DAY_REQUIRED_FLIGHTS,
  getComplianceUntilDate,
  getDaysUntilExpiry,
  getNinetyDayCutoff,
  meetsNinetyDayRule,
} from '@/lib/drone/ninety-day-rule';
import { getAllowedDroneGroups } from '@/lib/drone/flightbook-groups';
import { groupFlightsByMonth } from '@/lib/drone/group-flights-by-month';
import { QUALIFICATION_OPTIONS, matchesQualification, resolveSelectedQualifications } from '@/lib/drone/qualification-filter';
import { isQuickRegisterEmail } from '@/lib/drone/quick-register-user';
import { MeinStatusCard } from '@/components/drone/mein-status-card';
import { GroupStatusList, type GroupStatusPilot } from '@/components/drone/group-status-list';
import { FlightRow, FlightCard, type FlightRowData } from '@/components/drone/flight-row';
import { FlightSidebar } from '@/components/drone/flight-sidebar';

const PURPOSE_LABEL: Record<string, string> = { UEBUNG: 'Übung', EINSATZ: 'Einsatz' };
const PAGE_SIZE = 50;

function formatDaysAgo(date: Date): string {
  const days = Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'heute';
  if (days === 1) return 'vor 1 Tag';
  return `vor ${days} Tagen`;
}

function zeitraumCutoff(zeitraum: string): Date | null {
  if (zeitraum === 'jahr') {
    const d = new Date();
    d.setMonth(0, 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (zeitraum === 'alle') return null;
  return getNinetyDayCutoff();
}

export default async function DrohnenPage({
  searchParams,
}: {
  searchParams: Promise<{
    gruppe?: string;
    q?: string;
    pilot?: string;
    drohne?: string;
    zeitraum?: string;
    zweck?: string;
    scope?: string;
    take?: string;
    qualifikation?: string;
  }>;
}) {
  const user = await requireUser();

  if (!canViewDroneModule(user)) {
    return <p className="text-ink-muted">Dieser Bereich ist nur für Mitglieder der Drohnengruppe sichtbar.</p>;
  }

  const params = await searchParams;
  const allowedGroups = await getAllowedDroneGroups(user);
  const isAdmin = allowedGroups.length > 0;

  // Ein reines Mitglied ohne Admin-Recht bleibt weiterhin an die eigene Gruppe gebunden - das
  // Flugbuch war und bleibt für Mitglieder single-group, nur Admins bekommen den Gruppenwechsel.
  // Für Admins liefert allowedGroups bereits volle DroneGroup-Zeilen (inkl. name) - keine zweite
  // Abfrage nötig; nur das Mitglied ohne eigenen Eintrag in allowedGroups braucht einen direkten
  // Lookup seiner einen Gruppe.
  const selectedGroup = isAdmin
    ? (params.gruppe && allowedGroups.find((g) => g.id === params.gruppe)) || allowedGroups[0]
    : await prisma.droneGroup.findUniqueOrThrow({
        where: { id: user.droneGroupId! },
        select: { id: true, name: true },
      });

  // Muss VOR filterWhere/where laufen und AUSSERHALB der späteren Promise.all - matchingMemberIds
  // fließt in dieselbe Flug-Query ein, die weiter unten aus `where` gebaut wird, kann also nicht
  // parallel zu ihr in derselben Promise.all stehen.
  const members = isAdmin
    ? await prisma.drohnengruppeMembership.findMany({
        where: { droneGroupId: selectedGroup.id, user: NOT_DEACTIVATED_WHERE },
        orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
        select: {
          a1a3LizenzAm: true,
          a2LizenzAm: true,
          stuetzpunktausbildungAm: true,
          bos1AusbildungAm: true,
          bos2AusbildungAm: true,
          user: { select: { id: true, firstName: true, lastName: true } },
        },
      })
    : [];

  const selectedQualifications = isAdmin ? resolveSelectedQualifications(params.qualifikation) : [];
  // Der Pilot-Select zeigt bewusst IMMER alle Gruppenmitglieder als Optionen, unabhängig vom
  // Qualifikations-Filter - dieselbe Unabhängigkeit gilt bereits zwischen allen anderen Filtern
  // dieser Seite (z. B. schränkt der Zweck-Filter die Drohnen-Optionen auch nicht ein).
  const pilots = members.map((m) => ({ id: m.user.id, name: `${m.user.lastName} ${m.user.firstName}` }));
  const groupMembers =
    selectedQualifications.length > 0 ? members.filter((m) => matchesQualification(m, selectedQualifications)) : members;
  const matchingMemberIds = new Set(groupMembers.map((m) => m.user.id));

  const cutoff = zeitraumCutoff(params.zeitraum ?? '90tage');
  const scope = params.scope === 'MEINE' ? 'MEINE' : 'ALLE';
  const take = Math.max(PAGE_SIZE, Number(params.take) || PAGE_SIZE);

  const baseWhere = isAdmin
    ? { drone: { droneGroupId: selectedGroup.id } }
    : { OR: [{ registeredById: user.id }, { pilotUserId: user.id }] };

  const scopeWhere =
    isAdmin && scope === 'MEINE' ? { OR: [{ registeredById: user.id }, { pilotUserId: user.id }] } : {};

  const filterWhere = {
    AND: [
      ...(params.pilot ? [{ pilotUserId: params.pilot }] : []),
      ...(params.drohne ? [{ droneId: params.drohne }] : []),
      ...(params.zweck === 'EINSATZ' || params.zweck === 'UEBUNG' ? [{ purpose: params.zweck as 'EINSATZ' | 'UEBUNG' }] : []),
      ...(cutoff ? [{ startsAt: { gte: cutoff } }] : []),
      ...(params.q ? [{ location: { contains: params.q, mode: 'insensitive' as const } }] : []),
      ...(selectedQualifications.length > 0 ? [{ pilotUserId: { in: Array.from(matchingMemberIds) } }] : []),
    ],
  };

  const where = { AND: [baseWhere, scopeWhere, filterWhere] };

  const [flights, totalCount, allScopeCount, meineCount, fuerAndereErfasstCount, ownFlightsInWindow, lastOwnFlight, groupFlightsInWindow, drones] =
    await Promise.all([
      prisma.droneFlight.findMany({
        where,
        include: { drone: { include: { droneGroup: true } }, registeredBy: true, pilotUser: true },
        orderBy: { startsAt: 'desc' },
        take,
      }),
      prisma.droneFlight.count({ where }),
      // Fix round 1 (task review Finding 1): unabhängig vom gerade aktiven `scope` - die "Alle
      // {n}"-Chip-Beschriftung in FlightSidebar muss immer die Gesamtzahl der Gruppe (unter den
      // sonstigen Filtern) zeigen, nicht die durch scope=MEINE bereits eingeschränkte `totalCount`.
      prisma.droneFlight.count({ where: { AND: [baseWhere, filterWhere] } }),
      isAdmin
        ? prisma.droneFlight.count({
            where: { AND: [{ drone: { droneGroupId: selectedGroup.id } }, { OR: [{ registeredById: user.id }, { pilotUserId: user.id }] }, filterWhere] },
          })
        : Promise.resolve(0),
      !isAdmin
        ? prisma.droneFlight.count({
            where: { AND: [baseWhere, { registeredById: user.id, NOT: { pilotUserId: user.id } }, filterWhere] },
          })
        : Promise.resolve(0),
      prisma.droneFlight.findMany({
        where: { pilotUserId: user.id, startsAt: { gte: getNinetyDayCutoff() } },
        orderBy: { startsAt: 'desc' },
        select: { startsAt: true },
      }),
      prisma.droneFlight.findFirst({ where: { pilotUserId: user.id }, orderBy: { startsAt: 'desc' }, select: { startsAt: true } }),
      // Task 3 review fix: die ursprüngliche Brief-Fassung nutzte hier `groupBy` mit nur `_count`
      // und berechnete `daysLeft` für JEDES Gruppenmitglied fälschlich aus `ownFlightsInWindow` -
      // den Flugdaten des GERADE EINGELOGGTEN Admins, nicht denen des jeweiligen Mitglieds. Das hätte
      // jedem regelkonformen Piloten denselben Bernstein/Grün-Status wie den des Admins selbst
      // zugewiesen. `getDaysUntilExpiry`/`getComplianceUntilDate` (ninety-day-rule.ts) brauchen pro
      // Person die eigenen, absteigend sortierten Flugdaten - deshalb hier `findMany` (statt
      // `groupBy`) mit `orderBy: startsAt desc`, anschließend unten pro `pilotUserId` gruppiert.
      isAdmin
        ? prisma.droneFlight.findMany({
            where: { startsAt: { gte: getNinetyDayCutoff() }, pilotUser: { droneMembership: { droneGroupId: selectedGroup.id } } },
            orderBy: { startsAt: 'desc' },
            select: { pilotUserId: true, startsAt: true },
          })
        : Promise.resolve([]),
      // Task 3 review fix: die ursprüngliche Brief-Fassung lud die Drohnenliste nur für isAdmin,
      // obwohl FlightSidebar das "Drohne"-Select für JEDEN Benutzer rendert (nur "Pilot" ist
      // isAdmin-gated) - ein reines Mitglied bekam dadurch immer "Alle 0" ohne echte Optionen, live
      // bestätigt. Die Drohnenliste der eigenen Gruppe ist keine sensible Admin-Information.
      prisma.drone.findMany({ where: { droneGroupId: selectedGroup.id, isActive: true }, orderBy: { sortOrder: 'asc' } }),
    ]);

  const ownFlightCount = ownFlightsInWindow.length;
  const ownRuleMet = meetsNinetyDayRule(ownFlightCount);
  const complianceUntil = getComplianceUntilDate(ownFlightsInWindow.map((f) => f.startsAt));

  // Pro Pilot die eigenen (absteigend sortierten) Flugdaten im 90-Tage-Fenster - siehe Kommentar
  // an der Query oben. `groupFlightsInWindow` ist bereits `orderBy: startsAt desc` sortiert, daher
  // bleibt die Reihenfolge innerhalb jeder pilotUserId-Gruppe beim Einsammeln absteigend erhalten.
  const flightDatesByPilot = new Map<string, Date[]>();
  for (const f of groupFlightsInWindow) {
    const dates = flightDatesByPilot.get(f.pilotUserId);
    if (dates) {
      dates.push(f.startsAt);
    } else {
      flightDatesByPilot.set(f.pilotUserId, [f.startsAt]);
    }
  }

  const groupStatusPilots: GroupStatusPilot[] = groupMembers.map((member) => {
    const dates = flightDatesByPilot.get(member.user.id) ?? [];
    const count = dates.length;
    const met = meetsNinetyDayRule(count);
    const daysLeft = met ? getDaysUntilExpiry(dates) : null;
    const status: GroupStatusPilot['status'] = !met ? 'danger' : daysLeft !== null && daysLeft <= 14 ? 'warning' : 'success';
    return { id: member.user.id, name: `${member.user.lastName} ${member.user.firstName}`, count, status };
  });

  const flightRows: FlightRowData[] = flights.map((flight) => {
    const purposeLabel = PURPOSE_LABEL[flight.purpose] ?? flight.purpose;
    const isForOthers = !isAdmin && flight.registeredById === user.id && flight.pilotUserId !== user.id;
    const originLabel = isQuickRegisterEmail(flight.registeredBy.email)
      ? 'Erfasst über Schnellerfassung (QR)'
      : isForOthers
        ? `Für andere erfasst / von ${flight.registeredBy.firstName} ${flight.registeredBy.lastName}`
        : `Erfasst von ${flight.registeredBy.firstName} ${flight.registeredBy.lastName}`;
    return {
      id: flight.id,
      dayNumber: String(flight.startsAt.getDate()).padStart(2, '0'),
      weekdayLabel: flight.startsAt.toLocaleDateString('de-AT', { weekday: 'short' }),
      location: flight.location,
      timeLabel: flight.startsAt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' }),
      pilotName: `${flight.pilotUser.firstName} ${flight.pilotUser.lastName}`,
      droneName: flight.drone.name,
      purposeLabel,
      originLabel,
      editable: canManageFlight(user, {
        registeredById: flight.registeredById,
        droneGroupId: flight.drone.droneGroupId,
        organizationId: flight.drone.droneGroup.organizationId,
      }),
    };
  });

  const monthGroups = groupFlightsByMonth(flightRows.map((r, i) => ({ ...r, startsAt: flights[i].startsAt })));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold text-ink">{isAdmin ? 'Flugbuch Drohnengruppen' : 'Meine Flüge'}</h1>
          <p className="text-[15px] text-ink-muted">
            {isAdmin ? `${selectedGroup.name} · ${groupStatusPilots.length} Piloten · ${totalCount} Flüge` : `${selectedGroup.name} · ${user.name}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Link href="/drohnen/unterlagen" className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-muted hover:bg-surface-sunken">
            Unterlagen
          </Link>
          {isAdmin && (
            <>
              <a href={`/drohnen/90-tage-export?gruppe=${selectedGroup.id}`} className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-muted hover:bg-surface-sunken">
                90-Tage-Report
              </a>
              <a href={`/drohnen/export?gruppe=${selectedGroup.id}`} className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-muted hover:bg-surface-sunken">
                Export
              </a>
            </>
          )}
          {canRegisterFlight(user) && (
            <Link href="/drohnen/neu" className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover">
              Flug registrieren
            </Link>
          )}
        </div>
      </div>

      {isAdmin && allowedGroups.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {allowedGroups.map((g) => (
            <Link
              key={g.id}
              href={`/drohnen?gruppe=${g.id}`}
              className={`rounded-full px-3.5 py-2 text-sm font-semibold ${g.id === selectedGroup.id ? 'bg-ink text-white' : 'bg-surface-sunken text-ink-muted'}`}
            >
              {g.name}
            </Link>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex flex-col gap-3.5 lg:w-[250px] lg:shrink-0">
          <MeinStatusCard
            count={ownFlightCount}
            required={NINETY_DAY_REQUIRED_FLIGHTS}
            met={ownRuleMet}
            complianceUntilLabel={complianceUntil ? complianceUntil.toLocaleDateString('de-AT') : null}
            lastFlightAgoLabel={lastOwnFlight ? formatDaysAgo(lastOwnFlight.startsAt) : null}
          />
          <FlightSidebar
            pilots={pilots}
            drones={drones.map((d) => ({ id: d.id, name: d.name }))}
            totalCount={allScopeCount}
            meineCount={meineCount}
            fuerAndereErfasstCount={fuerAndereErfasstCount}
            isAdmin={isAdmin}
            qualificationOptions={QUALIFICATION_OPTIONS}
          />
          {!isAdmin && (
            <div className="rounded-lg bg-surface p-4 shadow-card">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[.13em] text-ink-faint">Meine Gruppe</div>
              <div className="mb-1 text-[15px] font-semibold text-ink">{selectedGroup.name}</div>
              <p className="text-sm text-ink-muted">
                Sie sehen Ihre eigenen Flüge sowie Flüge, die Sie für andere erfasst haben. Der Gruppenstand ist den
                Drohnen-Admins vorbehalten.
              </p>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {isAdmin && (
            <GroupStatusList
              pilots={groupStatusPilots}
              groupName={selectedGroup.name}
              required={NINETY_DAY_REQUIRED_FLIGHTS}
            />
          )}

          <p className="text-[15px] text-ink-muted">{totalCount} Flüge</p>

          {flights.length === 0 ? (
            <div className="rounded-lg bg-surface p-6 text-center text-sm shadow-card">
              {params.pilot || params.drohne || params.zweck || params.q || params.qualifikation ? (
                <>
                  <p className="mb-2 text-ink-muted">Keine Flüge für diese Filter.</p>
                  <Link href={`/drohnen?gruppe=${selectedGroup.id}`} className="text-brand hover:underline">
                    Filter zurücksetzen
                  </Link>
                </>
              ) : (
                <>
                  <p className="mb-3 text-ink-muted">Noch keine Flüge erfasst.</p>
                  {canRegisterFlight(user) && (
                    <Link href="/drohnen/neu" className="inline-block rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover">
                      Flug registrieren
                    </Link>
                  )}
                </>
              )}
            </div>
          ) : (
            <>
              {monthGroups.map((group) => (
                <div key={group.key}>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[.13em] text-ink-faint">{group.label}</div>
                  <div className="flex flex-col rounded-lg bg-surface shadow-card sm:block">
                    {group.flights.map((f) => (
                      <div key={f.id}>
                        <FlightRow flight={f} />
                        <FlightCard flight={f} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {flights.length < totalCount && (
                <Link
                  href={`/drohnen?${new URLSearchParams({ ...params, take: String(take + PAGE_SIZE) } as Record<string, string>).toString()}`}
                  className="self-center rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-muted hover:bg-surface-sunken"
                >
                  Weitere {Math.min(PAGE_SIZE, totalCount - flights.length)} laden
                </Link>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
