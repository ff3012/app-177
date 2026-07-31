import { prisma } from '@/lib/db/prisma';
import { MembershipRole } from '@prisma/client';
import { requireUser } from '@/lib/auth/session';
import { UserManagementSection, type UserRow } from './user-management-section';

// Admin-Gate (isSiteAdmin) läuft jetzt in admin/layout.tsx per notFound() - kein eigener Check
// mehr nötig, Server Actions bleiben trotzdem unverändert eigenständig durch assertPermission
// abgesichert (ein Layout schützt nur den Seiten-Render, keine direkten Server-Action-Aufrufe).
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

  const [users, organizations] = await Promise.all([
    prisma.user.findMany({
      include: {
        homeOrganization: true,
        memberships: { where: { role: MembershipRole.ADMIN }, include: { organization: true } },
        droneMembership: true,
        pushSubscriptions: { select: { createdAt: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    }),
    prisma.organization.findMany({ orderBy: { name: 'asc' } }),
  ]);

  const rows: UserRow[] = users.map((u) => {
    const adminOrgNames = u.memberships.map((m) => m.organization.shortName ?? m.organization.name);
    return {
      id: u.id,
      // Verwaltung-Brief.md: "Nachname Vorname" statt bisher "Vorname Nachname".
      name: `${u.lastName} ${u.firstName}`,
      email: u.email,
      stbNr: u.stbNr ?? '',
      phone: u.phone ?? '',
      homeOrg: u.homeOrganization.shortName ?? u.homeOrganization.name,
      homeOrganizationId: u.homeOrganizationId,
      isAdmin: adminOrgNames.length > 0,
      adminFor: adminOrgNames.length > 0 ? `Admin für: ${adminOrgNames.join(', ')}` : '–',
      droneLabel: u.droneMembership?.role === 'ADMIN' ? 'Admin' : u.droneMembership ? 'Mitglied' : '–',
      pushCount: u.pushSubscriptions.length,
      pushDates: u.pushSubscriptions.map((s) => s.createdAt.toISOString()),
      isActive: u.isActive,
    };
  });

  return (
    <UserManagementSection
      users={rows}
      organizations={organizations.map((org) => ({ id: org.id, name: org.shortName ?? org.name }))}
      initialQuery={params.q ?? ''}
      initialFeuerwehr={params.feuerwehr ?? 'ALLE'}
      initialRolle={params.rolle ?? 'ALLE'}
      initialStatus={params.status ?? 'ALLE'}
      initialSort={params.sort ?? 'name'}
      initialDir={params.dir === 'desc' ? 'desc' : 'asc'}
      currentUserId={currentUser.id}
    />
  );
}
