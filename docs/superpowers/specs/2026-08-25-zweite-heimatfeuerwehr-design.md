# Zweite Heimatfeuerwehr (FF + BTF) — Design

GitHub Issue #21: "BTF als zweite Feuerwehr erlauben".

## Ziel

Ein Mitglied kann optional einer zweiten Feuerwehr zugeordnet werden — genau eine Freiwillige
Feuerwehr (FF) und eine Betriebsfeuerwehr (BTF), nie zwei vom selben Typ. Auf der eigenen
Profilseite kann das Mitglied selbst zwischen beiden Feuerwehren wechseln. Die jeweils aktive
Feuerwehr bestimmt weiterhin alles, was heute schon an `User.homeOrganizationId` hängt (Kalender,
Foto-Uploads, Fahrzeug-Reservierung, Push-Zielgruppen, Benutzerlisten) — ohne dass diese Module
angefasst werden müssen.

**Bewusst nicht Teil dieses Designs** (siehe Abgrenzung unten): ein gemeinsamer Kalenderblick über
beide Feuerwehren gleichzeitig, sowie Excel-Export/Import der zweiten Feuerwehr/des zweiten
Dienstgrads.

## Datenmodell

Zwei neue, nullable Felder auf `User`:

```prisma
secondaryOrganizationId String?
secondaryOrganization   Organization? @relation("SecondaryHomeOrganization", fields: [secondaryOrganizationId], references: [id])

secondaryDienstgradId String?
secondaryDienstgrad   Dienstgrad? @relation("SecondaryDienstgrad", fields: [secondaryDienstgradId], references: [id])
```

`Organization.members` bekommt kein Gegenstück für die zweite Feuerwehr — es gibt keinen
Anwendungsfall, der "alle User, für die diese Org sekundär ist" braucht (siehe Abgrenzung).

**Regel** (app-seitig geprüft, nicht per DB-Constraint, analog zu allen anderen fachlichen Regeln
in diesem Codebase): `secondaryOrganizationId` muss auf eine `Organization` mit `type = FEUERWEHR`
zeigen, deren `feuerwehrKategorie` sich von der `feuerwehrKategorie` der aktuellen
`homeOrganization` unterscheidet. FF+BTF ja, FF+FF oder BTF+BTF nein.

## Admin-UI (Benutzerverwaltung → `UserFormSheet`)

- Neuer Abschnitt "Zweite Feuerwehr (optional)": derselbe `OrgSearchSelect`-Kombobox wie das
  bestehende Heimat-Feuerwehr-Feld — **ungefiltert**, zeigt alle Feuerwehren. Keine Kategorie-Vorauswahl
  im UI.
- Danach, nur wenn eine zweite Feuerwehr gewählt ist: ein zweites Dienstgrad-`<Select>`, identisch
  zum bestehenden Dienstgrad-Feld.
- Validierung passiert beim Speichern in `updateUser`/`createUser` (`actions.ts`): Kategorie von
  `homeOrganizationId` und `secondaryOrganizationId` serverseitig geladen und verglichen. Bei
  Gleichheit: Fehlermeldung am Feld, z. B. "Diese Feuerwehr hat dieselbe Kategorie (Freiwillige
  Feuerwehr) wie die Heimat-Feuerwehr — bitte eine Betriebsfeuerwehr wählen."
- Dieselbe `canManageUsersFor(currentUser, secondaryOrganizationId)`-Prüfung wie für
  `homeOrganizationId` gilt auch für `secondaryOrganizationId`: ein Feuerwehr-Admin kann einem User
  keine zweite Feuerwehr zuweisen, die er selbst nicht verwaltet.

## Profil-Dropdown (Mitglied selbst)

Es gibt keine eigene Profilseite — das Profil-Dropdown `ProfileMenu`
(`src/components/layout/profile-menu.tsx`, Klick auf Name/Avatar oben rechts) ist die bestehende
Anlaufstelle für Selbstverwaltung (zeigt bereits Organisation/Admin-Rechte/Drohnengruppe, hat
Panels für Passwort-ändern/Feedback über den vorhandenen `activePanel`-State). Dort setzt dieses
Feature an:

- Die bestehende `dl`-Zeile "Organisation" bekommt, nur wenn `secondaryOrganizationId` gesetzt ist,
  einen zusätzlichen Button "Wechseln zu {secondaryOrganizationName}" direkt daneben.
- `ProfileMenu` bekommt dafür ein neues Prop `secondaryOrganizationName: string | null` (analog zu
  `homeOrganizationName`), das `(app)/layout.tsx` beim Laden des Users mitgibt.
- Klick öffnet ein drittes `activePanel`-Panel ('switch-org') mit Bestätigungstext ("Wirklich zu FF
  X wechseln? Kalender, Foto-Uploads etc. zeigen danach FF X.") und einem Bestätigen-Button —
  gleiches Interaktionsmuster wie das bestehende Passwort-Panel, kein separates Modal/Dialog-Bauteil
  nötig.
- Bestätigung ruft eine neue Server Action `switchHomeOrganization()` auf (nur für den
  eingeloggten User selbst, kein Admin-Recht nötig): tauscht atomar in einem
  `prisma.user.update`:
  - `homeOrganizationId ↔ secondaryOrganizationId`
  - `dienstgradId ↔ secondaryDienstgradId`
- Guard: schlägt fehl mit Fehlermeldung, falls die Ziel-Organisation (`secondaryOrganizationId`)
  aktuell `isActive = false` ist — eine deaktivierte Feuerwehr kann nicht zur aktiven Heimat-Feuerwehr
  werden, analog dazu, dass deaktivierte Feuerwehren auch sonst nirgends als aktive Zuordnung
  verwendbar sind.
- Kein neuer Session-Code nötig: der bestehende JWT-Refresh (liest bei jedem Request User + Rechte
  neu aus der DB) wirkt automatisch auf den nächsten Request nach dem Wechsel — inklusive
  Admin-Rechte-Anzeige (siehe nächster Abschnitt).

## Admin-Rechte beim Wechsel

Keine zusätzliche Prüfung beim Wechsel nötig. Admin-Rechte (`Membership`-Tabelle,
`feuerwehrAdminOrgIds`/`abschnittAdminOrgIds`) sind bereits unabhängig von
`homeOrganizationId` — sie werden bei jedem Request aus der `Membership`-Tabelle neu berechnet
(`build-session-user.ts`). War ein Mitglied Admin seiner FF, aber nicht der BTF, verschwindet der
Verwaltungs-Zugriff nach dem Wechsel zur BTF automatisch (und kommt beim Zurückwechseln automatisch
wieder) — ganz ohne neuen Code.

## Abgrenzung — bewusst nicht Teil dieses Designs

- **Gemeinsamer Kalenderblick über beide Feuerwehren**: der im ursprünglichen Issue erwähnte
  "merged view" wird durch den Wechsel-Mechanismus ersetzt. Es ist zu jedem Zeitpunkt nur der
  Kalender der aktuell aktiven Feuerwehr sichtbar. `canViewEvent` und alle Kalender-Queries bleiben
  unverändert.
- **Excel-Export/Import**: keine Spalten für `secondaryOrganizationId`/`secondaryDienstgradId` im
  Benutzer-Export/-Import. Begründung: geringe Anzahl betroffener User, Zuweisung erfolgt manuell
  über die Benutzerverwaltung. Kann bei Bedarf als eigenes, kleines Folge-Issue nachgezogen werden.
- **Atemschutz**: unverändert — bereits global auf `User`, nicht pro Feuerwehr, erfüllt die
  Anforderung "über beide Feuerwehren synchron sichtbar" bereits ohne Änderung.
- **Foto-Upload, Fahrzeug-Reservierung, Push-Zielgruppen, Benutzerlisten**: keine Codeänderung,
  folgen automatisch der jeweils aktiven `homeOrganizationId`.

## Migration

Neue Migration nach dem in diesem Repo etablierten Muster: additive, nullable Spalten
(`secondaryOrganizationId`, `secondaryDienstgradId`), keine Backfill-Logik nötig (beide Felder
starten für alle bestehenden User als `NULL`). Anwendung über den bekannten Workaround
(`prisma db execute` + `prisma migrate resolve --applied`), da dieses Repo einen dokumentierten,
unbehobenen Shadow-DB-Replay-Bug hat (siehe Root-`CLAUDE.md`).
