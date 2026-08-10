import { cache } from 'react';
import { prisma } from '@/lib/db/prisma';
import { isBezirksAdmin } from '@/lib/auth/permissions';
import { getAbschnittOrganizationId } from '@/lib/organizations/abschnitt';
import type { SessionUser } from '@/types/next-auth';

export type AdminScope =
  | { level: 'BEZIRK' }
  | { level: 'ABSCHNITT'; organizationId: string; name: string }
  | { level: 'FEUERWEHR'; organizationId: string; name: string; abschnittOrganizationId: string };

/**
 * Alle Geltungsbereiche, die dieser Benutzer tatsächlich verwalten darf - Grundlage für den
 * Geltungsbereich-Wähler (Verwaltung-Filter-Brief.md §2, Design-Spec §4). Baut ausschließlich auf
 * bereits etablierten SessionUser-Feldern auf (isBezirksAdmin/abschnittAdminOrgIds/
 * feuerwehrAdminOrgIds), keine neue Rechteentscheidung - nur eine neue Sicht auf bestehende. Kann
 * für einen reinen Drohnengruppen-/Bezirks-Drohnenadmin ohne jedes Organisations-Admin-Recht ein
 * leeres Array liefern - das ist korrekt, dieser Nutzer hat schlicht keinen Bezirk/Abschnitt/
 * Feuerwehr-Geltungsbereich (nur /admin/drohnen, das dieses Konzept nicht verwendet).
 */
export const getReachableScopes = cache(async (user: SessionUser): Promise<AdminScope[]> => {
  if (isBezirksAdmin(user)) {
    const [abschnitte, feuerwehren] = await Promise.all([
      prisma.organization.findMany({
        where: { type: 'ABSCHNITTSKOMMANDO' },
        select: { id: true, name: true, shortName: true },
        orderBy: { name: 'asc' },
      }),
      prisma.organization.findMany({
        where: { type: 'FEUERWEHR' },
        select: { id: true, name: true, shortName: true, parentId: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    // orderBy: { name: 'asc' } sortiert nach der rohen DB-Spalte - manche Betriebsfeuerwehren haben
    // aber ein shortName ohne "FF "-Präfix, das von der tatsächlich angezeigten Reihenfolge abweicht.
    // Da shortName ?? name erst nach dem Laden feststeht, wird hier zusätzlich in JS nach dem
    // tatsächlich angezeigten Namen sortiert.
    const sortedAbschnitte = abschnitte
      .map((org) => ({ level: 'ABSCHNITT' as const, organizationId: org.id, name: org.shortName ?? org.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const sortedFeuerwehren = feuerwehren
      .map((org) => ({
        level: 'FEUERWEHR' as const,
        organizationId: org.id,
        name: org.shortName ?? org.name,
        abschnittOrganizationId: getAbschnittOrganizationId({ type: 'FEUERWEHR', id: org.id, parentId: org.parentId }),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return [{ level: 'BEZIRK' }, ...sortedAbschnitte, ...sortedFeuerwehren];
  }

  const scopes: AdminScope[] = [];
  const coveredFeuerwehrIds = new Set<string>();

  if (user.abschnittAdminOrgIds.length > 0) {
    const [abschnitte, feuerwehren] = await Promise.all([
      prisma.organization.findMany({
        where: { id: { in: user.abschnittAdminOrgIds } },
        select: { id: true, name: true, shortName: true },
        orderBy: { name: 'asc' },
      }),
      prisma.organization.findMany({
        where: { parentId: { in: user.abschnittAdminOrgIds } },
        select: { id: true, name: true, shortName: true, parentId: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    const sortedAbschnitte = abschnitte
      .map((org) => ({ level: 'ABSCHNITT' as const, organizationId: org.id, name: org.shortName ?? org.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const sortedFeuerwehren = feuerwehren
      .map((org) => ({
        level: 'FEUERWEHR' as const,
        organizationId: org.id,
        name: org.shortName ?? org.name,
        abschnittOrganizationId: getAbschnittOrganizationId({ type: 'FEUERWEHR', id: org.id, parentId: org.parentId }),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const scope of sortedAbschnitte) {
      scopes.push(scope);
    }
    for (const scope of sortedFeuerwehren) {
      scopes.push(scope);
      coveredFeuerwehrIds.add(scope.organizationId);
    }
  }

  // feuerwehrAdminOrgIds enthält bereits jede Feuerwehr aus der Abschnitts-Vererbung oben (siehe
  // build-session-user.ts) PLUS jede direkt verwaltete Feuerwehr - hier bleiben nur die direkten
  // übrig, die oben noch nicht als Teil eines verwalteten Abschnitts gezählt wurden.
  const directFeuerwehrIds = user.feuerwehrAdminOrgIds.filter(
    (id) => !coveredFeuerwehrIds.has(id) && !user.abschnittAdminOrgIds.includes(id),
  );
  if (directFeuerwehrIds.length > 0) {
    const feuerwehren = await prisma.organization.findMany({
      where: { id: { in: directFeuerwehrIds } },
      select: { id: true, name: true, shortName: true, parentId: true },
      orderBy: { name: 'asc' },
    });
    const sortedFeuerwehren = feuerwehren
      .map((org) => ({
        level: 'FEUERWEHR' as const,
        organizationId: org.id,
        name: org.shortName ?? org.name,
        abschnittOrganizationId: getAbschnittOrganizationId({ type: 'FEUERWEHR', id: org.id, parentId: org.parentId }),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const scope of sortedFeuerwehren) {
      scopes.push(scope);
    }
  }

  return scopes;
});

const LEVEL_ORDER: Record<AdminScope['level'], number> = { BEZIRK: 0, ABSCHNITT: 1, FEUERWEHR: 2 };

function sortScopes(scopes: AdminScope[]): AdminScope[] {
  return [...scopes].sort((a, b) => {
    if (LEVEL_ORDER[a.level] !== LEVEL_ORDER[b.level]) return LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level];
    if (a.level === 'BEZIRK') return 0;
    return (a as { name: string }).name.localeCompare((b as { name: string }).name);
  });
}

export interface ScopeResolution {
  scope: AdminScope;
  /** true, wenn der übergebene Parameter zwar syntaktisch gültig, aber für DIESEN Benutzer nicht
   * erreichbar war (fremder Abschnitt/fremde Feuerwehr per URL) - der Aufrufer entscheidet, ob er
   * daraufhin notFound() wirft oder den Fallback stillschweigend übernimmt. In dieser Phase hat das
   * noch keinen Aufrufer außer dem Wähler selbst; ab Phase 3/4, wenn echte Listen danach filtern,
   * wird dieses Feld zur Sicherheitsgrenze. */
  requestedButUnreachable: boolean;
}

/**
 * Reine Funktion (keine DB, keine Session) - löst einen rohen `?ebene=&bereich=`-Parameter gegen die
 * bereits berechnete reachable-Liste auf. Fällt niemals auf einen Wert außerhalb reachable zurück.
 * Voraussetzung: reachable ist nicht leer - der einzige Aufrufer in dieser Phase (der Wähler selbst)
 * rendert ohnehin nur, wenn reachable.length > 1 ist.
 */
export function resolveAdminScope(
  reachable: AdminScope[],
  rawEbene: string | undefined,
  rawOrg: string | undefined,
): ScopeResolution {
  const fallback = sortScopes(reachable)[0];

  if (!rawEbene) {
    return { scope: fallback, requestedButUnreachable: false };
  }

  const match = reachable.find((scope) => {
    if (rawEbene === 'bezirk') return scope.level === 'BEZIRK';
    if (rawEbene === 'abschnitt') return scope.level === 'ABSCHNITT' && scope.organizationId === rawOrg;
    if (rawEbene === 'feuerwehr') return scope.level === 'FEUERWEHR' && scope.organizationId === rawOrg;
    return false;
  });

  if (match) {
    return { scope: match, requestedButUnreachable: false };
  }

  return { scope: fallback, requestedButUnreachable: true };
}
