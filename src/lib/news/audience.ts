import type { NewsAudience, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

export function getNewsPostStatus(post: { scheduledAt: Date | null; sentAt: Date | null }): 'DRAFT' | 'SCHEDULED' | 'SENT' {
  if (post.sentAt) return 'SENT';
  if (post.scheduledAt) return 'SCHEDULED';
  return 'DRAFT';
}

/** Einzige Quelle der Sichtbarkeitsregel - siehe Global Constraints zur Prisma-undefined-Falle:
 * droneGroupId ist eine reine Skalarspalte auf NewsPost (keine Relation), daher wird der
 * "null ODER meine Gruppe"-OR-Zweig in JS bedingt aufgebaut statt `droneGroupId: x ?? undefined` zu
 * schreiben - Letzteres würde bei x === null das Feld für Prisma komplett aus der Abfrage entfernen und
 * damit JEDE Gruppe matchen, nicht nur "alle Gruppen"-Beiträge.
 *
 * `canViewDroneModule` gate: exakt wie bei canViewEvent für DROHNENGRUPPE-Termine (siehe
 * src/lib/auth/permissions.ts) darf ein Nutzer ohne eigene Drohnengruppen-Mitgliedschaft und ohne
 * Bezirks-Drohnenadmin-Recht KEINE DRONE_GROUP-Beiträge sehen - auch nicht die bezirksweiten
 * (droneGroupId === null). Ohne dieses Gate würde jeder normale Feuerwehr-Mitglied (bei dem
 * droneGroupId ebenfalls null ist, weil er/sie schlicht kein Drohnengruppen-Mitglied ist) fälschlich
 * in den `{droneGroupId: null}`-Zweig fallen und bezirksweite Drohnengruppen-News lesen können. */
export function buildVisibilityWhere(user: {
  homeOrganizationId: string;
  droneGroupId: string | null;
  canViewDroneModule: boolean;
}): Prisma.NewsPostWhereInput {
  return {
    sentAt: { not: null },
    OR: [
      { audience: 'FIRE_DEPARTMENT', fireDepartmentId: user.homeOrganizationId },
      ...(user.canViewDroneModule
        ? [
            {
              audience: 'DRONE_GROUP' as const,
              OR: user.droneGroupId ? [{ droneGroupId: null }, { droneGroupId: user.droneGroupId }] : [{ droneGroupId: null }],
            },
          ]
        : []),
    ],
  };
}

export interface VisibleNewsPost {
  id: string;
  audience: NewsAudience;
  fireDepartmentId: string | null;
  droneGroupId: string | null;
  title: string;
  body: string;
  eventId: string | null;
  sentAt: Date;
  createdAt: Date;
  createdByName: string;
  isRead: boolean;
}

/** Einzige Lesequelle für "welche News sieht dieser Nutzer" - /news, die Startbildschirm-Karte und der
 * Glocken-Zähler rufen alle diese (bzw. getUnreadNewsCount, das denselben buildVisibilityWhere-Ausschnitt
 * teilt) auf, nie eigene Prisma-Queries mit paralleler Sichtbarkeitslogik. */
export async function getVisibleNews(userId: string): Promise<VisibleNewsPost[]> {
  const dbUser = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { homeOrganizationId: true, isBezirksDrohnenAdmin: true, droneMembership: { select: { droneGroupId: true } } },
  });
  const user = {
    homeOrganizationId: dbUser.homeOrganizationId,
    droneGroupId: dbUser.droneMembership?.droneGroupId ?? null,
    canViewDroneModule: dbUser.isBezirksDrohnenAdmin || dbUser.droneMembership !== null,
  };

  const posts = await prisma.newsPost.findMany({
    where: buildVisibilityWhere(user),
    include: {
      createdBy: { select: { firstName: true, lastName: true } },
      reads: { where: { userId }, select: { userId: true } },
    },
    orderBy: { sentAt: 'desc' },
  });

  return posts.map((post) => ({
    id: post.id,
    audience: post.audience,
    fireDepartmentId: post.fireDepartmentId,
    droneGroupId: post.droneGroupId,
    title: post.title,
    body: post.body,
    eventId: post.eventId,
    sentAt: post.sentAt!,
    createdAt: post.createdAt,
    createdByName: `${post.createdBy.firstName} ${post.createdBy.lastName}`,
    isRead: post.reads.length > 0,
  }));
}

/** Reine COUNT-Abfrage für den Glocken-Badge - teilt buildVisibilityWhere mit getVisibleNews statt einer
 * eigenen, potenziell abweichenden Sichtbarkeitsbedingung, holt aber keine vollen Beitragskörper. */
export async function getUnreadNewsCount(userId: string): Promise<number> {
  const dbUser = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { homeOrganizationId: true, isBezirksDrohnenAdmin: true, droneMembership: { select: { droneGroupId: true } } },
  });
  const user = {
    homeOrganizationId: dbUser.homeOrganizationId,
    droneGroupId: dbUser.droneMembership?.droneGroupId ?? null,
    canViewDroneModule: dbUser.isBezirksDrohnenAdmin || dbUser.droneMembership !== null,
  };
  return prisma.newsPost.count({
    where: { ...buildVisibilityWhere(user), reads: { none: { userId } } },
  });
}

/** Zielgruppe für den tatsächlichen Push-Versand (dispatch-news.ts) - beantwortet "welche Nutzer sollen
 * DIESEN Beitrag benachrichtigt bekommen", nicht "was kann DIESER Nutzer sehen" (das ist getVisibleNews). */
export async function resolveNewsAudienceUserIds(post: {
  audience: NewsAudience;
  fireDepartmentId: string | null;
  droneGroupId: string | null;
}): Promise<string[]> {
  if (post.audience === 'DRONE_GROUP') {
    // droneGroupId null bedeutet "alle Gruppen". Das explizite `is: {...}` (statt eines nackten
    // droneGroupId-Felds) verlangt weiterhin, dass die droneMembership-Relation existiert - ein auf
    // undefined gesetztes Feld ließe Prisma dieses Feld bei einem VERSCHACHTELTEN Relations-Filter gar
    // nicht filtern (anders als bei einer nackten Skalarspalte, siehe buildVisibilityWhere oben) - live
    // bereits einmal bestätigter Bug, siehe src/lib/push/audience.ts's resolveEventAudienceUserIds.
    const members = await prisma.user.findMany({
      where: { isActive: true, droneMembership: { is: { droneGroupId: post.droneGroupId ?? undefined } } },
      select: { id: true },
    });
    return members.map((m) => m.id);
  }
  if (!post.fireDepartmentId) return [];
  const members = await prisma.user.findMany({
    where: { homeOrganizationId: post.fireDepartmentId, isActive: true },
    select: { id: true },
  });
  return members.map((m) => m.id);
}
