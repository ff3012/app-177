import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canSendAnyNews, canManageNewsPost } from '@/lib/auth/permissions';
import { getVisibleNews, getNewsPostStatus } from '@/lib/news/audience';
import { markAllNewsRead } from './actions';

const PAGE_SIZE = 30;

const AUDIENCE_STRIPE_CLASS: Record<'FIRE_DEPARTMENT' | 'DRONE_GROUP', string> = {
  FIRE_DEPARTMENT: 'bg-[#1c1c1e]',
  DRONE_GROUP: 'bg-[#22a06b]',
};

type FilterValue = 'ALLE' | 'FIRE_DEPARTMENT' | 'DRONE_GROUP';

export default async function NewsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string }>;
}) {
  const user = await requireUser();
  const { filter: rawFilter, page: rawPage } = await searchParams;
  const filter: FilterValue = rawFilter === 'FIRE_DEPARTMENT' || rawFilter === 'DRONE_GROUP' ? rawFilter : 'ALLE';
  const page = Math.max(1, Number.parseInt(rawPage ?? '1', 10) || 1);

  const allVisible = await getVisibleNews(user.id);
  const filtered = filter === 'ALLE' ? allVisible : allVisible.filter((post) => post.audience === filter);
  const unreadCount = allVisible.filter((post) => !post.isRead).length;
  const pageStart = (page - 1) * PAGE_SIZE;
  const pagePosts = filtered.slice(pageStart, pageStart + PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const fireDepartmentCount = allVisible.filter((post) => post.audience === 'FIRE_DEPARTMENT').length;
  const droneGroupCount = allVisible.filter((post) => post.audience === 'DRONE_GROUP').length;

  const canCompose = canSendAnyNews(user);
  let draftsAndScheduled: Awaited<ReturnType<typeof loadDraftsAndScheduled>> = [];
  if (canCompose) {
    draftsAndScheduled = await loadDraftsAndScheduled(user);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">Nachrichten</h1>
          {unreadCount > 0 && (
            <div className="flex items-center gap-2">
              <p className="text-sm text-neutral-500">{unreadCount} ungelesen</p>
              <form action={markAllNewsRead}>
                <button type="submit" className="text-sm font-medium text-brand hover:underline">
                  Alle gelesen
                </button>
              </form>
            </div>
          )}
        </div>
        {canCompose && (
          <Link href="/news/neu" className="rounded bg-brand px-3 py-1.5 font-medium text-white hover:bg-brand-dark">
            Verfassen
          </Link>
        )}
      </div>

      <div className="flex gap-2 text-sm">
        {(
          [
            ['ALLE', `Alle ${allVisible.length}`],
            ['FIRE_DEPARTMENT', `Feuerwehr ${fireDepartmentCount}`],
            ['DRONE_GROUP', `Drohnen ${droneGroupCount}`],
          ] as const
        ).map(([value, label]) => (
          <Link
            key={value}
            href={value === 'ALLE' ? '/news' : `/news?filter=${value}`}
            className={`rounded-full px-3 py-1 ${filter === value ? 'bg-brand text-white' : 'bg-neutral-100 text-neutral-700'}`}
          >
            {label}
          </Link>
        ))}
      </div>

      {pagePosts.length === 0 ? (
        <div className="rounded-lg bg-white p-6 text-center text-sm text-neutral-500 shadow-sm">Noch keine Nachrichten.</div>
      ) : (
        <ul className="flex flex-col overflow-hidden rounded-lg bg-white shadow-sm">
          {pagePosts.map((post) => (
            <li key={post.id} className="flex border-b border-neutral-100 last:border-0">
              <span className={`w-1.5 flex-none ${post.isRead ? 'bg-neutral-200' : AUDIENCE_STRIPE_CLASS[post.audience]}`} />
              <Link href={`/news/${post.id}`} prefetch={false} className="flex flex-1 items-start gap-2 px-4 py-3">
                {!post.isRead && <span aria-hidden className="mt-1.5 h-2 w-2 flex-none rounded-full bg-brand" />}
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{post.createdByName}</p>
                  <p className={`truncate ${post.isRead ? 'font-medium text-neutral-600' : 'font-semibold text-neutral-900'}`}>
                    {post.title}
                  </p>
                  <p className="line-clamp-2 text-sm text-neutral-500">{post.body}</p>
                </div>
                <span className="flex-none whitespace-nowrap text-xs text-neutral-400">{post.sentAt.toLocaleDateString('de-AT')}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          {page > 1 && (
            <Link href={`/news?filter=${filter}&page=${page - 1}`} className="text-brand hover:underline">
              ← Zurück
            </Link>
          )}
          <span className="text-neutral-500">
            Seite {page} von {totalPages}
          </span>
          {page < totalPages && (
            <Link href={`/news?filter=${filter}&page=${page + 1}`} className="text-brand hover:underline">
              Weiter →
            </Link>
          )}
        </div>
      )}

      {canCompose && draftsAndScheduled.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-neutral-900">Entwürfe &amp; Geplant</h2>
          <ul className="flex flex-col overflow-hidden rounded-lg bg-white shadow-sm">
            {draftsAndScheduled.map((post) => (
              <li key={post.id} className="flex items-center justify-between gap-2 border-b border-neutral-100 px-4 py-3 last:border-0">
                <div className="min-w-0">
                  <p className="truncate font-medium text-neutral-900">{post.title}</p>
                  <p className="text-xs text-neutral-500">
                    {getNewsPostStatus(post) === 'DRAFT' ? 'Entwurf' : `Geplant für ${post.scheduledAt!.toLocaleString('de-AT')}`}
                  </p>
                </div>
                <Link href={`/news/${post.id}/bearbeiten`} className="flex-none text-sm text-brand hover:underline">
                  Bearbeiten
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

async function loadDraftsAndScheduled(user: Awaited<ReturnType<typeof requireUser>>) {
  const posts = await prisma.newsPost.findMany({
    where: { sentAt: null },
    include: { droneGroup: { select: { id: true, organizationId: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return posts.filter((post) => canManageNewsPost(user, post, post.droneGroup));
}
