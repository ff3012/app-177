import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { MembershipRole } from '@prisma/client';
import { requireUser } from '@/lib/auth/session';
import { canAccessUserManagementAdmin, isSiteAdmin } from '@/lib/auth/permissions';
import { getAdminNavItems } from '@/lib/admin/nav-items';
import { UserManagementSection, type UserRow } from './user-management-section';

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
// searchParams speist nur die Anfangswerte der clientseitigen Filter/Sortierung (siehe
// user-management-section.tsx) - die Prisma-Abfrage bleibt unverändert ungefiltert (184
// Datensätze rechtfertigen kein serverseitiges Filtern), URL-Sync ist reiner
// Lesezeichen-/Teilen-Mechanismus obendrauf.
interface BenutzerverwaltungPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function BenutzerverwaltungPage({ searchParams }: BenutzerverwaltungPageProps) {
  const params = await searchParams;
  const currentUser = await requireUser();
  if (!canAccessUserManagementAdmin(currentUser)) {
    notFound();
  }
  const fullAdmin = isSiteAdmin(currentUser);

  const [users, organizations, dienstgrade] = await Promise.all([
    prisma.user.findMany({
      where: fullAdmin ? undefined : { homeOrganizationId: { in: currentUser.feuerwehrAdminOrgIds } },
      include: {
        homeOrganization: true,
        memberships: { where: { role: MembershipRole.ADMIN }, include: { organization: true } },
        droneMembership: true,
        pushSubscriptions: { select: { createdAt: true } },
        dienstgrad: true,
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    }),
    prisma.organization.findMany({
      where: fullAdmin ? undefined : { id: { in: currentUser.feuerwehrAdminOrgIds } },
      orderBy: { name: 'asc' },
    }),
    prisma.dienstgrad.findMany({ orderBy: { sortOrder: 'asc' } }),
  ]);

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
      adminOrgIds: u.memberships.map((m) => m.organizationId),
      droneLabel: u.droneMembership?.role === 'ADMIN' ? 'Admin' : u.droneMembership ? 'Mitglied' : '–',
      droneRole,
      pushCount: u.pushSubscriptions.length,
      pushDates: u.pushSubscriptions.map((s) => s.createdAt.toISOString()),
      isActive: u.isActive,
      istAtemschutzgeraeteTraeger: u.istAtemschutzgeraeteTraeger,
      lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
      passwordChangedAt: u.passwordChangedAt ? u.passwordChangedAt.toISOString() : null,
      dienstgradId: u.dienstgradId ?? '',
      dienstgrad: u.dienstgrad?.kurzform ?? '',
    };
  });

  return (
    <UserManagementSection
      users={rows}
      organizations={organizations.map((org) => ({ id: org.id, name: org.shortName ?? org.name }))}
      dienstgrade={dienstgrade.map((d) => ({ id: d.id, kurzform: d.kurzform, bezeichnung: d.bezeichnung }))}
      initialQuery={params.q ?? ''}
      initialFeuerwehr={params.feuerwehr ?? 'ALLE'}
      initialRolle={params.rolle ?? 'ALLE'}
      initialStatus={params.status ?? 'ALLE'}
      initialSort={params.sort ?? 'name'}
      initialDir={params.dir === 'desc' ? 'desc' : 'asc'}
      currentUserId={currentUser.id}
      initialEditUserId={params.edit}
      initialCreateOpen={params.new === '1'}
      adminNavItems={getAdminNavItems(currentUser)}
      isFullAdmin={fullAdmin}
    />
  );
}
