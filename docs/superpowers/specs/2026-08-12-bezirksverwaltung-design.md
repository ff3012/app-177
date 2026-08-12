# Bezirksverwaltung (neues Verwaltungsmodul)

**Status:** Approved, ready for implementation planning.
**Source:** Nutzeranfrage — bislang gibt es keine Admin-UI, um eine Feuerwehr oder Drohnengruppe
anzulegen, umzubenennen oder zu deaktivieren; beides ist reiner Seed-/Migrations-Code (siehe root
`CLAUDE.md`/`admin/CLAUDE.md`, die diese Lücke bereits explizit als bekannt dokumentieren).

## 1. Zweck

Ein neues Verwaltungsmodul **„Bezirksverwaltung"** (`/admin/bezirksverwaltung`), analog zu den
bestehenden Modulen Heimatfeuerwehr/Drohnengruppe/Benutzerverwaltung, mit drei Abschnitten:

1. Verwaltung aller Feuerwehren (Name/Kurzname ändern, neue Feuerwehr anlegen, deaktivieren/reaktivieren).
2. Verwaltung aller Drohnengruppen (Name ändern, neue Gruppe anlegen, deaktivieren/reaktivieren).
3. Read-only Auflistung aller Bezirksadmins (Name, E-Mail, Heimatfeuerwehr) — keine Verwaltung von hier aus.

## 2. Datenmodell

```prisma
model Organization {
  // ...bestehende Felder unverändert...
  isActive Boolean @default(true)
}

model DroneGroup {
  // ...bestehende Felder unverändert...
  isActive Boolean @default(true)
}
```

Additive Migration, kein Backfill nötig — `default(true)` ist für jede bestehende Zeile korrekt
(alle 124 Feuerwehren und alle 4 Drohnengruppen sind heute aktiv). Kein neues Feld auf `User`,
`Membership`, `DrohnengruppeMembership` oder irgendeinem anderen Modell.

**Kein Hard-Delete.** Es gibt bewusst keinen „Löschen"-Button für Feuerwehren oder Drohnengruppen —
beide Modelle haben zu viele Fremdschlüssel-Abhängigkeiten (User, Membership, Event, Vehicle/
VehicleBooking bzw. DrohnengruppeMembership, Drone, DroneDocument, Event.droneGroupId,
NewsMessage.audienceDroneGroupId), ein echtes Löschen wäre ein reales Datenverlust-Risiko für
Kalender-/Flugbuch-Historie. „Deaktivieren" (isActive = false) ist der einzige Weg, einen Eintrag
aus dem aktiven Bestand zu nehmen, und ist jederzeit umkehrbar (Reaktivieren = isActive = true).

**`Organization.nummer` bleibt nach dem Anlegen unveränderlich** — es ist die eindeutige, offizielle
NÖ-Landesfeuerwehrverband-Nummer und wird nie über die Bezirksverwaltung bearbeitet, nur beim
Neuanlegen einmalig vom Bezirksadmin eingetragen (Freitext, keine automatische Vorschlagslogik).

## 3. Deaktivieren-Effekt

Deaktivieren setzt ausschließlich `isActive = false` auf der Organization/DroneGroup selbst — **kein
Kaskadieren** auf `User`, `Membership` oder `DrohnengruppeMembership`. Bestehende Zuordnungen,
Termine, Flüge und Mitgliedschaften bleiben vollständig unverändert sichtbar und funktionsfähig;
nur **neue** Zuordnungen zu einer deaktivierten Feuerwehr/Gruppe werden verhindert, indem sie aus
den betroffenen Auswahllisten verschwindet (siehe Abschnitt 6). Innerhalb der Bezirksverwaltung
selbst bleiben deaktivierte Einträge sichtbar (mit Status-Badge + Reaktivieren-Schalter) — sie
verschwinden nur aus den *Neuzuordnungs*-Dropdowns anderer Module, nicht aus der Bezirksverwaltung
selbst und nicht aus reinen Verwaltungsansichten bestehender Zuordnungen (siehe Abschnitt 6).

## 4. Berechtigungen

Neue Funktionen in `src/lib/auth/permissions.ts`:

```typescript
/** Sichtbarkeit der Seite /admin/bezirksverwaltung generell - Bezirksadmin ODER Bezirks-Drohnenadmin
 * (Letzterer sieht dort nur den Drohnengruppen-Abschnitt, siehe canManageBezirksverwaltungFeuerwehren/
 * canManageBezirksverwaltungDrohnengruppen weiter unten - diese Funktion ist nur das Seiten-Gate). */
export function canAccessBezirksverwaltung(user: SessionUser): boolean {
  return isBezirksAdmin(user) || user.isBezirksDrohnenAdmin;
}

/** Feuerwehren-Abschnitt + Bezirksadmin-Liste - exklusiv Bezirksadmin. */
export function canManageFeuerwehrenBezirksweit(user: SessionUser): boolean {
  return isBezirksAdmin(user);
}

/** Drohnengruppen-Abschnitt (Anlegen/Umbenennen/Deaktivieren) - Bezirksadmin ODER Bezirks-Drohnenadmin.
 * Bewusst nicht canManageDroneGroupFor wiederverwendet: jene Funktion prüft Rechte für eine BESTEHENDE,
 * bereits verankerte Gruppe (inkl. Abschnittsadmin/Gruppen-Admin) - das Anlegen einer NEUEN Gruppe ist
 * ein bezirksweiter Strukturakt, der bewusst enger gefasst ist (nur die beiden bezirksweiten Rollen). */
export function canManageDrohnengruppenBezirksweit(user: SessionUser): boolean {
  return isBezirksAdmin(user) || user.isBezirksDrohnenAdmin;
}
```

Jede Server Action (Feuerwehr anlegen/umbenennen/de-/reaktivieren, Drohnengruppe anlegen/umbenennen/
de-/reaktivieren) prüft die passende Funktion selbst erneut, unabhängig vom UI-Gate — exakt das in
diesem Modul längst etablierte Muster ("UI-Gate ist Komfort, Server Action ist die Sicherheitsgrenze").

Neuer Eintrag in `src/lib/admin/nav-items.ts`, gated auf `canAccessBezirksverwaltung(user)`, gefolgt
vom bestehenden `AdminSidebar`/`AdminMobileTabs`-Rendering ohne weitere Änderungen an diesen beiden
Komponenten. Die Seite selbst rendert jeden der drei Abschnitte unabhängig, gated auf die jeweils
passende Funktion: Feuerwehren-Abschnitt und Bezirksadmin-Liste nur bei
`canManageFeuerwehrenBezirksweit(user)`, Drohnengruppen-Abschnitt bei
`canManageDrohnengruppenBezirksweit(user)` — ein reiner Bezirks-Drohnenadmin (ohne `isBezirksAdmin`)
sieht beim Öffnen der Seite dadurch ausschließlich den Drohnengruppen-Abschnitt, ein Bezirksadmin
sieht immer alle drei.

## 5. UI — Feuerwehren-Abschnitt

- Tabelle aller 124 Feuerwehren: Name, Kurzname, Nummer, Abschnitt (Spalte, sortier-/filterbar),
  Status-Badge (Aktiv/Deaktiviert, gleiche `Badge`-Tokens wie der bestehende dreiwertige
  Benutzerstatus). Nach Abschnitt gruppiert dargestellt (dieselbe `groupByAbschnitt`-Logik, die
  `OrgSearchSelect` bereits nutzt), mit einem Freitext-Suchfeld analog zur Benutzertabelle.
- **Neue Feuerwehr anlegen** (Sheet oder Dialog, analog `UserFormSheet`): Name (Pflicht, eindeutig),
  Kurzname (optional), Nummer (Pflicht, eindeutig, Freitext), Abschnitt (Pflicht-Auswahl aus den 7
  Abschnittskommandos, `OrgSearchSelect`-artiges Dropdown). `type` wird serverseitig fix auf
  `FEUERWEHR` gesetzt, keine Möglichkeit, ein neues Abschnittskommando anzulegen.
- **Umbenennen**: nur Name + Kurzname editierbar, `nummer` und `Abschnitt` (parentId) read-only
  nach dem Anlegen dargestellt.
- **Deaktivieren/Reaktivieren**: `Switch` pro Zeile, sofort wirksam (kein Bestätigungsdialog nötig,
  da jederzeit umkehrbar und ohne Kaskadeneffekt).

## 6. UI — Drohnengruppen-Abschnitt

- Liste aller Drohnengruppen (aktuell 4, künftig mehr): Name, Anker-Abschnitt, Status-Badge. Keine
  Gruppierung nötig bei dieser geringen Anzahl.
- **Neue Drohnengruppe anlegen**: Name (Pflicht, eindeutig), Anker-Abschnitt (Pflicht-Auswahl aus den
  7 Abschnittskommandos). `qrToken`/`flightNotificationEmail` bleiben beim Anlegen `null` — werden wie
  bei den 4 bestehenden Gruppen über die bereits existierenden Formulare auf `/admin/drohnen`
  eingerichtet, keine Dopplung dieser Felder in diesem neuen Formular.
- **Umbenennen**: nur Name editierbar, Anker-Abschnitt read-only nach dem Anlegen dargestellt.
- **Deaktivieren/Reaktivieren**: `Switch` pro Zeile, sofort wirksam.

## 7. UI — Bezirksadmin-Liste

Read-only Tabelle unterhalb der beiden obigen Abschnitte (oder als dritter, eigener Tab/Card-Block —
Detail für den Implementierungsplan): Name, E-Mail, Heimatfeuerwehr, für jeden `User` mit
`isBezirksAdmin = true`. Kein Bearbeiten/Verwalten von hier aus — ein Klick führt höchstens (falls
`canAccessUserManagementAdmin`) zur bestehenden Benutzerverwaltung, analog zum bereits etablierten
`PilotName`/`/admin/benutzer?edit=<id>`-Verlinkungsmuster in der Einsatzbereitschaft-Ansicht.

## 8. Auswirkungen auf bestehende Auswahllisten

Nur **Neuzuordnungs**-Dropdowns filtern künftig auf `isActive: true` — reine Verwaltungsansichten
bestehender Zuordnungen bleiben unverändert (ein Admin muss eine bereits deaktivierte Feuerwehr/
Gruppe weiterhin öffnen/verwalten können):

- `UserFormSheet`s Heimat-Feuerwehr-Auswahl (`OrgSearchSelect`) und Drohnengruppen-Auswahl.
- `event-form.tsx`s Organisation-Auswahl und `getManageableDroneGroupOptions`
  (`src/lib/calendar/drone-group-options.ts`).
- Jede weitere Stelle, an der aktuell ungefiltert `prisma.organization.findMany(...)`/
  `prisma.droneGroup.findMany(...)` ausschließlich zum Befüllen einer Auswahlliste für eine NEUE
  Zuordnung läuft (im Implementierungsplan vollständig aufzulisten, nicht Teil dieser Spec).

Explizit **nicht** gefiltert: `/admin/heimatfeuerwehr`s eigener Organisation-Switcher, `/admin/drohnen`s
Gruppen-Switcher, die neue Bezirksverwaltung selbst — all das sind Verwaltungsansichten bestehender
Einträge, kein Neuzuordnungs-Kontext.

## 9. Nicht-Ziele

- Keine neuen Abschnittskommandos anlegen — die 7 Abschnitte bleiben strukturell fix.
- Kein Hard-Delete von Feuerwehren oder Drohnengruppen.
- Kein Kaskadieren einer Deaktivierung auf `User`/`Membership`/`DrohnengruppeMembership`.
- `Organization.nummer` ist nach dem Anlegen nicht mehr änderbar.
- Keine Verwaltungsmöglichkeit für Bezirksadmins von dieser Seite aus (nur sichtbar).

## 10. Abnahme

- Ein Bezirksadmin kann eine neue Feuerwehr anlegen (Name/Kurzname/Nummer/Abschnitt), sie umbenennen,
  deaktivieren und wieder reaktivieren.
- Ein Bezirksadmin kann eine neue Drohnengruppe anlegen (Name/Anker-Abschnitt), sie umbenennen,
  deaktivieren und wieder reaktivieren.
- Ein Bezirks-Drohnenadmin sieht `/admin/bezirksverwaltung`, aber ausschließlich den
  Drohnengruppen-Abschnitt — Feuerwehren-Abschnitt und Bezirksadmin-Liste sind für ihn nicht sichtbar.
- Eine deaktivierte Feuerwehr/Drohnengruppe verschwindet aus der Heimat-Feuerwehr-Auswahl in
  UserFormSheet bzw. aus der Drohnengruppen-Auswahl beim Anlegen eines Kalendertermins — bestehende
  User/Termine/Flüge, die bereits darauf verweisen, bleiben unverändert erreichbar.
- `Organization.nummer` lässt sich über kein UI-Element dieses Moduls nachträglich ändern.
- Ein Abschnittsadmin oder Feuerwehr-Admin (ohne Bezirksadmin/Bezirks-Drohnenadmin) sieht den neuen
  Navigationseintrag „Bezirksverwaltung" gar nicht und bekommt bei direktem URL-Aufruf einen 404.
