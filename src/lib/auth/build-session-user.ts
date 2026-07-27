import { MembershipRole, OrganizationType, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { SessionUser } from '@/types/next-auth';

const userInclude = {
  homeOrganization: true,
  memberships: { include: { organization: true } },
  droneMembership: true,
} satisfies Prisma.UserInclude;

type UserWithRelations = Prisma.UserGetPayload<{ include: typeof userInclude }>;

export async function findUserWithRelationsByEmail(email: string) {
  return prisma.user.findUnique({ where: { email }, include: userInclude });
}

export async function findUserWithRelationsById(id: string) {
  return prisma.user.findUnique({ where: { id }, include: userInclude });
}

export function buildSessionUser(user: UserWithRelations): SessionUser {
  const abschnittskommandoMembership = user.memberships.find(
    (m) => m.organization.type === OrganizationType.ABSCHNITTSKOMMANDO,
  );

  return {
    id: user.id,
    email: user.email,
    name: `${user.firstName} ${user.lastName}`,
    homeOrganizationId: user.homeOrganizationId,
    homeOrganizationType: user.homeOrganization.type,
    feuerwehrAdminOrgIds: user.memberships
      .filter((m) => m.role === MembershipRole.ADMIN)
      .map((m) => m.organizationId),
    isAbschnittsAdmin: abschnittskommandoMembership?.role === MembershipRole.ADMIN,
    isAbschnittskommandoMitglied:
      user.homeOrganization.type === OrganizationType.ABSCHNITTSKOMMANDO || Boolean(abschnittskommandoMembership),
    isDrohnengruppeMember: Boolean(user.droneMembership),
    droneGroupRole: user.droneMembership?.role ?? null,
  };
}
