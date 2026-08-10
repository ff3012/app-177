# Bezirksadmin-UI + Bezirks-Drohnenadmin-Rolle

**Status:** Approved, ready for implementation planning.
**Source:** Nutzerfeedback nach dem Bezirk/Abschnitt/Drohnengruppen-Rollout — `isBezirksAdmin` war nur per
Migration/Seed setzbar, es fehlte jede UI dafür, und es fehlte ein Weg, jemanden bezirksweiten Zugriff auf
alle 4 Drohnengruppen zu geben, ohne ihn zum vollen Bezirksadmin zu machen.

## 1. Zweck

Zwei fehlende Verwaltungsmöglichkeiten ergänzen:

1. **Bezirksadmin** in der Benutzerverwaltung setzbar machen (bisher nur per Datenbank-Migration/Seed).
2. Eine neue, eigenständige Rolle **Bezirks-Drohnenadmin**: sieht/verwaltet alle 4 Drohnengruppen
   bezirksweit, ohne die übrigen Bezirksadmin-Rechte (Benutzerverwaltung, E-Mail, Status, News) zu haben.

## 2. Datenmodell

```prisma
model User {
  // ...bestehende Felder inkl. isBezirksAdmin (bereits vorhanden aus dem Hierarchie-Rollout)...

  // Bezirksweites Recht, alle 4 Drohnengruppen zu sehen/verwalten, unabhängig von einer eigenen
  // Drohnengruppen-Mitgliedschaft - eigenständig von isBezirksAdmin, jemand kann keines, eines oder
  // beide haben.
  isBezirksDrohnenAdmin Boolean @default(false)
}
```

Additive, nullable-freier Default `false` — keine Migration-Backfill-Besonderheit nötig (anders als beim
letzten Rollout, wo bestehende Zeilen einen echten Wert brauchten; hier ist "false" für jeden Bestandsnutzer
korrekt).

## 3. Berechtigungen

```typescript
// permissions.ts
export function canManageDroneGroupFor(
  user: SessionUser,
  droneGroup: { id: string; organizationId: string },
): boolean {
  return (
    isBezirksAdmin(user) ||
    user.isBezirksDrohnenAdmin ||
    canManageAbschnittFor(user, droneGroup.organizationId) ||
    (user.droneGroupRole === 'ADMIN' && user.droneGroupId === droneGroup.id)
  );
}

// Wer darf isBezirksAdmin bei einem ANDEREN Benutzer setzen/entziehen.
export function canGrantBezirksAdmin(currentUser: SessionUser): boolean {
  return isBezirksAdmin(currentUser);
}

// Wer darf isBezirksDrohnenAdmin bei einem ANDEREN Benutzer setzen/entziehen.
export function canGrantBezirksDrohnenAdmin(currentUser: SessionUser): boolean {
  return isBezirksAdmin(currentUser) || currentUser.isBezirksDrohnenAdmin;
}
```

`SessionUser` bekommt ein neues Feld `isBezirksDrohnenAdmin: boolean`, direkt aus `user.isBezirksDrohnenAdmin`
in `build-session-user.ts` übernommen (kein abgeleiteter Wert, kein DB-Join nötig).

**Konsistenz-Sweep** (identisches Muster zum letzten Rollout, an derselben Stelle noch einmal nötig, da
`isBezirksDrohnenAdmin` an denselben Prüfpunkten wie eine Drohnengruppen-Admin-Rolle sichtbar sein muss):

- `admin/drohnen/page.tsx`s Gruppen-Filter (`allowedGroups`) — `canManageDroneGroupFor` deckt das durch die
  Erweiterung oben automatisch ab, keine zusätzliche Änderung an dieser Datei nötig.
- `lib/admin/nav-items.ts`s `/admin/drohnen`-Sichtbarkeitsbedingung — `|| user.isBezirksDrohnenAdmin`
  ergänzen (neben den bestehenden `isBezirksAdmin`/`abschnittAdminOrgIds`/`droneGroupRole === 'ADMIN'`-Fällen).
- `admin/layout.tsx`s Gate — `|| user.isBezirksDrohnenAdmin` ergänzen (neben dem bestehenden
  `droneGroupRole === 'ADMIN'`-Fall).
- `lib/nav-items.ts`s `getVerwaltungNavItem()` — die bestehende dritte Branche (pure Drohnengruppen-Admin →
  `/admin/drohnen`) um `|| user.isBezirksDrohnenAdmin` erweitern.

## 4. UI

### 4.1 Bezirksadmin — neue Sektion "Bezirksweite Rechte"

Neue Sektion in `UserFormSheet`, sichtbar nur wenn der BETRACHTENDE Admin selbst `isBezirksAdmin` ODER
`isBezirksDrohnenAdmin` ist (sonst sieht ein Feuerwehr-Admin unnötig Kontrollen, die er nie setzen könnte) —
ein einzelner Ein/Aus-Schalter "Bezirksadmin", der nur interaktiv ist, wenn der betrachtende Admin selbst
`isBezirksAdmin` ist (für einen reinen Bezirks-Drohnenadmin wird der Schalter sichtbar, aber deaktiviert
dargestellt, mit Tooltip "Nur Bezirksadmins können diesen Status vergeben").

### 4.2 Bezirks-Drohnenadmin — in der bestehenden "Funktionen und Ausbildung"-Karte

Direkt unter der bestehenden Drohnengruppe-Segmented-Control (Kein/Mitglied/Admin), über der Gruppe-Auswahl,
ein neuer Ein/Aus-Schalter "Bezirks Drohnenadmin" — sichtbar nur wenn der betrachtende Admin
`isBezirksAdmin` ODER `isBezirksDrohnenAdmin` ist; interaktiv nur unter denselben Bedingungen wie 4.1.

**Verknüpfung mit der Segmented Control** (Client-seitig in `UserFormSheet`):
- Wird der Schalter aktiviert, springt `droneRole` sofort auf `'ADMIN'`.
- Solange der Schalter aktiv ist, sind die Segmente "Kein" und "Mitglied" deaktiviert (nur "Admin" bleibt
  wählbar) — verhindert, dass ein Admin versehentlich die Rolle senkt, während Bezirks-Drohnenadmin aktiv
  bleibt, was einen inkonsistenten Zustand ergäbe.
- Wird der Schalter deaktiviert, bleibt `droneRole` unverändert auf `'ADMIN'` stehen (keine automatische
  Rücksetzung) — der Admin kann die Rolle danach frei ändern.

**Serverseitige Durchsetzung** (Zod-Refine in `userSchema`, nicht nur Client-UI):
```typescript
.refine((data) => !data.isBezirksDrohnenAdmin || data.droneRole === 'ADMIN', {
  message: 'Bezirks-Drohnenadmin erfordert die Rolle "Admin" in der zugeordneten Gruppe.',
  path: ['droneRole'],
})
```

## 5. Server Actions (`admin/benutzer/actions.ts`)

Die Prüfung darf nur greifen, wenn sich der Wert tatsächlich ÄNDERT — sonst würde das Speichern eines
Formulars, das den Wert unverändert zurücksendet, an einem fehlenden Bezirksadmin-Recht scheitern, selbst
wenn der bearbeitende Admin selbst kein Bezirksadmin ist und das Feld nur schreibgeschützt (deaktiviert)
angezeigt bekommt. "Unverändert" bedeutet für `createUser` immer `false` (ein neuer Benutzer hat noch keinen
Wert), für `updateUser` den tatsächlich in der DB gespeicherten Wert des Zielbenutzers vor dem Update:

```typescript
// In createUser: der Zielbenutzer existiert noch nicht, "vorher" ist also immer false.
if (data.isBezirksAdmin) {
  assertPermission(canGrantBezirksAdmin(currentUser));
}
if (data.isBezirksDrohnenAdmin) {
  assertPermission(canGrantBezirksDrohnenAdmin(currentUser));
}

// In updateUser: targetUser ist die bereits geladene, bestehende Zeile vor dem Update.
if (data.isBezirksAdmin !== targetUser.isBezirksAdmin) {
  assertPermission(canGrantBezirksAdmin(currentUser));
}
if (data.isBezirksDrohnenAdmin !== targetUser.isBezirksDrohnenAdmin) {
  assertPermission(canGrantBezirksDrohnenAdmin(currentUser));
}
```

(Exakte Variablennamen an die tatsächliche aktuelle Struktur von `createUser`/`updateUser` anpassen — beide
Funktionen laden bereits vor diesem Punkt den relevanten Kontext, siehe bestehende `syncAdminMemberships`/
`syncDroneMembership`-Aufrufe direkt daneben.)

## 6. Scope

Nicht Teil dieser Änderung: Es gibt weiterhin keine Möglichkeit, eine 5. Drohnengruppe anzulegen; das bleibt
wie bisher Seed-only. Diese Änderung fügt nur die beiden Rollen-Schalter und ihre Durchsetzung hinzu.
