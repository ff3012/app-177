import { notFound } from 'next/navigation';
import type { Prisma } from '@prisma/client';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canSendAnyNews, canSendNewsToFireDepartment, canSendNewsToDroneGroup, canSendBezirksWideDroneNews } from '@/lib/auth/permissions';
import { NewsForm } from '@/components/news/news-form';
import { createNewsPost } from '../actions';

/** Batched statt einer Query pro Feuerwehr - ein Bezirksadmin darf an alle ~124 Feuerwehren senden,
 * eine Schleife mit getFireDepartmentStats(orgId) pro Feuerwehr wäre ~250 gleichzeitige COUNT-Abfragen
 * bei jedem Laden dieser Seite gewesen. */
async function getFireDepartmentStatsMap(organizationIds: string[]): Promise<Map<string, { memberCount: number; pushCount: number }>> {
  const stats = new Map<string, { memberCount: number; pushCount: number }>(organizationIds.map((id) => [id, { memberCount: 0, pushCount: 0 }]));
  if (organizationIds.length === 0) return stats;

  const [memberCounts, pushCounts] = await Promise.all([
    prisma.user.groupBy({
      by: ['homeOrganizationId'],
      where: { homeOrganizationId: { in: organizationIds }, isActive: true },
      _count: { _all: true },
    }),
    prisma.user.groupBy({
      by: ['homeOrganizationId'],
      where: { homeOrganizationId: { in: organizationIds }, isActive: true, pushSubscriptions: { some: {} } },
      _count: { _all: true },
    }),
  ]);
  for (const row of memberCounts) stats.get(row.homeOrganizationId)!.memberCount = row._count._all;
  for (const row of pushCounts) stats.get(row.homeOrganizationId)!.pushCount = row._count._all;
  return stats;
}

async function getDroneGroupStats(droneGroupId: string | null) {
  const where = droneGroupId
    ? { isActive: true, droneMembership: { is: { droneGroupId } } }
    : { isActive: true, droneMembership: { is: {} } };
  const memberCount = await prisma.user.count({ where });
  const pushCount = await prisma.user.count({ where: { ...where, pushSubscriptions: { some: {} } } });
  return { memberCount, pushCount };
}

export default async function NeueNewsPage() {
  const user = await requireUser();
  if (!canSendAnyNews(user)) notFound();

  const [allFireDepartments, allDroneGroups] = await Promise.all([
    prisma.organization.findMany({ where: { isActive: true, type: 'FEUERWEHR' }, orderBy: { name: 'asc' } }),
    prisma.droneGroup.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
  ]);

  const allowedFireDepartments = allFireDepartments.filter((org) => canSendNewsToFireDepartment(user, org.id));
  const allowedDroneGroups = allDroneGroups.filter((group) => canSendNewsToDroneGroup(user, { id: group.id, organizationId: group.organizationId }));
  const canSendBezirksweit = canSendBezirksWideDroneNews(user);

  const fireDepartmentStats = await getFireDepartmentStatsMap(allowedFireDepartments.map((org) => org.id));
  const fireDepartments = allowedFireDepartments.map((org) => ({ id: org.id, name: org.name, ...fireDepartmentStats.get(org.id)! }));
  const droneGroups = await Promise.all(
    allowedDroneGroups.map(async (group) => ({ id: group.id, name: group.name, ...(await getDroneGroupStats(group.id)) })),
  );
  const bezirksweitStats = canSendBezirksweit ? await getDroneGroupStats(null) : null;

  // Nur Termine der Organisationen/Drohnengruppen laden, an die DIESER Nutzer überhaupt senden darf -
  // sonst sieht z.B. ein Feuerwehr-Admin Titel/Datum fremder Feuerwehren, für die canViewEvent ihm nie
  // Zugriff gäbe (Finding 3 der Abschluss-Review), und relevantEvents in news-form.tsx (take: 50, sortiert
  // nach startsAt) verliert bei Bezirks-Größenordnung leicht den eigenen anstehenden Termin.
  const eventVisibilityOr: Prisma.EventWhereInput[] = [];
  if (allowedFireDepartments.length > 0) {
    eventVisibilityOr.push({
      category: 'ALLGEMEIN',
      organizationId: { in: allowedFireDepartments.map((org) => org.id) },
    });
  }
  const droneGroupOr: Prisma.EventWhereInput[] = [];
  if (allowedDroneGroups.length > 0) {
    droneGroupOr.push({ droneGroupId: { in: allowedDroneGroups.map((group) => group.id) } });
  }
  if (canSendBezirksweit) {
    droneGroupOr.push({ droneGroupId: null });
  }
  if (droneGroupOr.length > 0) {
    eventVisibilityOr.push({ category: 'DROHNENGRUPPE', OR: droneGroupOr });
  }

  const upcomingEvents =
    eventVisibilityOr.length === 0
      ? []
      : await prisma.event.findMany({
          where: { startsAt: { gte: new Date() }, OR: eventVisibilityOr },
          orderBy: { startsAt: 'asc' },
          take: 50,
          select: { id: true, title: true, startsAt: true, organizationId: true, droneGroupId: true, category: true },
        });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-neutral-900">Neue News</h1>
      <NewsForm
        fireDepartments={fireDepartments}
        droneGroups={droneGroups}
        bezirksweitStats={bezirksweitStats}
        events={upcomingEvents.map((event) => ({
          id: event.id,
          label: `${event.title} · ${event.startsAt.toLocaleDateString('de-AT')}`,
          organizationId: event.organizationId,
          droneGroupId: event.droneGroupId,
          isDroneEvent: event.category === 'DROHNENGRUPPE',
        }))}
        action={createNewsPost}
      />
    </div>
  );
}
