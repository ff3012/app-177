import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManageNews } from '@/lib/auth/permissions';
import { NewsForm } from '@/components/news/news-form';
import { createNewsMessage } from '../actions';

export default async function NeueNewsPage() {
  const user = await requireUser();
  if (!canManageNews(user)) {
    return <p className="text-neutral-700">Dieser Bereich ist nur für die Abschnittskommando-Verwaltung sichtbar.</p>;
  }

  const [organizations, droneGroups] = await Promise.all([
    prisma.organization.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
    prisma.droneGroup.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-neutral-900">Neue News</h1>
      <NewsForm organizations={organizations} droneGroups={droneGroups} action={createNewsMessage} />
    </div>
  );
}
