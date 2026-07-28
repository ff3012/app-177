import { NewsAudienceType } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

export async function resolveAudienceUserIds(
  audienceType: NewsAudienceType,
  audienceOrgId: string | null,
): Promise<string[]> {
  if (audienceType === NewsAudienceType.DROHNENGRUPPE) {
    const members = await prisma.user.findMany({
      where: { droneMembership: { isNot: null }, isActive: true },
      select: { id: true },
    });
    return members.map((member) => member.id);
  }

  if (!audienceOrgId) return [];

  const members = await prisma.user.findMany({
    where: { homeOrganizationId: audienceOrgId, isActive: true },
    select: { id: true },
  });
  return members.map((member) => member.id);
}
