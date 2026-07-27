import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { isSiteAdmin } from '@/lib/auth/permissions';
import { UserForm } from '@/components/admin/user-form';
import { MembershipRole } from '@prisma/client';
import { updateUser } from '../actions';
import { DeleteUserButton } from './delete-user-button';

export default async function BenutzerBearbeitenPage({ params }: { params: Promise<{ userId: string }> }) {
  const currentUser = await requireUser();
  if (!isSiteAdmin(currentUser)) {
    return <p className="text-neutral-700">Dieser Bereich ist nur für die Abschnittskommando-Verwaltung sichtbar.</p>;
  }

  const { userId } = await params;
  const [targetUser, organizations] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: { where: { role: MembershipRole.ADMIN } },
        droneMembership: true,
      },
    }),
    prisma.organization.findMany({ orderBy: { name: 'asc' } }),
  ]);

  if (!targetUser) {
    return <p className="text-neutral-700">Benutzer wurde nicht gefunden.</p>;
  }

  const boundUpdate = updateUser.bind(null, targetUser.id);
  const droneRole = !targetUser.droneMembership ? 'NONE' : targetUser.droneMembership.role === 'ADMIN' ? 'ADMIN' : 'PILOT';

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-neutral-900">
        Benutzer bearbeiten – {targetUser.firstName} {targetUser.lastName}
      </h1>
      <UserForm
        organizations={organizations}
        action={boundUpdate}
        submitLabel="Änderungen speichern"
        mode="edit"
        defaultValues={{
          firstName: targetUser.firstName,
          lastName: targetUser.lastName,
          email: targetUser.email,
          isActive: targetUser.isActive,
          homeOrganizationId: targetUser.homeOrganizationId,
          adminOrgIds: targetUser.memberships.map((m) => m.organizationId),
          droneRole,
          password: '',
        }}
      />
      {currentUser.id !== targetUser.id && <DeleteUserButton userId={targetUser.id} />}
    </div>
  );
}
