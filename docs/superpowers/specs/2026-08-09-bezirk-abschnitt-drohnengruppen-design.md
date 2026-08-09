# Bezirk → Abschnitt → Feuerwehr-Hierarchie + mehrere Drohnengruppen

**Status:** Approved, ready for implementation planning.
**Source:** GitHub Issue [#10](https://github.com/ff3012/app-177/issues/10), Claude-Design-Projekt `cabb2cb1-85d4-4829-a3a4-eb667d733949` (`Umsetzungsplan.md`), Excel-Export `17 alle feuerwehren für import.xlsx` (Bezirk 17 St. Pölten, NÖ Landesfeuerwehrverband).

## 1. Zweck und Abgrenzung

Die App kennt heute genau einen Abschnitt ("AFKDO Purkersdorf") mit 9 Feuerwehren und eine flache,
gruppenlose Drohnengruppe. Dieses Feature erweitert die App auf den ganzen Bezirk 17 St. Pölten:
7 Abschnitte, 124 real erfasste Feuerwehren/Betriebsfeuerwehren, und 4 eigenständige Drohnengruppen mit
verpflichtender Mitgliedschaft.

**Im Scope dieser Spec** (entspricht Umsetzungsplan-Phasen 0.3, 1.1, 2, 5, jeweils nur der Teil, der von
der Hierarchie-Erweiterung selbst betroffen ist):
- Bezirk/Abschnitt/Feuerwehr-Datenmodell und Migration der bestehenden Daten
- Reale Seed-Daten für alle 124 Feuerwehren/BTF aus der Excel-Quelle
- Aufteilung der Drohnengruppe in 4 benannte Gruppen mit Pflicht-Zuordnung
- Neue Bezirksadmin-Rolle, Umbau der bestehenden Abschnittsadmin-Logik von global auf abschnittsscoped
- Admin-Navigation/Auswahl für die neue Hierarchie-Ebene
- Notwendige Folgeänderungen an bestehender Logik, die durch mehrere Abschnitte sonst fehlerhaft würde
  (Termin-Sichtbarkeit für abschnittsweite Termine, Drohnengruppen-Kategorie-Sichtbarkeit)

**Explizit nicht im Scope** (spätere, eigene Planungsrunden):
- Umsetzungsplan Phase 0.1 (Design-Tokens/shadcn-Reskin)
- Phase 3 (Dienstgrad) — bereits umgesetzt
- Phase 4 (Funktionsschalter) — bereits umgesetzt
- Phase 6 (Ausbildung/Lizenz-Tracking)
- Phase 7 (Profilseite)
- Phase 8 (Kalender-Politur) — Absage/RSVP-Teil bereits umgesetzt; verbleibende Politur-Punkte separat
- Phase 9 (Meine Feuerwehr Politur), Phase 10 (Dashboard Politur)
- Funktionsbezeichnungen wie "SB" (Umsetzungsplan-Offene-Frage #3) — eigenes künftiges Thema
- News-Modul-Scoping auf Abschnittsebene (bleibt bewusst Bezirksadmin-only, siehe §4)
- Ein eigenes Inventar-/Verwaltungs-UI für Drohnen-Ausrüstung über die bestehende `Drone`-Lookup-Tabelle
  hinaus (die bestehende Tabelle wird lediglich gruppenscoped, siehe §2.5)

## 2. Datenmodell

### 2.1 `District` (neu)

```prisma
model District {
  id     String @id @default(cuid())
  number String @unique   // "17"
  name   String            // "St. Pölten"

  organizations Organization[]

  @@map("districts")
}
```

Genau eine Zeile wird angelegt (`17` / "St. Pölten"). Die Modellierung als echte Tabelle (statt einer
Konstante) ist eine bewusste Entscheidung, um künftig einen zweiten Bezirk ohne Schemaänderung
aufnehmen zu können.

### 2.2 `Organization` (erweitert, keine neue Tabelle für Abschnitt)

```prisma
model Organization {
  // ...bestehende Felder unverändert...

  // Nur für type == ABSCHNITTSKOMMANDO gesetzt: der Bezirk, dem dieser Abschnitt angehört.
  districtId String?
  district   District? @relation(fields: [districtId], references: [id])

  // Nur für type == FEUERWEHR gesetzt: die Organization-Zeile (type == ABSCHNITTSKOMMANDO) ihres
  // Abschnitts. Selbstreferenzierend statt einer eigenen Section-Tabelle, da Abschnitt bereits heute
  // eine Organization-Zeile ist (siehe bestehender Kommentar über dem Organization-Modell: "eine
  // Tabelle für Feuerwehren UND Abschnittskommando, keine zwei").
  parentId String?
  parent   Organization?  @relation("OrgHierarchy", fields: [parentId], references: [id])
  children Organization[] @relation("OrgHierarchy")

  droneGroups DroneGroup[]  // Drohnengruppen, die an diesem Abschnitt verankert sind

  @@index([districtId])
  @@index([parentId])
}
```

`parentId`/`districtId` bleiben dauerhaft nullable (nicht nur migrationsbedingt): eine `FEUERWEHR`-Zeile
setzt nur `parentId`, eine `ABSCHNITTSKOMMANDO`-Zeile nur `districtId`. Es gibt keine Anwendungslogik,
die beide gleichzeitig erwartet oder erzwingt — das wird nicht per DB-Constraint abgesichert (Prisma kennt
keine bedingten Constraints), sondern ausschließlich dort geprüft, wo Organizations neu angelegt werden
(Seed-Skript; es gibt aktuell keine Admin-UI, die neue Organizations anlegt).

### 2.3 `DroneGroup` (neu)

```prisma
model DroneGroup {
  id                      String  @id @default(cuid())
  name                    String  @unique  // "AFKDO Purkersdorf", "Feuerwehr Hafnerbach", "AFKDO Kirchberg", "Spar BTF"

  // Der Abschnitt, an dem diese Gruppe organisatorisch verankert ist (bestimmt u.a., welcher
  // Abschnittsadmin sie verwalten darf, siehe §4).
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])

  // Ersetzen die bisherigen AppSettings.droneFlightNotificationEmail / droneQuickRegisterToken
  // (Singleton-Felder) - jetzt pro Gruppe statt app-weit.
  flightNotificationEmail String?
  qrToken                 String?  @unique

  memberships DrohnengruppeMembership[]
  documents   DroneDocument[]
  drones      Drone[]

  @@index([organizationId])
}
```

### 2.4 `DrohnengruppeMembership` (erweitert)

```prisma
model DrohnengruppeMembership {
  id           String    @id @default(cuid())
  userId       String    @unique
  role         DroneRole @default(PILOT)
  addedAt      DateTime  @default(now())

  droneGroupId String        // NEU, Pflichtfeld
  droneGroup   DroneGroup @relation(fields: [droneGroupId], references: [id])

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([droneGroupId])
}
```

`userId` bleibt `@unique` — ein Mitglied gehört weiterhin zu genau einer Gruppe (Issue #10: "jedes
Mitglied muss einer bestimmten Drohnengruppe zugeordnet sein"), keine Mehrfachmitgliedschaft.

### 2.5 `DroneDocument` und `Drone` (beide erweitert)

```prisma
model DroneDocument {
  // ...bestehende Felder unverändert...
  droneGroupId String        // NEU, Pflichtfeld
  droneGroup   DroneGroup @relation(fields: [droneGroupId], references: [id])

  @@index([droneGroupId])
}

model Drone {
  // ...bestehende Felder unverändert (name, isActive, sortOrder)...
  droneGroupId String        // NEU, Pflichtfeld — macht "Drohnen je Gruppe" aus dem Umsetzungsplan
                              // zu einer reinen Erweiterung der bereits bestehenden Drone-Lookup-Tabelle,
                              // kein neues Inventar-Konzept.
  droneGroup   DroneGroup @relation(fields: [droneGroupId], references: [id])

  @@index([droneGroupId])
}
```

Sowohl Unterlagen (`DroneDocument`) als auch Ausrüstung (`Drone`) waren bisher "für alle sichtbar" —
jetzt "für alle Mitglieder der jeweiligen Gruppe sichtbar". Das Flugformular (`flight-form.tsx`) und die
QR-Schnellerfassung müssen ihre Drohnen-Auswahl (`droneId`) auf die Drohnen der eigenen Gruppe des
Piloten/der Schnellerfassungs-Gruppe einschränken; ebenso muss `listDrohnengruppeMembers()` (Piloten-Picker)
gruppenscoped werden statt app-weit alle Mitglieder zu listen.

### 2.6 Betroffene bestehende Singleton-Felder

`AppSettings.droneFlightNotificationEmail` und `AppSettings.droneQuickRegisterToken` werden **entfernt**
(nicht nur ungenutzt gelassen) — beide Konzepte existieren jetzt als `DroneGroup.flightNotificationEmail`/
`DroneGroup.qrToken`. Die öffentliche QR-Schnellerfassungs-Route
(`src/app/drohnen-schnell/[token]/*`) sucht künftig die passende `DroneGroup` über deren `qrToken` statt
den globalen `AppSettings`-Wert zu lesen, und die per Schnellerfassung angelegten Flüge werden dem
Schnellerfassungs-System-User weiterhin zugeordnet, aber die Drohnen-Auswahl im Formular wird auf die
Drohnen dieser einen `DroneGroup` eingeschränkt.

## 3. Reale Seed-Daten

Quelle: `prisma/data/feuerwehren-bezirk-17-raw.json` (bereits im Repo, extrahiert aus der
NÖ-Landesfeuerwehrverband-Excel-Datei `17 alle feuerwehren für import.xlsx`, Spalten `BFK_NAME`,
`BFK_NUMMER`, `AFK_NAME`, `AFK_NUMMER`, `FW_ART`, `FW_NAME`, `FW_NUMMER`, `FW_ADRESSE_TYP`,
`FW_ADRESSE_PLZ`, `FW_ADRESSE_ORT`; 124 Zeilen).

### 3.1 Bezirk und Abschnitte

- 1 `District`-Zeile: `number: "17"`, `name: "St. Pölten"`.
- 7 `Organization`-Zeilen (`type: ABSCHNITTSKOMMANDO`, `districtId` gesetzt): `171` Herzogenburg, `172`
  Kirchberg/Pielach, `173` Neulengbach, `174` St.Pölten-West, `175` St.Pölten-Stadt, `176` St.Pölten-Ost,
  `177` Purkersdorf.
- **177 Purkersdorf ist keine neue Zeile** — die bestehende `Organization`-Zeile "Abschnittsfeuerwehrkommando
  Purkersdorf" (id bleibt erhalten, keine Neuanlage) wird per `update` um `districtId` ergänzt. Ihre
  `nummer` ist bereits `17700`, ihr `name`/`shortName` bleiben unverändert.

### 3.2 Feuerwehren/BTF

Alle 124 Zeilen der Quelldatei werden als `Organization`-Zeilen (`type: FEUERWEHR`) importiert:
`nummer` = `FW_NUMMER`, `name` = `"FF " + FW_NAME` bzw. `FW_NAME` unverändert für `FW_ART === "BTF"`
(z. B. `"Spar Österreichische Warenhandels AG St. Pölten"`, kein `"FF "`-Präfix), `shortName` = `FW_NAME`,
`parentId` = die `Organization`-Zeile ihres Abschnitts (per `AFK_NUMMER` aufgelöst). `FW_ART` selbst wird
**nicht** als eigenes Feld übernommen (siehe Entscheidung unten) — die Spalte dient nur der Namensbildung.

**Die 9 bestehenden Purkersdorf-Feuerwehren werden nicht dupliziert**: für Abschnitt 177 matcht das
Seed-Skript per `nummer` (bereits `@unique`) gegen die 9 vorhandenen Zeilen und aktualisiert nur deren
`parentId` — alle anderen 115 Zeilen (Abschnitte 171–176) sind echte Neuanlagen.

**Keine `feuerwehrArt`-Spalte im Schema** (Entscheidung bestätigt): "Spar BTF" und alle anderen BTF-Zeilen
werden als gewöhnliche `FEUERWEHR`-Organization geführt, ohne strukturelle FF/BTF-Unterscheidung — die
Excel-Spalte `FW_ART` wird nur zur Namensbildung gelesen und danach verworfen.

### 3.3 Drohnengruppen

4 `DroneGroup`-Zeilen, jeweils an einem Abschnitt verankert (Zuordnung anhand der realen Daten bestätigt,
nicht geraten — siehe die passenden Excel-Zeilen):

| Gruppenname | verankert an Abschnitt | Beleg |
|---|---|---|
| AFKDO Purkersdorf | 177 Purkersdorf | bestehender Abschnitt |
| AFKDO Kirchberg | 172 Kirchberg/Pielach | Abschnitt selbst (kein einzelner Feuerwehr-Datensatz) |
| Feuerwehr Hafnerbach | 174 St.Pölten-West | `FW_NAME: "Hafnerbach-Markt"`, `FW_NUMMER: "17402"` |
| Spar BTF | 175 St.Pölten-Stadt | `FW_NAME: "Spar Österreichische Warenhandels AG St. Pölten"`, `FW_NUMMER: "17527"` |

### 3.4 Migration bestehender Drohnengruppen-Daten

Jede bestehende `DrohnengruppeMembership`-, `DroneDocument`- und `Drone`-Zeile bekommt
`droneGroupId` = die Gruppe "AFKDO Purkersdorf" zugewiesen (bestätigte Entscheidung: das ist faktisch
schon heute die einzige existierende Gruppe).

## 4. Berechtigungsmodell

### 4.1 Ist-Zustand (verifiziert)

`isSiteAdmin(user)` (`src/lib/auth/permissions.ts:4`) liest `user.isAbschnittsAdmin`, welches
`build-session-user.ts` per `user.memberships.find(m => m.organization.type === ABSCHNITTSKOMMANDO)`
bildet — es findet *irgendeine* Abschnittskommando-Mitgliedschaft, ohne festzuhalten, *welche*. Das ist
bei genau einem Abschnitt unschädlich, aber mit sieben Abschnitten würde ein Admin von z. B. Kirchberg
fälschlich als global allmächtig gelten. Genau dieses Problem umgeht `feuerwehrAdminOrgIds` bereits heute
korrekt (ein `string[]`, pro Organisation geprüft) — die neue Lösung überträgt dasselbe Muster eine Ebene
höher, statt eine neue, abweichende Mechanik einzuführen.

`feuerwehrAdminOrgIds` selbst ist heute **nicht** auf `FEUERWEHR`-Organisationen gefiltert — es enthält
jede Admin-Mitgliedschaft unabhängig vom `Organization.type`. Das fällt bei einem einzigen Abschnitt nicht
auf, wird aber Teil des Fixes (siehe unten).

### 4.2 Soll-Zustand

**`SessionUser` (`src/types/next-auth.d.ts`) ändert sich wie folgt:**

```ts
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  homeOrganizationId: string;
  homeOrganizationType: 'FEUERWEHR' | 'ABSCHNITTSKOMMANDO';
  // NEU: der Abschnitt (Organization.id vom Typ ABSCHNITTSKOMMANDO), dem homeOrganization angehört -
  // bei homeOrganizationType === ABSCHNITTSKOMMANDO ist das homeOrganizationId selbst, sonst deren
  // parentId. Treibt die Termin-Sichtbarkeit für abschnittsweite Termine (§5.1).
  homeAbschnittOrganizationId: string;

  feuerwehrAdminOrgIds: string[];   // jetzt NUR FEUERWEHR-Mitgliedschaften, PLUS jede Feuerwehr
                                    // unter einem der Abschnitte aus abschnittAdminOrgIds (s.u.)
  abschnittAdminOrgIds: string[];   // NEU: ABSCHNITTSKOMMANDO-Organisationen, bei denen diese Person
                                    // eine ADMIN-Mitgliedschaft hat
  isBezirksAdmin: boolean;          // NEU: eigenständiges, globales Recht (kein Membership-Konzept)

  isAbschnittskommandoMitglied: boolean;  // unverändert (siehe Hinweis unten)
  isDrohnengruppeMember: boolean;
  droneGroupId: string | null;      // NEU: welche DroneGroup (nur gesetzt wenn Mitglied)
  droneGroupRole: 'PILOT' | 'VIEWER' | 'ADMIN' | null;
}
```

`isAbschnittsAdmin` entfällt ersatzlos (durch `abschnittAdminOrgIds` ersetzt).

**`build-session-user.ts` — neue Berechnung von `feuerwehrAdminOrgIds`:**

```ts
const abschnittAdminOrgIds = user.memberships
  .filter((m) => m.role === MembershipRole.ADMIN && m.organization.type === OrganizationType.ABSCHNITTSKOMMANDO)
  .map((m) => m.organizationId);

const directFeuerwehrAdminOrgIds = user.memberships
  .filter((m) => m.role === MembershipRole.ADMIN && m.organization.type === OrganizationType.FEUERWEHR)
  .map((m) => m.organizationId);

const inheritedFeuerwehrOrgIds = abschnittAdminOrgIds.length > 0
  ? (await prisma.organization.findMany({
      where: { parentId: { in: abschnittAdminOrgIds } },
      select: { id: true },
    })).map((o) => o.id)
  : [];

const feuerwehrAdminOrgIds = Array.from(new Set([...directFeuerwehrAdminOrgIds, ...inheritedFeuerwehrOrgIds]));

const homeAbschnittOrganizationId =
  user.homeOrganization.type === OrganizationType.ABSCHNITTSKOMMANDO
    ? user.homeOrganizationId
    : user.homeOrganization.parentId!; // nach der Migration bei jeder FEUERWEHR-Zeile gesetzt
```

Das ist die zentrale Design-Entscheidung dieses Abschnitts: **`feuerwehrAdminOrgIds` bleibt die einzige
Quelle, die bestehende Berechtigungsfunktionen abfragen** — sie enthält jetzt schlicht mehr Einträge (auch
über Abschnitts-Vererbung), statt dass jede Funktion selbst eine Abschnitts-Prüfung nachrüsten müsste. Das
hält den Blast-Radius dieser Änderung klein: die meisten der 28 gefundenen `isSiteAdmin`-Stellen brauchen
nur ein Wort ausgetauscht, nicht eine neue Signatur.

**`permissions.ts` — Änderungen:**

```ts
// isSiteAdmin entfällt komplett, ersetzt durch:
export function isBezirksAdmin(user: SessionUser): boolean {
  return user.isBezirksAdmin;
}

export function canManageAbschnittFor(user: SessionUser, abschnittOrganizationId: string): boolean {
  return isBezirksAdmin(user) || user.abschnittAdminOrgIds.includes(abschnittOrganizationId);
}

// canManageEventsFor: UNVERÄNDERT (feuerwehrAdminOrgIds enthält jetzt bereits die geerbten Einträge)

// canManageHeimatfeuerwehrFor: isSiteAdmin(user) -> isBezirksAdmin(user), sonst unverändert
export function canManageHeimatfeuerwehrFor(user: SessionUser, organizationId: string): boolean {
  return isBezirksAdmin(user) || canManageEventsFor(user, organizationId);
}

// canAccessHeimatfeuerwehrAdmin: isSiteAdmin(user) -> isBezirksAdmin(user), plus abschnittAdminOrgIds
// als zusätzliches Sicherheitsnetz für den (in der Praxis nicht vorkommenden) Fall eines Abschnitts
// ohne eigene Feuerwehr
export function canAccessHeimatfeuerwehrAdmin(user: SessionUser): boolean {
  return isBezirksAdmin(user) || user.feuerwehrAdminOrgIds.length > 0 || user.abschnittAdminOrgIds.length > 0;
}

// canManageUsersFor / canAccessUserManagementAdmin: Aliase, gleiche Änderung wie oben

// canManageNews: isSiteAdmin(user) -> isBezirksAdmin(user) — bewusst NICHT auf abschnittAdminOrgIds
// geöffnet (News hat schon heute laut bestehendem Kommentar bewusst keine feuerwehrAdminOrgIds-Ebene;
// dieselbe Zurückhaltung gilt jetzt eine Ebene höher, kein neuer Scope-Entscheid).

// canCreateSectionWideEvent: user.isAbschnittsAdmin -> user.abschnittAdminOrgIds.length > 0

// NEU: Drohnengruppen-Verwaltung (bisher implizit nur isSiteAdmin, jetzt eigene Funktion nötig, da
// DroneGroup keine Organization ist)
export function canManageDroneGroupFor(user: SessionUser, droneGroup: { id: string; organizationId: string }): boolean {
  return (
    isBezirksAdmin(user) ||
    canManageAbschnittFor(user, droneGroup.organizationId) ||
    (user.droneGroupRole === 'ADMIN' && user.droneGroupId === droneGroup.id)
  );
}
```

**Aufrufstellen-Update (28 gefundene `isSiteAdmin`-Stellen), pro Datei:**

| Datei | Änderung |
|---|---|
| `admin/status/page.tsx`, `admin/status/actions.ts` | `isSiteAdmin` → `isBezirksAdmin` (unverändert global) |
| `admin/email/page.tsx`, `admin/email/actions.ts` (3×) | `isSiteAdmin` → `isBezirksAdmin` (unverändert global) |
| `admin/benutzer/export/route.ts` | `isSiteAdmin` → `isBezirksAdmin` (bewusst weiterhin global, siehe §1 "Explizit nicht im Scope"-Nachbarschaft: Excel-Export bleibt bezirksweit, keine Abschnitts-Teilexporte) |
| `admin/benutzer/import/page.tsx`, `admin/benutzer/import/actions.ts` | `isSiteAdmin` → `isBezirksAdmin` (unverändert global) |
| `admin/benutzer/page.tsx` | `fullAdmin = isSiteAdmin(currentUser)` → `isBezirksAdmin(currentUser)`; die bestehende `{ in: feuerwehrAdminOrgIds }`-Query-Filterung bleibt unverändert korrekt, da das Array jetzt bereits die geerbten Feuerwehren enthält |
| `admin/heimatfeuerwehr/page.tsx` | `allowedOrgs`-Berechnung: `isSiteAdmin(user)` → `isBezirksAdmin(user)`, Rest unverändert |
| `admin/drohnen/page.tsx`, `admin/drohnen/actions.ts` (6×) | Umbau auf `canManageDroneGroupFor` je gewählter Gruppe statt `isSiteAdmin` (Seite wird gruppenscoped, siehe §5.2) |
| `(app)/layout.tsx` | `isSiteAdmin(user)` (Verwaltungs-Link-Ziel) → `isBezirksAdmin(user)` |
| `lib/admin/nav-items.ts` | `/admin/drohnen`-Sichtbarkeit: `isSiteAdmin(user)` → `isBezirksAdmin(user) \|\| user.abschnittAdminOrgIds.length > 0 \|\| user.droneGroupRole === 'ADMIN'`; `/admin/email`+`/admin/status`: `isSiteAdmin` → `isBezirksAdmin` |
| `lib/nav-items.ts` | Verwaltungs-Ziel-Logik: `isSiteAdmin(user)` → `isBezirksAdmin(user)`, Rest unverändert |

`isAbschnittskommandoMitglied` wird in dieser Spec **nicht** verändert — sie bleibt "Mitglied irgendeines
Abschnittskommandos" ohne Bezug auf welches. Der Implementierer soll vor der Umsetzung per Grep alle
Verbraucher dieser Flag prüfen (in der Recherche zu dieser Spec wurden außer der Definition keine
Aufrufstellen gefunden) und, falls doch vorhanden, dem Product Owner vorlegen, ob eine abschnittsspezifische
Bedeutung nötig ist — nicht stillschweigend selbst entscheiden.

### 4.3 Bootstrap

Der bestehende Seed-Admin (`admin@abschnitt-purkersdorf.at`) wird zum **Abschnittsadmin für 177
Purkersdorf** (unveränderte `Membership`-Zeile an der jetzt um `districtId` ergänzten Organization) —
**nicht** automatisch Bezirksadmin. Das Seed-Skript legt zusätzlich `User.isBezirksAdmin = true` für
diesen einen Bootstrap-Account, da die App sonst nach der Migration niemanden hätte, der `/admin/email`
oder `/admin/status` erreichen kann.

## 5. Notwendige Folgeänderungen (Konsequenzen der Mehr-Abschnitte-Erweiterung)

Diese zwei Punkte sind keine neuen Feature-Wünsche, sondern Stellen, an denen bestehende Logik mit sieben
Abschnitten schlicht falsch würde, wenn sie unverändert bliebe — beide werden Teil des Umsetzungsplans.

### 5.1 Abschnittsweite Termine

`canViewEvent`/die Kalender-Query behandeln `Event.isSectionWide === true` heute als "für alle sichtbar" —
korrekt bei einem Abschnitt, falsch bei sieben (ein von Herzogenburg als abschnittsweit markierter Termin
würde sonst auch in Purkersdorf auftauchen). Jede Stelle, die "eigene Organisation ODER abschnittsweit"
abfragt (Kalender-Seite, beide `.ics`-Feed-Routen, Dashboard-Route, `meine-feuerwehr`-Zu-erledigen-Query),
muss auf "eigene Organisation ODER (abschnittsweit UND im selben Abschnitt)" umgestellt werden, unter
Verwendung von `homeAbschnittOrganizationId` (neu, siehe §4.2) und dem Abschnitt des Termin-Erstellers.

Die Auflösung "Abschnitt einer Organization" (type `ABSCHNITTSKOMMANDO` → die Organization selbst; type
`FEUERWEHR` → ihre `parentId`) wird an genau zwei Stellen gebraucht (`homeAbschnittOrganizationId` in
`build-session-user.ts`, und die Abschnitts-Auflösung eines Termin-Erstellers) und gehört deshalb in eine
einzige geteilte Funktion, z. B. `getAbschnittOrganizationId(org: { type: OrganizationType; id: string;
parentId: string | null }): string`, statt an beiden Stellen unabhängig dieselbe Fallunterscheidung zu
schreiben.

### 5.2 Drohnengruppen-Kategorie-Termine

Analog: `Event.category === DROHNENGRUPPE` ist heute für "irgendein Drohnengruppen-Mitglied" sichtbar
(`canViewDroneModule`). Mit vier Gruppen soll ein Drohnengruppen-Termin nur für Mitglieder der Gruppe
sichtbar sein, die ihn betrifft — sonst sähe ein Spar-BTF-Pilot die Flugplanung von AFKDO Kirchberg.
`Event` bekommt ein neues, nullable `droneGroupId`-Feld (nur für `category === DROHNENGRUPPE` gesetzt),
und die Sichtbarkeitsprüfung ergänzt sich um `event.droneGroupId === user.droneGroupId`. Das
Termin-Formular (`event-form.tsx`) muss bei Kategorie "Drohnengruppe" zusätzlich zur Gruppe fragen (statt
wie bisher implizit "die eine Drohnengruppe" zu meinen) — vorbelegt mit der eigenen Gruppe des
anlegenden Nutzers.

## 6. Admin-UI

- **Kein neuer zweistufiger Auswahl-Flow nötig**: `feuerwehrAdminOrgIds` enthält dank der
  Session-Vererbung (§4.2) für einen Abschnittsadmin bereits automatisch jede Feuerwehr seines Abschnitts —
  das bestehende flache `?org=<id>`-Muster von `/admin/heimatfeuerwehr` (und die Feuerwehr-Filter in der
  Benutzerverwaltung) funktionieren dadurch unverändert korrekt, nur mit mehr Einträgen. Die einzige nötige
  Änderung ist rein darstellerisch: die bestehenden Dropdowns (`OrgSelect`, die zwei
  Feuerwehr-Filter-`<Select>`s in der Benutzerverwaltung) gruppieren ihre `<option>`/`<SelectItem>`-Einträge
  per `<optgroup>`/`SelectGroup` nach Abschnitt, damit ein Bezirksadmin mit bis zu 124 Feuerwehren zur
  Auswahl nicht vor einer unbrauchbaren flachen Liste steht — ein neuer, mehrstufiger Auswahl-Flow wäre
  hierfür unnötiger Mehraufwand.
- **`/admin/drohnen`** wird über dasselbe `OrgSelect`-Muster (auf `DroneGroup` statt `Organization`
  angewendet) gruppenscoped, da es jetzt 4 Gruppen statt einer flachen Seite gibt.
- Kein neues Bezirks-Verwaltungs-UI über die reine Existenz der einen `District`-Zeile hinaus — es gibt
  aktuell nichts, das pro Bezirk konfigurierbar wäre.

## 7. Migrationsreihenfolge

1. Additive Schema-Änderungen (alle neuen Felder/Tabellen nullable bzw. mit Default) —
   `District`, `Organization.districtId`/`parentId`, `DroneGroup`, `DrohnengruppeMembership.droneGroupId`
   (zunächst nullable), `DroneDocument.droneGroupId` (zunächst nullable), `Drone.droneGroupId` (zunächst
   nullable), `Event.droneGroupId`, `User.isBezirksAdmin` (Default `false`).
2. Backfill in einer Datenmigration (nicht im Seed-Skript, da produktiv bereits Daten existieren): 1
   `District`-Zeile, `districtId` auf die bestehende Purkersdorf-Organization, 1 `DroneGroup`-Zeile "AFKDO
   Purkersdorf" verankert an Purkersdorf, alle bestehenden `DrohnengruppeMembership`/`DroneDocument`/
   `Drone`-Zeilen auf diese Gruppe gesetzt, `isBezirksAdmin = true` für den Bootstrap-Admin.
3. `droneGroupId` auf `DrohnengruppeMembership`/`DroneDocument`/`Drone` auf `NOT NULL` verschärfen (nach
   Schritt 2 haben alle bestehenden Zeilen einen Wert).
4. Die restlichen 6 Abschnitte + 115 neuen Feuerwehren + 3 neuen Drohnengruppen: **im Seed-Skript**
   (`prisma/seed.ts`), da es sich um Referenzdaten aus der Excel-Quelle handelt, nicht um eine
   Strukturmigration — idempotent per `upsert` auf `nummer`, exakt das bestehende Muster.
   `AppSettings.droneFlightNotificationEmail`/`droneQuickRegisterToken` werden in derselben Migration wie
   Schritt 1 entfernt (nachdem Schritt 2/3 ihre Nachfolgefelder befüllt haben).

Dieselbe sichere Reihenfolge (nullable → Backfill → `NOT NULL`), die bereits bei `Organization.nummer`
verwendet wurde — kein neues Muster.
