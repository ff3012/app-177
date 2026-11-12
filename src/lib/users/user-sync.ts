import { DroneRole, MembershipRole } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import {
  assertPermission,
  canGrantMcpAccess,
  canManageDroneGroupFor,
  canManageUsersFor,
  filterRemovableAdminOrgIds,
} from '@/lib/auth/permissions';
import { FEUERWEHR_KATEGORIE_LABEL } from '@/lib/organizations/feuerwehr-kategorie';
import { getMcpAccessOf } from '@/lib/mcp/access-db';
import type { McpAccessLevel } from '@/lib/mcp/access';
import { AUSBILDUNGSSTUFEN, type Ausbildungsstufe, type DroneRoleOption } from '@/lib/validation/user.schema';
import type { SessionUser } from '@/types/next-auth';

export type FieldErrors = Record<string, string[] | undefined>;

/** Ein Feuerwehr-Admin darf "Admin für" nur für Feuerwehren vergeben, die er selbst verwaltet -
 * sonst könnte er über die Benutzerverwaltung Admin-Rechte für fremde Feuerwehren verteilen. Die
 * UI (organizations-Prop in page.tsx) bietet einem Feuerwehr-Admin ohnehin nur die eigene(n)
 * Feuerwehr(en) als Checkbox-Optionen an - dies ist die serverseitige Absicherung gegen einen
 * direkten Server-Action-Aufruf, der diese UI-Einschränkung umgeht. */
export function canGrantAdminFor(currentUser: SessionUser, adminOrgIds: string[]): boolean {
  return adminOrgIds.every((organizationId) => canManageUsersFor(currentUser, organizationId));
}

/**
 * canGrantAdminFor oben deckt nur das HINZUFÜGEN ab. Beim Entfernen wurde vorher pauschal
 * `deleteMany({ organizationId: { notIn: adminOrgIds } })` ausgeführt - nur nach userId/role gescoped,
 * ohne zu prüfen, ob der Aufrufer die dabei gelöschte Organisation überhaupt verwalten darf. Bei einem
 * leeren adminOrgIds-Array (UI-Fehler oder direkter Server-Action-Aufruf) passierte canGrantAdminFor([])
 * leer-wahr und `notIn: []` schloss nichts aus - es wurden ALLE Admin-Mitgliedschaften des Zielbenutzers
 * gelöscht, auch die für fremde Organisationen (z. B. ein Abschnittskommando). Daher wird die zu
 * löschende Menge jetzt explizit ermittelt und auf Organisationen im eigenen Verwaltungsbereich gefiltert:
 * eine Mitgliedschaft für eine Organisation, über die der Aufrufer kein Recht hat, bleibt unangetastet.
 */
export async function syncAdminMemberships(currentUser: SessionUser, userId: string, adminOrgIds: string[]) {
  const existingAdminMemberships = await prisma.membership.findMany({
    where: { userId, role: MembershipRole.ADMIN },
    select: { organizationId: true },
  });
  const removableOrgIds = filterRemovableAdminOrgIds(
    currentUser,
    existingAdminMemberships.map((m) => m.organizationId),
    adminOrgIds,
  );

  if (removableOrgIds.length > 0) {
    await prisma.membership.deleteMany({
      where: { userId, role: MembershipRole.ADMIN, organizationId: { in: removableOrgIds } },
    });
  }
  for (const organizationId of adminOrgIds) {
    await prisma.membership.upsert({
      where: { userId_organizationId_role: { userId, organizationId, role: MembershipRole.ADMIN } },
      update: {},
      create: { userId, organizationId, role: MembershipRole.ADMIN },
    });
  }
}

export type AusbildungsDaten = Record<Ausbildungsstufe, string>;

function toAusbildungsUpdate(daten: AusbildungsDaten) {
  return {
    a1a3LizenzAm: daten.a1a3LizenzAm ? new Date(daten.a1a3LizenzAm) : null,
    a2LizenzAm: daten.a2LizenzAm ? new Date(daten.a2LizenzAm) : null,
    stuetzpunktausbildungAm: daten.stuetzpunktausbildungAm ? new Date(daten.stuetzpunktausbildungAm) : null,
    bos1AusbildungAm: daten.bos1AusbildungAm ? new Date(daten.bos1AusbildungAm) : null,
    bos2AusbildungAm: daten.bos2AusbildungAm ? new Date(daten.bos2AusbildungAm) : null,
  };
}

/**
 * Die Drohnengruppe wird vom Client mitgeschickt - ohne eigene Prüfung konnte sich damit JEDER, der
 * überhaupt in die Benutzerverwaltung kommt (auch ein reiner Feuerwehr-Admin, siehe
 * canAccessUserManagementAdmin), am eigenen Datensatz die ADMIN-Rolle einer BELIEBIGEN der Gruppen
 * geben - inklusive einer an einem fremden Abschnitt verankerten - und damit deren Drohnen, Unterlagen,
 * Mitgliederliste, Benachrichtigungsadresse und den öffentlichen QR-Schnellerfassungs-Token übernehmen.
 * canManageDroneGroupFor ist dieselbe Funktion, die /admin/drohnen absichert; hier gilt sie für die
 * Frage "wer darf jemanden IN diese Gruppe aufnehmen/daraus entfernen".
 *
 * Geprüft wird nur, wenn sich an der Mitgliedschaft tatsächlich etwas ändert - sonst könnte ein
 * Feuerwehr-Admin einen Benutzer seiner Feuerwehr, der zufällig in einer fremden Drohnengruppe ist,
 * überhaupt nicht mehr bearbeiten (das Formular schickt dessen unveränderte Gruppe ja immer mit).
 * Ändert sich etwas, müssen BEIDE betroffenen Gruppen (bisherige und neue) im Recht des Aufrufers
 * liegen - sonst ließe sich über droneRole='NONE' eine fremde Gruppenmitgliedschaft entfernen.
 *
 * Seit der Ausbildungsstufen-Erweiterung gilt dieselbe Prüfung auch für eine reine
 * Ausbildungsdaten-Änderung ohne Rollen-/Gruppenwechsel (siehe ausbildungChanged unten).
 */
export async function syncDroneMembership(
  currentUser: SessionUser,
  userId: string,
  droneRole: DroneRoleOption,
  droneGroupId: string | null,
  ausbildung: AusbildungsDaten,
) {
  const existing = await prisma.drohnengruppeMembership.findUnique({ where: { userId } });
  const currentRole: DroneRoleOption = !existing ? 'NONE' : existing.role === DroneRole.ADMIN ? 'ADMIN' : 'PILOT';
  const currentGroupId = existing?.droneGroupId ?? null;
  const targetGroupId = droneRole === 'NONE' ? null : droneGroupId;

  const ausbildungChanged =
    existing !== null &&
    AUSBILDUNGSSTUFEN.some((key) => {
      const current = existing[key];
      const currentStr = current ? current.toISOString().slice(0, 10) : '';
      return currentStr !== ausbildung[key];
    });

  if (currentRole === droneRole && currentGroupId === targetGroupId && !ausbildungChanged) {
    return;
  }

  const affectedGroupIds = Array.from(
    new Set([currentGroupId, targetGroupId].filter((id): id is string => Boolean(id))),
  );
  for (const groupId of affectedGroupIds) {
    const group = await prisma.droneGroup.findUnique({
      where: { id: groupId },
      select: { id: true, organizationId: true },
    });
    assertPermission(
      group !== null && canManageDroneGroupFor(currentUser, group),
      'Keine Berechtigung, Mitglieder dieser Drohnengruppe zu verwalten.',
    );
  }

  if (droneRole === 'NONE') {
    await prisma.drohnengruppeMembership.deleteMany({ where: { userId } });
    return;
  }
  if (!droneGroupId) {
    throw new Error('Drohnengruppe ist erforderlich, wenn eine Rolle gewählt wurde.');
  }
  const role = droneRole === 'ADMIN' ? DroneRole.ADMIN : DroneRole.PILOT;
  const ausbildungUpdate = toAusbildungsUpdate(ausbildung);
  await prisma.drohnengruppeMembership.upsert({
    where: { userId },
    update: { role, droneGroupId, ...ausbildungUpdate },
    create: { userId, role, droneGroupId, ...ausbildungUpdate },
  });
}

/**
 * Prüft die Design-Regel aus docs/superpowers/specs/2026-08-25-zweite-heimatfeuerwehr-design.md:
 * secondaryOrganizationId muss auf eine andere feuerwehrKategorie zeigen als homeOrganizationId
 * (eine FF + eine BTF, nie zwei vom selben Typ). Nur app-seitig geprüft (kein DB-Constraint), da
 * beide Kategorien serverseitig geladen werden müssen - kann nicht als synchrones Zod-.refine()
 * ausgedrückt werden. Gibt bei Verletzung ein fieldErrors-Objekt zurück (gleiche Form wie
 * userSchema.safeParse's eigene Fehler), sonst null.
 */
export async function validateSecondaryOrganizationCategory(
  homeOrganizationId: string,
  secondaryOrganizationId: string,
): Promise<FieldErrors | null> {
  if (!secondaryOrganizationId) return null;
  const [home, secondary] = await Promise.all([
    prisma.organization.findUnique({ where: { id: homeOrganizationId }, select: { feuerwehrKategorie: true } }),
    prisma.organization.findUnique({ where: { id: secondaryOrganizationId }, select: { feuerwehrKategorie: true } }),
  ]);
  if (!home || !secondary) {
    return { secondaryOrganizationId: ['Feuerwehr wurde nicht gefunden.'] };
  }
  if (home.feuerwehrKategorie === secondary.feuerwehrKategorie) {
    const label = FEUERWEHR_KATEGORIE_LABEL[home.feuerwehrKategorie];
    const otherLabel =
      home.feuerwehrKategorie === 'FREIWILLIGE_FEUERWEHR'
        ? FEUERWEHR_KATEGORIE_LABEL.BETRIEBSFEUERWEHR
        : FEUERWEHR_KATEGORIE_LABEL.FREIWILLIGE_FEUERWEHR;
    return {
      secondaryOrganizationId: [
        `Diese Feuerwehr hat dieselbe Kategorie (${label}) wie die Heimat-Feuerwehr — bitte eine ${otherLabel} wählen.`,
      ],
    };
  }
  return null;
}

/**
 * Wirft ForbiddenError, wenn currentUser die MCP-Stufe von `target` nicht auf `newLevel` setzen darf
 * (canGrantMcpAccess mit der AKTUELLEN eigenen Stufe aus der Datenbank). Wird NUR aufgerufen, wenn sich die Stufe
 * tatsächlich ändert (bzw. beim Anlegen `newLevel !== 'NONE'`).
 */
export async function assertGrantMcpAccess(
  currentUser: SessionUser,
  target: { homeOrganizationId: string; mcpAccess: McpAccessLevel },
  newLevel: McpAccessLevel,
): Promise<void> {
  assertPermission(
    canGrantMcpAccess(currentUser, await getMcpAccessOf(currentUser.id), target, newLevel),
    'Keine Berechtigung, dieses MCP-Recht zu vergeben.',
  );
}
