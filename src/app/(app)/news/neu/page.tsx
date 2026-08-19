import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canSendAnyNews, canSendNewsToFireDepartment, canSendNewsToDroneGroup, canSendBezirksWideDroneNews } from '@/lib/auth/permissions';
import { NewsForm } from '@/components/news/news-form';
import { createNewsPost } from '../actions';

async function getFireDepartmentStats(organizationId: string) {
  const memberCount = await prisma.user.count({ where: { homeOrganizationId: organizationId, isActive: true } });
  const pushCount = await prisma.user.count({
    where: { homeOrganizationId: organizationId, isActive: true, pushSubscriptions: { some: {} } },
  });
  return { memberCount, pushCount };
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

  const fireDepartments = await Promise.all(
    allowedFireDepartments.map(async (org) => ({ id: org.id, name: org.name, ...(await getFireDepartmentStats(org.id)) })),
  );
  const droneGroups = await Promise.all(
    allowedDroneGroups.map(async (group) => ({ id: group.id, name: group.name, ...(await getDroneGroupStats(group.id)) })),
  );
  const bezirksweitStats = canSendBezirksweit ? await getDroneGroupStats(null) : null;

  const upcomingEvents = await prisma.event.findMany({
    where: { startsAt: { gte: new Date() } },
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
