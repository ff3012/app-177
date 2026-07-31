import { prisma } from '@/lib/db/prisma';
import { MembershipRole } from '@prisma/client';
import { UserManagementSection, type UserRow } from './user-management-section';

// Admin-Gate (isSiteAdmin) läuft jetzt in admin/layout.tsx per notFound() - kein eigener Check
// mehr nötig, Server Actions bleiben trotzdem unverändert eigenständig durch assertPermission
// abgesichert (ein Layout schützt nur den Seiten-Render, keine direkten Server-Action-Aufrufe).
export default async function BenutzerverwaltungPage() {
  const users = await prisma.user.findMany({
    include: {
      homeOrganization: true,
      memberships: { where: { role: MembershipRole.ADMIN }, include: { organization: true } },
      droneMembership: true,
      _count: { select: { pushSubscriptions: true } },
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });

  const rows: UserRow[] = users.map((u) => ({
    id: u.id,
    name: `${u.firstName} ${u.lastName}`,
    email: u.email,
    stbNr: u.stbNr ?? '',
    phone: u.phone ?? '',
    homeOrg: u.homeOrganization.shortName ?? u.homeOrganization.name,
    adminFor: u.memberships.map((m) => m.organization.shortName ?? m.organization.name).join(', ') || '–',
    droneLabel: u.droneMembership?.role === 'ADMIN' ? 'Admin' : u.droneMembership ? 'Mitglied' : '–',
    pushLabel: u._count.pushSubscriptions > 0 ? 'Aktiv' : 'Deaktiviert',
    statusLabel: u.isActive ? 'Aktiv' : 'Deaktiviert',
  }));

  return (
    <div className="flex flex-col gap-4">
      <UserManagementSection users={rows} />
    </div>
  );
}
