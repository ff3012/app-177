import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManageNewsPost, canSendNewsToFireDepartment, canSendNewsToDroneGroup } from '@/lib/auth/permissions';
import { NewsForm } from '@/components/news/news-form';
import { updateNewsPost, deleteNewsPost } from '../../actions';

export default async function BearbeitenNewsPage({ params }: { params: Promise<{ newsPostId: string }> }) {
  const user = await requireUser();
  const { newsPostId } = await params;

  const post = await prisma.newsPost.findUnique({
    where: { id: newsPostId },
    include: { droneGroup: { select: { id: true, organizationId: true } } },
  });
  if (!post) notFound();
  if (post.sentAt) notFound();
  if (!canManageNewsPost(user, post, post.droneGroup)) notFound();

  const [allFireDepartments, allDroneGroups] = await Promise.all([
    prisma.organization.findMany({ where: { isActive: true, type: 'FEUERWEHR' }, orderBy: { name: 'asc' } }),
    prisma.droneGroup.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
  ]);
  const fireDepartments = allFireDepartments
    .filter((org) => canSendNewsToFireDepartment(user, org.id))
    .map((org) => ({ id: org.id, name: org.name, memberCount: 0, pushCount: 0 }));
  const droneGroups = allDroneGroups
    .filter((group) => canSendNewsToDroneGroup(user, { id: group.id, organizationId: group.organizationId }))
    .map((group) => ({ id: group.id, name: group.name, memberCount: 0, pushCount: 0 }));

  const boundUpdate = updateNewsPost.bind(null, post.id);
  const boundDelete = deleteNewsPost.bind(null, post.id);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900">News bearbeiten</h1>
        <form action={boundDelete}>
          <button type="submit" className="text-sm text-red-700 hover:underline">
            Löschen
          </button>
        </form>
      </div>
      <NewsForm
        fireDepartments={fireDepartments}
        droneGroups={droneGroups}
        bezirksweitStats={null}
        events={[]}
        existingPost={{
          title: post.title,
          body: post.body,
          audience: post.audience,
          fireDepartmentId: post.fireDepartmentId,
          droneGroupId: post.droneGroupId,
          eventId: post.eventId,
          scheduledAt: post.scheduledAt,
        }}
        action={boundUpdate}
      />
    </div>
  );
}
