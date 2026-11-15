import type { ReportType } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

export const RECENT_ACTIVITY_KIND_LIMIT = 3;

/** Reine Logik: die ersten `limit` verschiedenen Codes in der Reihenfolge der Berichte (neueste zuerst). */
export function distinctRecentKinds(
  reports: { activityKinds: string[] }[],
  limit: number = RECENT_ACTIVITY_KIND_LIMIT,
): string[] {
  const seen = new Set<string>();
  for (const report of reports) {
    for (const code of report.activityKinds) {
      seen.add(code);
      if (seen.size >= limit) return [...seen];
    }
  }
  return [...seen];
}

/** "Zuletzt verwendet" eines Benutzers (App): seine eigenen abgegebenen Berichte desselben Typs. */
export async function getRecentActivityKindsForUser(userId: string, type: ReportType): Promise<string[]> {
  const recent = await prisma.report.findMany({
    where: { filledById: userId, type },
    orderBy: { submittedAt: 'desc' },
    take: 10,
    select: { activityKinds: true },
  });
  return distinctRecentKinds(recent);
}

/** "Zuletzt verwendet" einer Feuerwehr (gemeinsames iPad): alle Berichte der Feuerwehr desselben Typs. */
export async function getRecentActivityKindsForOrg(fireDepartmentId: string, type: ReportType): Promise<string[]> {
  const recent = await prisma.report.findMany({
    where: { fireDepartmentId, type },
    orderBy: { submittedAt: 'desc' },
    take: 10,
    select: { activityKinds: true },
  });
  return distinctRecentKinds(recent);
}
