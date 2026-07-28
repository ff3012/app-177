import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { isSiteAdmin } from '@/lib/auth/permissions';
import { MembershipRole } from '@prisma/client';
import { AdminNav } from '@/components/layout/admin-nav';
import { UserManagementSection, type UserRow } from './user-management-section';

export default async function BenutzerverwaltungPage() {
  const user = await requireUser();
  if (!isSiteAdmin(user)) {
    return <p className="text-neutral-700">Dieser Bereich ist nur für die Abschnittskommando-Verwaltung sichtbar.</p>;
  }

  const users = await prisma.user.findMany({
    include: {
      homeOrganization: true,
      memberships: { where: { role: MembershipRole.ADMIN }, include: { organization: true } },
      droneMembership: true,
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
    statusLabel: u.isActive ? 'Aktiv' : 'Deaktiviert',
  }));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="mb-3 text-lg font-semibold text-neutral-900">Verwaltung</h1>
        <AdminNav />
      </div>

      <UserManagementSection users={rows} />
    </div>
  );
}
