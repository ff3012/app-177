/**
 * Abgeleiteter 3-Zustands-Status eines Benutzers - kein eigenes DB-Feld, sondern aus den
 * bestehenden Feldern `isActive` + `passwordChangedAt` berechnet:
 * - AKTIV: isActive true.
 * - INAKTIV: isActive false UND noch nie ein Passwort gesetzt (passwordChangedAt null) - der
 *   Benutzer wurde angelegt, hat sich aber noch nie aktiviert. Für Atemschutz/Drohnengruppe
 *   weiterhin wie ein aktives Mitglied behandelt (siehe NOT_DEACTIVATED_WHERE), damit bereits
 *   absolvierte Untersuchungen/Flüge sofort erfasst werden können.
 * - DEAKTIVIERT: isActive false UND schon einmal ein Passwort gesetzt (passwordChangedAt gesetzt)
 *   - ein Benutzer, der aktiv war und dann bewusst deaktiviert wurde. `passwordChangedAt` wird nie
 *   wieder auf null zurückgesetzt (auch nicht bei einer erneuten Deaktivierung), daher bleibt diese
 *   Unterscheidung über beliebig viele Aktivieren/Deaktivieren-Zyklen hinweg stabil.
 */
export type UserStatus = 'AKTIV' | 'INAKTIV' | 'DEAKTIVIERT';

export function getUserStatus(user: { isActive: boolean; passwordChangedAt: Date | string | null }): UserStatus {
  if (user.isActive) return 'AKTIV';
  return user.passwordChangedAt ? 'DEAKTIVIERT' : 'INAKTIV';
}

/**
 * Prisma-where-Fragment für "kein bewusst deaktivierter Benutzer" - die Sichtbarkeitsregel für die
 * Atemschutz-Tabelle (admin/heimatfeuerwehr) und die Drohnengruppe (listDrohnengruppeMembers,
 * isEligiblePilot): ein INAKTIV-Benutzer (noch nie aktiviert) bleibt sichtbar/wählbar, ein
 * DEAKTIVIERT-Benutzer nicht mehr - seine Daten (Atemschutz-Felder, DroneFlight-Zeilen) bleiben
 * dabei unverändert in der Datenbank stehen, nur die Anzeige/Auswahl blendet ihn aus.
 */
export const NOT_DEACTIVATED_WHERE = {
  OR: [{ isActive: true }, { isActive: false, passwordChangedAt: null }],
};
