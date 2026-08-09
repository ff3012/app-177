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

export async function buildSessionUser(user: UserWithRelations): Promise<SessionUser> {
  const abschnittskommandoMembership = user.memberships.find(
    (m) => m.organization.type === OrganizationType.ABSCHNITTSKOMMANDO,
  );

  const abschnittAdminOrgIds = user.memberships
    .filter((m) => m.role === MembershipRole.ADMIN && m.organization.type === OrganizationType.ABSCHNITTSKOMMANDO)
    .map((m) => m.organizationId);

  const directFeuerwehrAdminOrgIds = user.memberships
    .filter((m) => m.role === MembershipRole.ADMIN && m.organization.type === OrganizationType.FEUERWEHR)
    .map((m) => m.organizationId);

  const inheritedFeuerwehrOrgIds =
    abschnittAdminOrgIds.length > 0
      ? (
          await prisma.organization.findMany({
            where: { parentId: { in: abschnittAdminOrgIds } },
            select: { id: true },
          })
        ).map((o) => o.id)
      : [];

  const feuerwehrAdminOrgIds = Array.from(new Set([...directFeuerwehrAdminOrgIds, ...inheritedFeuerwehrOrgIds]));

  const homeAbschnittOrganizationId =
    user.homeOrganization.type === OrganizationType.ABSCHNITTSKOMMANDO
      ? user.homeOrganizationId
      : user.homeOrganization.parentId!;

  return {
    id: user.id,
    email: user.email,
    name: `${user.firstName} ${user.lastName}`,
    homeOrganizationId: user.homeOrganizationId,
    homeOrganizationType: user.homeOrganization.type,
    homeAbschnittOrganizationId,
    feuerwehrAdminOrgIds,
    abschnittAdminOrgIds,
    isBezirksAdmin: user.isBezirksAdmin,
    isAbschnittskommandoMitglied:
      user.homeOrganization.type === OrganizationType.ABSCHNITTSKOMMANDO || Boolean(abschnittskommandoMembership),
    isDrohnengruppeMember: Boolean(user.droneMembership),
    droneGroupId: user.droneMembership?.droneGroupId ?? null,
    droneGroupRole: user.droneMembership?.role ?? null,
  };
}
