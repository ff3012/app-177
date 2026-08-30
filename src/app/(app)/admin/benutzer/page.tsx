import { notFound } from 'next/navigation';
import { Prisma, MembershipRole } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { canAccessUserManagementAdmin, canManageDroneGroupFor, isBezirksAdmin } from '@/lib/auth/permissions';
import { getAdminNavItems } from '@/lib/admin/nav-items';
import { getReachableScopes, resolveAdminScope } from '@/lib/admin/scope';
import { UserManagementSection, type UserRow } from './user-management-section';
import { PendingRegistrationsSection, type PendingRegistrationRow } from './pending-registrations-section';

const PAGE_SIZE = 50;

/** Benutzerverwaltung-Breite-Brief.md §5: "Admin für: AFKDO Purkersdorf, ..." wird in der Tabelle
 * gekürzt zu "Admin: Purkersdorf, ...", der volle Text bleibt (unverändert als `adminFor`) im
 * Tooltip. Nur die Kurzform verliert das "AFKDO "-Präfix - nirgends sonst wird shortName verändert. */
function stripAfkdoPrefix(name: string): string {
  return name.replace(/^AFKDO\s+/i, '');
}

function buildStatusWhere(status: string): Prisma.UserWhereInput | undefined {
  if (status === 'AKTIV') return { isActive: true };
  if (status === 'DEAKTIVIERT') return { isActive: false, passwordChangedAt: { not: null } };
  if (status === 'INAKTIV') return { isActive: false, passwordChangedAt: null };
  return undefined;
}

function buildRolleWhere(rolle: string): Prisma.UserWhereInput | undefined {
  if (rolle === 'JA') return { memberships: { some: { role: MembershipRole.ADMIN } } };
  if (rolle === 'NEIN') return { memberships: { none: { role: MembershipRole.ADMIN } } };
  return undefined;
}

/** Namensteil wortweise UND-verknüpft über Vor-/Nachname (statt eines einzelnen `contains` auf
 * "Nachname Vorname"), damit sowohl "Krebs Florian" als auch "Florian Krebs" denselben Benutzer
 * findet - ein Prisma `contains` kann nicht gegen die im Client zusammengesetzte "lastName
 * firstName"-Anzeige matchen, da diese Verkettung in der DB nicht existiert. */
function buildSearchWhere(rawQuery: string): Prisma.UserWhereInput | undefined {
  const q = rawQuery.trim();
  if (!q) return undefined;
  const words = q.split(/\s+/);
  const nameMatch: Prisma.UserWhereInput = {
    AND: words.map((word) => ({
      OR: [
        { firstName: { contains: word, mode: 'insensitive' as const } },
        { lastName: { contains: word, mode: 'insensitive' as const } },
      ],
    })),
  };
  const orgNameMatch = (): Prisma.OrganizationWhereInput => ({
    OR: [
      { name: { contains: q, mode: 'insensitive' as const } },
      { shortName: { contains: q, mode: 'insensitive' as const } },
    ],
  });
  return {
    OR: [
      nameMatch,
      { email: { contains: q, mode: 'insensitive' } },
      { stbNr: { contains: q, mode: 'insensitive' } },
      { phone: { contains: q, mode: 'insensitive' } },
      { homeOrganization: orgNameMatch() },
      { memberships: { some: { organization: orgNameMatch() } } },
      { droneMembership: { droneGroup: { name: { contains: q, mode: 'insensitive' } } } },
    ],
  };
}

interface BuildWhereParams {
  scopeWhere: Prisma.UserWhereInput | undefined;
  abschnittId: string;
  feuerwehrId: string;
  drohnengruppeId: string;
  rolle: string;
  status: string;
  q: string;
}

function buildUsersWhere(params: BuildWhereParams): Prisma.UserWhereInput {
  const and: Prisma.UserWhereInput[] = [];
  if (params.scopeWhere) and.push(params.scopeWhere);
  if (params.abschnittId && params.abschnittId !== 'ALLE') {
    and.push({ homeOrganization: { OR: [{ id: params.abschnittId }, { parentId: params.abschnittId }] } });
  }
  if (params.feuerwehrId !== 'ALLE') {
    and.push({ homeOrganizationId: params.feuerwehrId });
  }
  if (params.drohnengruppeId !== 'ALLE') {
    and.push({ droneMembership: { droneGroupId: params.drohnengruppeId } });
  }
  const rolleWhere = buildRolleWhere(params.rolle);
  if (rolleWhere) and.push(rolleWhere);
  const statusWhere = buildStatusWhere(params.status);
  if (statusWhere) and.push(statusWhere);
  const searchWhere = buildSearchWhere(params.q);
  if (searchWhere) and.push(searchWhere);
  return and.length > 0 ? { AND: and } : {};
}

type SortKey =
  | 'name'
  | 'email'
  | 'stbNr'
  | 'phone'
  | 'homeOrg'
  | 'adminFor'
  | 'droneLabel'
  | 'pushCount'
  | 'status'
  | 'lastActive'
  | 'dienstgrad';

/** Serverseitiges Gegenstück zur bisherigen clientseitigen compareRows() (Verwaltung-Brief.md
 * Phase 3) - exakt für direkt vergleichbare Skalarspalten (email/stbNr/phone/lastActive/status,
 * letzteres über isActive+passwordChangedAt mit explizitem nulls-Modifikator für die korrekte
 * INAKTIV/DEAKTIVIERT/AKTIV-Reihenfolge in beiden Richtungen). adminFor/droneLabel/dienstgrad
 * werden über eine Relations-Aggregat- bzw. Feld-Ordnung angenähert (Anzahl Admin-Mitgliedschaften,
 * Drohnengruppen-Rolle, Dienstgrad-Kurzform) statt über den früher alphabetisch verglichenen,
 * zusammengesetzten Anzeige-String - Prisma kann keinen über eine Relation aufgebauten String
 * sortieren, nur echte Spalten/Aggregate. Für diese drei Spalten ist die Sortierung damit eine
 * bewusst akzeptierte Annäherung, keine 1:1-Fortsetzung des alten Verhaltens. */
function buildOrderBy(sort: SortKey, dir: 'asc' | 'desc'): Prisma.UserOrderByWithRelationInput[] {
  switch (sort) {
    case 'name':
      return [{ lastName: dir }, { firstName: dir }];
    case 'dienstgrad':
      return [{ dienstgrad: { kurzform: dir } }, { lastName: 'asc' }];
    case 'email':
      return [{ email: dir }];
    case 'stbNr':
      return [{ stbNr: dir }];
    case 'phone':
      return [{ phone: dir }];
    case 'homeOrg':
      return [{ homeOrganization: { name: dir } }];
    case 'adminFor':
      return [{ memberships: { _count: dir } }];
    case 'droneLabel':
      return [{ droneMembership: { role: dir } }];
    case 'pushCount':
      return [{ pushSubscriptions: { _count: dir } }];
    case 'status':
      return [{ isActive: dir }, { passwordChangedAt: { sort: dir, nulls: dir === 'asc' ? 'first' : 'last' } }];
    case 'lastActive':
      return [{ lastLoginAt: dir }];
    default:
      return [{ lastName: 'asc' }, { firstName: 'asc' }];
  }
}

// admin/layout.tsx's Gate deckt seit "Heimatfeuerwehr" auch reine Feuerwehr-Admins ab; diese Seite
// ist seit der Öffnung für Feuerwehr-Admins (siehe canManageUsersFor) ebenfalls für sie sichtbar -
// eigene Prüfung hier trotzdem, wie bei jeder /admin/*-Seite (Sicherheits-Härtung, siehe
// CLAUDE.md). Ein Feuerwehr-Admin sieht/bearbeitet dabei NUR Benutzer seiner eigenen
// Heimat-Feuerwehr(en) - sowohl die users-Query als auch die organizations-Liste (die
// UserFormSheet's "Heimat-Feuerwehr"-Auswahl und "Admin für"-Checkboxen speist) werden für ihn auf
// user.feuerwehrAdminOrgIds eingeschränkt, damit er weder fremde Benutzer sieht noch neue Benutzer
// für eine fremde Feuerwehr anlegen oder Admin-Rechte für eine fremde Feuerwehr vergeben kann. Nur
// ein Abschnittskommando-Admin (isSiteAdmin) sieht/verwaltet weiterhin alle Benutzer aller
// Feuerwehren. Server Actions bleiben unverändert eigenständig durch assertPermission abgesichert
// (ein Layout/eine Seiten-Prüfung schützt keine direkten Server-Action-Aufrufe).
//
// Benutzerverwaltung-Breite-Brief.md §5: Filter/Sortierung/Paginierung laufen jetzt vollständig
// serverseitig gegen searchParams (statt bisher clientseitig über ein komplett geladenes
// UserRow[]-Array, siehe Verwaltung-Brief.md Phase 3) - Seitengröße fix 50. URL-Parameternamen
// bleiben unverändert (q/feuerwehr/rolle/status/sort/dir/abschnitt/ebene/bereich), neu:
// `drohnengruppe` (Filter, §4) und `page` (1-basiert, §5).
interface BenutzerverwaltungPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function BenutzerverwaltungPage({ searchParams }: BenutzerverwaltungPageProps) {
  const params = await searchParams;
  const currentUser = await requireUser();
  if (!canAccessUserManagementAdmin(currentUser)) {
    notFound();
  }
  const fullAdmin = isBezirksAdmin(currentUser);
  const viewerIsBezirksDrohnenAdmin = currentUser.isBezirksDrohnenAdmin;
  const reachableScopes = await getReachableScopes(currentUser);

  const abschnitte = reachableScopes
    .filter((scope) => scope.level === 'ABSCHNITT')
    .map((scope) => ({ id: scope.organizationId, name: scope.name }));

  let initialAbschnitt = params.abschnitt ?? '';
  if (initialAbschnitt !== 'ALLE' && initialAbschnitt !== '' && !abschnitte.some((a) => a.id === initialAbschnitt)) {
    // Ein fremder/ungültiger Wert in der URL wird verworfen, nicht stillschweigend übernommen.
    initialAbschnitt = '';
  }
  if (fullAdmin && params.abschnitt === undefined) {
    const scopeResolution = resolveAdminScope(reachableScopes, params.ebene, params.bereich);
    if (scopeResolution.scope.level === 'ABSCHNITT') {
      initialAbschnitt = scopeResolution.scope.organizationId;
    }
  }

  const scopeWhere: Prisma.UserWhereInput | undefined = fullAdmin
    ? undefined
    : { homeOrganizationId: { in: currentUser.feuerwehrAdminOrgIds } };

  const feuerwehr = params.feuerwehr ?? 'ALLE';
  const drohnengruppe = params.drohnengruppe ?? 'ALLE';
  const rolle = params.rolle ?? 'ALLE';
  const status = params.status ?? 'ALLE';
  const q = params.q ?? '';
  const sort: SortKey = (params.sort as SortKey) ?? 'name';
  const dir: 'asc' | 'desc' = params.dir === 'desc' ? 'desc' : 'asc';
  const requestedPage = Math.max(1, Number(params.page) || 1);

  const usersWhere = buildUsersWhere({
    scopeWhere,
    abschnittId: initialAbschnitt,
    feuerwehrId: feuerwehr,
    drohnengruppeId: drohnengruppe,
    rolle,
    status,
    q,
  });

  const [
    organizations,
    secondaryOrgExtras,
    dienstgrade,
    allDroneGroups,
    totalUsersCount,
    homeOrgGroups,
    filteredCount,
    pendingRegistrations,
  ] = await Promise.all([
      prisma.organization.findMany({
        where: fullAdmin ? undefined : { id: { in: currentUser.feuerwehrAdminOrgIds } },
        orderBy: { name: 'asc' },
        include: { parent: { select: { id: true, shortName: true, name: true } } },
      }),
      // Finding 1 (final-review, issue #21): für einen scoped (nicht-Bezirks-)Admin zusätzlich jede
      // Organisation laden, die aktuell die ZWEITE Feuerwehr irgendeines Benutzers in seinem
      // Verwaltungsbereich ist (secondaryHomeMembers - Gegenstück zu User.secondaryOrganizationId),
      // auch wenn diese Organisation außerhalb seines eigenen Bereichs liegt (typisch: eine BTF, die
      // ein Bezirksadmin zugewiesen hat). Bewusst NICHT in die obige `organizations`-Liste gemischt -
      // die speist auch "Admin für" (AdminOrgMultiSelect) und die Heimat-Feuerwehr-Auswahl, für die
      // ein scoped Admin nach wie vor NUR seinen eigenen Bereich angeboten bekommen darf; eine
      // fremde Organisation dort auswählbar zu machen hätte serverseitig ohnehin nur einen erneut
      // uncaught-ForbiddenError produziert (dieselbe Klasse Bug wie Finding 1 selbst). Stattdessen
      // unten zu einer separaten `secondaryOrganizationOptions`-Liste zusammengeführt, die nur das
      // Zweite-Feuerwehr-Feld speist - siehe UserFormSheet.
      prisma.organization.findMany({
        // Für einen Bezirksadmin liefert dies absichtlich nichts (die Haupt-Query oben deckt bereits
        // jede Organisation ab) - eine leere `in: []`-Bedingung statt eines zweiten, andersartig
        // typisierten Query-Zweigs, damit beide Zweige exakt denselben Rückgabetyp haben.
        where: fullAdmin
          ? { id: { in: [] } }
          : {
              id: { notIn: currentUser.feuerwehrAdminOrgIds },
              secondaryHomeMembers: { some: { homeOrganizationId: { in: currentUser.feuerwehrAdminOrgIds } } },
            },
        include: { parent: { select: { id: true, shortName: true, name: true } } },
      }),
      prisma.dienstgrad.findMany({ orderBy: { sortOrder: 'asc' } }),
      prisma.droneGroup.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, name: true, organizationId: true, isActive: true },
      }),
      prisma.user.count({ where: scopeWhere }),
      prisma.user.groupBy({ by: ['homeOrganizationId'], where: scopeWhere }),
      prisma.user.count({ where: usersWhere }),
      prisma.pendingRegistration.findMany({
        where: fullAdmin ? undefined : { organizationId: { in: currentUser.feuerwehrAdminOrgIds } },
        orderBy: { createdAt: 'asc' },
        include: {
          organization: { select: { name: true, shortName: true } },
          dienstgrad: { select: { kurzform: true } },
        },
      }),
    ]);

  const totalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);

  const users = await prisma.user.findMany({
    where: usersWhere,
    include: {
      homeOrganization: true,
      memberships: { where: { role: MembershipRole.ADMIN }, include: { organization: true } },
      droneMembership: true,
      pushSubscriptions: { select: { createdAt: true } },
      dienstgrad: true,
    },
    orderBy: buildOrderBy(sort, dir),
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });

  // Nur die Gruppen anbieten, in die dieser Admin tatsächlich jemanden aufnehmen darf. Vorher wurden
  // alle Gruppen des Bezirks an jeden Benutzerverwaltungs-Admin (inkl. reiner Feuerwehr-Admins)
  // ausgeliefert - siehe die Begründung an syncDroneMembership in actions.ts, das dieselbe Prüfung
  // serverseitig noch einmal durchführt (die eingeschränkte Auswahl hier ist nur Bedienkomfort, keine
  // Absicherung). canManageDroneGroupFor lässt sich nicht als Prisma-where ausdrücken, daher erst
  // laden, dann filtern.
  const droneGroups = allDroneGroups
    .filter((group) => canManageDroneGroupFor(currentUser, group))
    .map((group) => ({ id: group.id, name: group.name, isActive: group.isActive }));

  const rows: UserRow[] = users.map((u) => {
    const adminOrgNames = u.memberships.map((m) => m.organization.shortName ?? m.organization.name);
    const droneRole = !u.droneMembership ? 'NONE' : u.droneMembership.role === 'ADMIN' ? 'ADMIN' : 'PILOT';
    return {
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      // Verwaltung-Brief.md: "Nachname Vorname" statt bisher "Vorname Nachname".
      name: `${u.lastName} ${u.firstName}`,
      email: u.email,
      stbNr: u.stbNr ?? '',
      phone: u.phone ?? '',
      homeOrg: u.homeOrganization.shortName ?? u.homeOrganization.name,
      homeOrganizationId: u.homeOrganizationId,
      isAdmin: adminOrgNames.length > 0,
      adminFor: adminOrgNames.length > 0 ? `Admin für: ${adminOrgNames.join(', ')}` : '–',
      adminForShort: adminOrgNames.length > 0 ? `Admin: ${adminOrgNames.map(stripAfkdoPrefix).join(', ')}` : '–',
      adminOrgIds: u.memberships.map((m) => m.organizationId),
      droneLabel: u.droneMembership?.role === 'ADMIN' ? 'Admin' : u.droneMembership ? 'Mitglied' : '–',
      droneRole,
      droneGroupId: u.droneMembership?.droneGroupId ?? null,
      a1a3LizenzAm: u.droneMembership?.a1a3LizenzAm?.toISOString().slice(0, 10) ?? '',
      a2LizenzAm: u.droneMembership?.a2LizenzAm?.toISOString().slice(0, 10) ?? '',
      stuetzpunktausbildungAm: u.droneMembership?.stuetzpunktausbildungAm?.toISOString().slice(0, 10) ?? '',
      bos1AusbildungAm: u.droneMembership?.bos1AusbildungAm?.toISOString().slice(0, 10) ?? '',
      bos2AusbildungAm: u.droneMembership?.bos2AusbildungAm?.toISOString().slice(0, 10) ?? '',
      pushCount: u.pushSubscriptions.length,
      pushDates: u.pushSubscriptions.map((s) => s.createdAt.toISOString()),
      isActive: u.isActive,
      istAtemschutzgeraeteTraeger: u.istAtemschutzgeraeteTraeger,
      lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
      passwordChangedAt: u.passwordChangedAt ? u.passwordChangedAt.toISOString() : null,
      dienstgradId: u.dienstgradId ?? '',
      dienstgrad: u.dienstgrad?.kurzform ?? '',
      secondaryOrganizationId: u.secondaryOrganizationId ?? '',
      secondaryDienstgradId: u.secondaryDienstgradId ?? '',
      isBezirksAdmin: u.isBezirksAdmin,
      isBezirksDrohnenAdmin: u.isBezirksDrohnenAdmin,
    };
  });

  const toOrgOption = (org: (typeof organizations)[number]) => ({
    id: org.id,
    name: org.shortName ?? org.name,
    abschnittName: org.parent?.shortName ?? org.parent?.name,
    abschnittId: org.parent?.id,
    isActive: org.isActive,
  });
  // Finding 1: nur für die Zweite-Feuerwehr-Auswahl im UserFormSheet - siehe Kommentar an
  // secondaryOrgExtras' Query oben. Für einen Bezirksadmin identisch zu `organizations` (secondaryOrgExtras
  // ist dann immer leer), daher kein eigener Prop-Wert nötig.
  const secondaryOrganizationOptions = [...organizations, ...secondaryOrgExtras].map(toOrgOption);

  const pendingRegistrationRows: PendingRegistrationRow[] = pendingRegistrations.map((r) => ({
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    stbNr: r.stbNr,
    dienstgradLabel: r.dienstgrad?.kurzform ?? '',
    email: r.email,
    organizationLabel: r.organization.shortName ?? r.organization.name,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PendingRegistrationsSection registrations={pendingRegistrationRows} />
      <UserManagementSection
        users={rows}
        organizations={organizations.map(toOrgOption)}
        secondaryOrganizationOptions={secondaryOrganizationOptions}
        dienstgrade={dienstgrade.map((d) => ({ id: d.id, kurzform: d.kurzform, bezeichnung: d.bezeichnung }))}
        droneGroups={droneGroups}
        initialQuery={q}
        initialFeuerwehr={feuerwehr}
        initialDrohnengruppe={drohnengruppe}
        initialRolle={rolle}
        initialStatus={status}
        initialSort={sort}
        initialDir={dir}
        currentUserId={currentUser.id}
        initialEditUserId={params.edit}
        initialCreateOpen={params.new === '1'}
        adminNavItems={getAdminNavItems(currentUser)}
        reachableScopes={reachableScopes}
        initialAbschnitt={initialAbschnitt}
        abschnitte={abschnitte}
        isFullAdmin={fullAdmin}
        viewerIsBezirksAdmin={fullAdmin}
        viewerIsBezirksDrohnenAdmin={viewerIsBezirksDrohnenAdmin}
        totalUsersCount={totalUsersCount}
        totalOrgsCount={homeOrgGroups.length}
        filteredCount={filteredCount}
        page={page}
        pageSize={PAGE_SIZE}
      />
    </div>
  );
}
