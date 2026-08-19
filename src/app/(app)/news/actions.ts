'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import {
  assertPermission,
  canManageNewsPost,
  canSendAnyNews,
  canSendBezirksWideDroneNews,
  canSendNewsToDroneGroup,
  canSendNewsToFireDepartment,
} from '@/lib/auth/permissions';
import { newsSchema, parseNewsFormData, type NewsInput } from '@/lib/validation/news.schema';
import { dispatchNewsPost } from '@/lib/news/dispatch-news';
import { getVisibleNews } from '@/lib/news/audience';

export interface NewsFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

/** Serverseitige Gegenprobe zum client-seitigen `relevantEvents`-Filter in news-form.tsx (der nur der
 * Formular-UX dient und keine Sicherheitsgrenze ist) - verhindert, dass ein manipuliertes/veraltetes
 * `eventId`-Feld einen Termin verlinkt, der gar nicht zum gewählten Empfängerkreis des Beitrags passt.
 * Für DRONE_GROUP mit droneGroupId === null (bezirksweit) reicht jeder DROHNENGRUPPE-Termin, unabhängig
 * von dessen eigener droneGroupId - siehe Finding 3 der Abschluss-Review. */
async function validateNewsEventId(data: NewsInput): Promise<boolean> {
  if (!data.eventId) return true;
  const event = await prisma.event.findUnique({
    where: { id: data.eventId },
    select: { organizationId: true, droneGroupId: true, category: true },
  });
  if (!event) return false;

  if (data.audience === 'FIRE_DEPARTMENT') {
    return event.category === 'ALLGEMEIN' && event.organizationId === (data.fireDepartmentId || null);
  }

  if (event.category !== 'DROHNENGRUPPE') return false;
  const droneGroupId = data.droneGroupId || null;
  if (droneGroupId === null) return true;
  return event.droneGroupId === droneGroupId;
}

export async function createNewsPost(_prevState: NewsFormState, formData: FormData): Promise<NewsFormState> {
  const user = await requireUser();
  assertPermission(canSendAnyNews(user));

  const parsed = newsSchema.safeParse(parseNewsFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  if (data.audience === 'FIRE_DEPARTMENT') {
    if (!canSendNewsToFireDepartment(user, data.fireDepartmentId!)) {
      return { error: 'Kein Senderecht für diese Feuerwehr.' };
    }
  } else {
    const droneGroupId = data.droneGroupId || null;
    if (droneGroupId === null) {
      if (!canSendBezirksWideDroneNews(user)) {
        return { error: 'Kein Senderecht für eine bezirksweite Drohnengruppen-Nachricht.' };
      }
    } else {
      const droneGroup = await prisma.droneGroup.findUnique({ where: { id: droneGroupId }, select: { id: true, organizationId: true } });
      if (!droneGroup || !canSendNewsToDroneGroup(user, droneGroup)) {
        return { error: 'Kein Senderecht für diese Drohnengruppe.' };
      }
    }
  }

  if (!(await validateNewsEventId(data))) {
    return { error: 'Ungültiger Termin für diesen Empfängerkreis.' };
  }

  const post = await prisma.newsPost.create({
    data: {
      title: data.title,
      body: data.body,
      audience: data.audience,
      fireDepartmentId: data.audience === 'FIRE_DEPARTMENT' ? data.fireDepartmentId || null : null,
      droneGroupId: data.audience === 'DRONE_GROUP' ? data.droneGroupId || null : null,
      eventId: data.eventId || null,
      scheduledAt: data.sendMode === 'SCHEDULED' && data.scheduledAt ? new Date(data.scheduledAt) : null,
      createdById: user.id,
    },
  });

  if (data.sendMode === 'NOW') {
    try {
      await dispatchNewsPost(post.id);
    } catch (error) {
      console.error('News-Versand fehlgeschlagen:', error);
      return { error: 'News wurde gespeichert, aber der Versand ist fehlgeschlagen. Bitte Push-Konfiguration prüfen.' };
    }
  }

  revalidatePath('/news');
  revalidatePath('/meine-feuerwehr');
  redirect('/news');
}

export async function updateNewsPost(newsPostId: string, _prevState: NewsFormState, formData: FormData): Promise<NewsFormState> {
  const user = await requireUser();
  const existing = await prisma.newsPost.findUnique({
    where: { id: newsPostId },
    include: { droneGroup: { select: { id: true, organizationId: true } } },
  });
  if (!existing) return { error: 'Beitrag wurde nicht gefunden.' };
  if (existing.sentAt) return { error: 'Ein bereits gesendeter Beitrag kann nicht mehr bearbeitet werden.' };
  if (!canManageNewsPost(user, existing, existing.droneGroup)) return { error: 'Kein Zugriff.' };

  const parsed = newsSchema.safeParse(parseNewsFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  if (data.audience === 'FIRE_DEPARTMENT') {
    if (!canSendNewsToFireDepartment(user, data.fireDepartmentId!)) return { error: 'Kein Senderecht für diese Feuerwehr.' };
  } else {
    const droneGroupId = data.droneGroupId || null;
    if (droneGroupId === null) {
      if (!canSendBezirksWideDroneNews(user)) return { error: 'Kein Senderecht für eine bezirksweite Drohnengruppen-Nachricht.' };
    } else {
      const droneGroup = await prisma.droneGroup.findUnique({ where: { id: droneGroupId }, select: { id: true, organizationId: true } });
      if (!droneGroup || !canSendNewsToDroneGroup(user, droneGroup)) return { error: 'Kein Senderecht für diese Drohnengruppe.' };
    }
  }

  if (!(await validateNewsEventId(data))) {
    return { error: 'Ungültiger Termin für diesen Empfängerkreis.' };
  }

  await prisma.newsPost.update({
    where: { id: newsPostId },
    data: {
      title: data.title,
      body: data.body,
      audience: data.audience,
      fireDepartmentId: data.audience === 'FIRE_DEPARTMENT' ? data.fireDepartmentId || null : null,
      droneGroupId: data.audience === 'DRONE_GROUP' ? data.droneGroupId || null : null,
      eventId: data.eventId || null,
      scheduledAt: data.sendMode === 'SCHEDULED' && data.scheduledAt ? new Date(data.scheduledAt) : null,
    },
  });

  if (data.sendMode === 'NOW') {
    try {
      await dispatchNewsPost(newsPostId);
    } catch (error) {
      console.error('News-Versand fehlgeschlagen:', error);
      return { error: 'News wurde gespeichert, aber der Versand ist fehlgeschlagen. Bitte Push-Konfiguration prüfen.' };
    }
  }

  revalidatePath('/news');
  revalidatePath('/meine-feuerwehr');
  redirect('/news');
}

export async function deleteNewsPost(newsPostId: string): Promise<void> {
  const user = await requireUser();
  const existing = await prisma.newsPost.findUnique({
    where: { id: newsPostId },
    include: { droneGroup: { select: { id: true, organizationId: true } } },
  });
  if (!existing) throw new Error('Beitrag wurde nicht gefunden.');
  if (existing.sentAt) throw new Error('Ein bereits gesendeter Beitrag kann nicht gelöscht werden.');
  if (!canManageNewsPost(user, existing, existing.droneGroup)) throw new Error('Kein Zugriff.');

  await prisma.newsPost.delete({ where: { id: newsPostId } });

  revalidatePath('/news');
  redirect('/news');
}

/** "Alle gelesen" (Design-Spec §5, §9.8, §10): markiert jeden für diesen Nutzer sichtbaren, noch
 * ungelesenen Beitrag als gelesen. `createMany` mit `skipDuplicates` statt einem Upsert pro Beitrag in
 * einer Schleife - ein Nutzer kann durchaus dutzende ungelesene Beiträge haben und das soll eine einzige
 * Query bleiben, nicht N sequenzielle Upserts. */
export async function markAllNewsRead(): Promise<void> {
  const user = await requireUser();
  const visible = await getVisibleNews(user.id);
  const unreadPostIds = visible.filter((post) => !post.isRead).map((post) => post.id);

  if (unreadPostIds.length > 0) {
    await prisma.newsRead.createMany({
      data: unreadPostIds.map((newsPostId) => ({ newsPostId, userId: user.id })),
      skipDuplicates: true,
    });
  }

  revalidatePath('/news');
  revalidatePath('/meine-feuerwehr');
}
