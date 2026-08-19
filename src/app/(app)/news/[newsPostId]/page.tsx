import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { buildVisibilityWhere } from '@/lib/news/audience';
import { RefreshAfterMarkRead } from '@/components/news/refresh-after-mark-read';

const AUDIENCE_STRIPE_COLOR: Record<'FIRE_DEPARTMENT' | 'DRONE_GROUP', string> = {
  FIRE_DEPARTMENT: '#1c1c1e',
  DRONE_GROUP: '#22a06b',
};

export default async function NewsPostDetailPage({ params }: { params: Promise<{ newsPostId: string }> }) {
  const user = await requireUser();
  const { newsPostId } = await params;

  const post = await prisma.newsPost.findFirst({
    where: {
      id: newsPostId,
      ...buildVisibilityWhere({
        homeOrganizationId: user.homeOrganizationId,
        droneGroupId: user.droneGroupId,
        canViewDroneModule: user.isDrohnengruppeMember || user.isBezirksDrohnenAdmin,
      }),
    },
    include: {
      createdBy: { select: { firstName: true, lastName: true } },
      fireDepartment: { select: { shortName: true, name: true } },
      droneGroup: { select: { name: true } },
      event: { select: { id: true, title: true, startsAt: true } },
    },
  });
  if (!post) notFound();

  // Beim Rendern setzen, nicht bei einem Client-seitigen Scroll-Event (Design-Spec §6) - derselbe
  // "Mutation direkt aus einer Server-Component-Render-Phase" Ansatz wie decideVehicleBooking im
  // Fahrzeug-Reservierungs-Modul. revalidatePath() ist hier wie dort während des Renderns verboten
  // (siehe dessen Kommentar) - anders als bei dessen öffentlichen E-Mail-Link-Seiten wird diese Seite
  // aber ganz normal per <Link>-Klick aus /news bzw. der Startbildschirm-Karte heraus besucht, wo der
  // Next.js-Router-Cache die Glocken-Badge im (app)-Layout sonst veraltet stehen lässt (live auf DEV
  // bestätigt) - deshalb erzwingt <RefreshAfterMarkRead> unten clientseitig einen frischen Reload.
  await prisma.newsRead.upsert({
    where: { newsPostId_userId: { newsPostId: post.id, userId: user.id } },
    create: { newsPostId: post.id, userId: user.id },
    update: {},
  });

  const senderLabel =
    post.audience === 'FIRE_DEPARTMENT'
      ? (post.fireDepartment?.shortName ?? post.fireDepartment?.name ?? '–')
      : (post.droneGroup?.name ?? 'Drohnengruppe (alle Gruppen)');

  return (
    <div className="flex flex-col gap-4">
      <RefreshAfterMarkRead />
      <Link href="/news" className="text-sm text-neutral-600 hover:underline">
        ← Zurück zu Nachrichten
      </Link>
      <div className="overflow-hidden rounded-lg bg-white shadow-sm">
        <div className="h-1.5" style={{ backgroundColor: AUDIENCE_STRIPE_COLOR[post.audience] }} />
        <div className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{senderLabel}</p>
          <h1 className="mt-1 text-[25px] font-bold leading-tight text-neutral-900">{post.title}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {post.sentAt!.toLocaleDateString('de-AT')} ·{' '}
            {post.sentAt!.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })} ·{' '}
            {post.createdBy.firstName} {post.createdBy.lastName}
          </p>
          <div className="mt-4 whitespace-pre-wrap text-[16px] leading-[1.55] text-neutral-800">{post.body}</div>
          {post.event && (
            <Link
              href={`/kalender/${post.event.id}`}
              className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-neutral-50 p-3 text-sm"
            >
              <span className="flex items-center gap-2 text-neutral-800">
                <span aria-hidden>📅</span>
                <span>
                  {post.event.title} · {post.event.startsAt.toLocaleDateString('de-AT')}
                </span>
              </span>
              <span aria-hidden className="text-neutral-400">
                ›
              </span>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
