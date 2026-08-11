# Drohnengruppe: Flugbuch-Redesign (Signalrot/Kalender-Bausteine)

**Status:** Approved, ready for implementation planning.
**Quelle:** `Drohnengruppe-Brief.md` (Claude Design, Projekt "Signalrot"), importiert über die
DesignSync-MCP-Route (`get_file`), Designvorlage `Drohnengruppe Browser.dc.html`. Betrifft
`/drohnen` (Flugbuch, Admin- und Mitglieder-Ansicht in einer Seite) und `/drohnen/90-tage`
(entfällt als eigene Seite). Datenmodell (`DroneFlight`, `Drone`, `DrohnengruppeMembership`),
Server Actions (`createFlight`/`updateFlight`/`deleteFlight`) und Validierung
(`flight.schema.ts`) bleiben unverändert — dies ist ausschließlich eine Darstellungs- und
Zugriffs-Erweiterung.

Ziel: das Flugbuch verwendet dieselben Bausteine wie die Kalender-Desktop-Ansicht (Kalender V4) —
Monatsgruppen, Datumsblock, Farbstreifen, Sidebar mit Filtern — statt der bisherigen
7-Spalten-Tabelle.

## 1. Berechtigungserweiterung (die wichtigste Abweichung vom Ist-Zustand)

Heute gilt `canViewAllFlights(user) = isDroneGroupAdmin(user)` — nur der Admin der EIGENEN
Gruppe sieht im Flugbuch die Admin-Ansicht. Abschnitts-/Bezirksadmins haben bislang nur über
`/admin/drohnen` Zugriff auf Compliance-Daten, nicht über das Flugbuch selbst.

**Entscheidung (bestätigt):** `/drohnen`, `/drohnen/90-tage` (bzw. dessen Nachfolge, siehe §6) und
`/drohnen/export` öffnen die Admin-Ansicht künftig für dieselbe Zielgruppe wie
`canManageDroneGroupFor` — Bezirksadmin, Bezirks-Drohnenadmin, Abschnittsadmin des verankerten
Abschnitts, oder Admin der eigenen Gruppe. Da diese Prüfung PRO GRUPPE erfolgt (nicht mehr ein
einzelnes Bool für "bin ich irgendwo Admin"), braucht das Flugbuch dieselbe
`allowedGroups`-Berechnung wie `/admin/drohnen` — neu extrahiert als
`getAllowedFlightbookGroups(user): Promise<DroneGroup[]>` in `src/lib/drone/` (gleiches Muster wie
`allowedGroups` in `admin/drohnen/page.tsx`, hier aber als eigenständige, wiederverwendbare
Funktion, da sie jetzt an drei Stellen gebraucht wird: `/drohnen`, `/drohnen/export`, und dem neuen
90-Tage-Export aus §6).

`canViewAllFlights(user)` selbst wird NICHT gelöscht, aber sein Vertrag ändert sich: es beantwortet
weiterhin "darf dieser Benutzer irgendeine Gruppe als Admin sehen" (für reine
UI-Vorabprüfungen wie "zeige den Admin-Header überhaupt"), während die tatsächliche
Sichtbarkeits-/Export-Filterung immer über `getAllowedFlightbookGroups` + das gewählte `?gruppe=`
läuft, nie mehr über `user.droneGroupId` allein.

## 2. Sichtbarkeitsregel (unverändert in der Substanz, jetzt gruppen-parametrisiert)

```ts
where: isAdminForSelectedGroup
  ? { drone: { droneGroupId: selectedGroupId } }
  : { OR: [{ pilotUserId: userId }, { registeredById: userId }] }
```

Ein Mitglied, das eine fremde Flug-ID aufruft (Detail/Bearbeiten-Route), bekommt `notFound()` -
Prüfung serverseitig in der Seite UND in `updateFlight`/`deleteFlight` (dort bereits über
`canManageFlight` abgedeckt, unverändert).

## 3. URL-Zustand

`/drohnen?gruppe=<id>&q=&pilot=&drohne=&zeitraum=&zweck=&scope=`

- `gruppe`: nur wenn `getAllowedFlightbookGroups(user).length > 1` sichtbar/wählbar (Chip-Reihe,
  Server-Component-Links wie beim bestehenden Muster in `admin/drohnen/group-select.tsx` — hier
  aber als Chip-Reihe statt `<select>`, siehe §5). Ungültige/fremde Werte fallen still auf die
  erste erreichbare Gruppe zurück (identisches Muster wie `admin/drohnen/page.tsx`).
- `pilot`, `drohne`, `zeitraum`, `zweck`, `scope` (`ALLE`/`MEINE`, nur Admin relevant): serverseitig
  gefiltert, kein Client-Filtering großer Listen mehr.
- `q`: Freitextsuche (Ort/Pilot), erwähnt im Brief unter "Filterzustand in die URL", nicht weiter
  spezifiziert - einfache `contains`-Suche auf `location` und Pilot-Namen.

`scope=ALLE|MEINE` ist der EINE Wahrheits-Zustand hinter zwei Bedienelementen: dem Chip "Meine" in
der "Nur anzeigen"-Gruppe (§5.2) und dem Umschalter "Alle Flüge einsehen" (§5.3). Beide lesen/setzen
denselben URL-Parameter - es gibt keinen zweiten, unabhängigen Zustand, der auseinanderlaufen könnte.

## 4. Kopfbereich

```
Admin:     Flugbuch Drohnengruppen
           {Abschnittsname} · {n} Gruppen · {n} Piloten · {n} Flüge
           [Unterlagen] [90-Tage-Report] [Export]  [Flug registrieren]

Mitglied:  Meine Flüge
           {Gruppenname} · {Name}
           [Unterlagen]                            [Flug registrieren]
```

Titel `text-[28px] font-bold`, Zählzeile `text-[15px] text-ink-muted` (exakte Tokens aus
`globals.css`, gleiche Größen wie Kalender V4s Titelzeile). "Flug registrieren" einzige gefüllte
(`bg-brand`) Aktion. Die Zählzeile für Admin verwendet die Kennzahlen aus
`getAllowedFlightbookGroups` (Anzahl Gruppen) und einer neuen leichten Aggregatabfrage
(Piloten/Flüge gesamt über ALLE erreichbaren Gruppen, nicht nur die gewählte - der Brief zeigt
"Bezirk St. Pölten · 4 Gruppen · 21 Piloten · 512 Flüge", also eine bezirksweite Summe, unabhängig
von `?gruppe=`).

## 5. Gruppenwähler + Sidebar (250px)

**Gruppenwähler**: nur gerendert wenn `getAllowedFlightbookGroups(user).length > 1`. Chip-Reihe
direkt unter dem Kopfbereich (nicht in der Sidebar - "ein Wechsel des Geltungsbereichs, kein
Filter", Brief §2). Aktive Gruppe schwarz gefüllt (`bg-ink text-white`), andere `bg-surface-sunken
text-ink-muted`. Jeder Chip ein `<Link href="/drohnen?gruppe={id}">` (Server-Component-Navigation,
kein Client-State - identisches Muster wie `GroupSelect`, nur als Chip statt `<select>`).

**Sidebar**, vier Karten von oben nach unten:

1. **Mein Status** — in BEIDEN Ansichten sichtbar. Zähler groß (`font-condensed text-3xl`),
   dreiteiliger Segment-Balken (ersetzt den bisherigen SVG-Ring aus `NinetyDayRing` -
   `NinetyDayRing` wird durch eine neue, einfachere Balken-Variante ersetzt, da der Brief explizit
   drei diskrete Segmente statt eines Kreis-Fortschritts zeigt), Statuszeile mit farbigem Punkt in
   `success-subtle`/`warning-subtle`/`danger-subtle` je nach Status.
2. **Nur anzeigen** — Chip-Reihe (Admin: `Alle {n}` · `Meine` · `Einsatz` · `Übung`; Mitglied:
   `Alle {n}` · `Für andere erfasst {n}` · `Einsatz` · `Übung`), darunter Selects **Pilot** (nur
   Admin, Optionen aus `listDrohnengruppeMembers` der gewählten Gruppe), **Drohne** (aktive Drohnen
   der gewählten Gruppe), **Zeitraum** (`Letzte 90 Tage` · `Dieses Jahr` · `Alle`, Standard: Letzte
   90 Tage). Darunter Farblegende Einsatz/Übung (kleine Farbkästchen, keine neuen Tokens - gleiche
   `danger-subtle`/`surface-sunken` wie die Zweck-Chips in §7).
3. **Alle Flüge einsehen** (nur Admin) — Umschalter (`ToggleSwitch`), bindet an denselben
   `scope`-Parameter wie der "Meine"-Chip (§3). **Meine Gruppe**-Karte (nur Mitglied) an derselben
   Stelle: Gruppenname + Erklärtext, was sichtbar ist.
4. **Schnellerfassung** — QR-Platzhalter + Satz Erklärung, liest den bestehenden
   `DroneGroup.qrToken`-Link (`/drohnen-schnell/{token}`) der GEWÄHLTEN Gruppe, nicht mehr
   zwingend der eigenen - relevant für einen Abschnitts-/Bezirksadmin, der zwischen Gruppen
   wechselt.

## 6. Gruppenstatus (nur Admin, für die gewählte Gruppe)

Ersetzt `GroupStatusChart` (Säulendiagramm) vollständig - eine neue Komponente, waagrechte
Balkenliste, eine Zeile je Mitglied: Name links (fixe Breite ~132px, ungekürzt - der Bericht in
`GroupStatusChart`s eigenem Kommentar nennt explizit abgeschnittene Namen als Grund für die
Ablösung), Balken (`bg-surface-sunken` Hintergrund, farbiger Füllbalken proportional zu
`count / NINETY_DAY_REQUIRED_FLIGHTS`, gedeckelt bei 100%), Zähler rechts.

Drei Farbstufen (neu, ersetzt das bisherige binäre `met`/`!met`):

| Farbe | Bedingung |
|---|---|
| `#22a06b` (success) | `count >= NINETY_DAY_REQUIRED_FLIGHTS` |
| `#f0a92c` (warning, neu) | `count >= NINETY_DAY_REQUIRED_FLIGHTS` UND der älteste noch mitzählende Flug fällt in ≤ 14 Tagen aus dem 90-Tage-Fenster (neue Funktion `getDaysUntilExpiry` in `ninety-day-rule.ts`, aufbauend auf der bestehenden `getComplianceUntilDate`-Logik: `complianceUntil - heute <= 14 Tage`) |
| `#e4322b` (danger) | alles andere (`count < NINETY_DAY_REQUIRED_FLIGHTS`) |

Kopfzeile: „Gruppenstatus · 90-Tage-Regel · {Gruppenname}" links, „{n} von {n} erfüllt" rechts
(erfüllt = grün ODER bernstein, da beide die Regel gerade erfüllen). Fußnote erklärt die
Bernstein-Stufe wörtlich wie im Brief.

**90-Tage-Report-Button** (Kopfbereich, nur Admin): neuer Export-Endpoint
`src/app/(app)/drohnen/90-tage-export/route.ts`, gated auf dieselbe
`getAllowedFlightbookGroups`-Prüfung, exportiert für die per `?gruppe=` übergebene Gruppe exakt die
Gruppenstatus-Tabelle (Name, Flüge 90 Tage, Status-Text) als `.xlsx` - gleiche
ExcelJS-Struktur/Spaltenbreiten-Konvention wie das bestehende `drohnen/export/route.ts`, nur mit
diesen drei Spalten statt der vollen Flugliste. `/drohnen/90-tage` als Seite wird gelöscht
(Route-Ordner entfernt); alle internen Links darauf (`/admin/drohnen`? - zu prüfen beim
Implementieren, ob dort noch verlinkt wird) werden entfernt oder auf `/drohnen` umgebogen.

## 7. Flugliste

**Monatsgruppen**: Label `text-[11px] font-semibold uppercase tracking-[.13em] text-ink-faint`,
darunter eine `bg-surface rounded-lg shadow-card`-Karte, Zeilen durch `border-b border-line`
getrennt. Ein Monat ohne sichtbare Zeilen (nach Filterung) wird komplett weggelassen - neue Hilfsfunktion
`groupFlightsByMonth(flights: FlightRow[]): MonthGroup[]` in einer neuen Datei
`src/lib/drone/group-flights-by-month.ts`, konzeptionell wie `groupEventsByMonth` in
`event-list-view.tsx`, aber eigenständig implementiert (keine gemeinsame Abstraktion mit dem
Kalender-Modul - Flüge haben keine RSVP/Bearbeiten-Route-Struktur wie Termine, dieselbe bewusste
Trennung wie an anderen Stellen dieser Codebase, z. B. Drohnengruppe-E-Mail-Formulare vs.
System-Check-E-Mail-Formular).

**Neue Zeilenkomponente** `src/components/drone/flight-row.tsx` (ersetzt die Tabellen-/Karten-Logik
aus `flight-table.tsx`, welche komplett neu geschrieben wird, nicht nur erweitert - die 7-Spalten-
Tabellenstruktur entfällt vollständig):

| Element | Breite | Inhalt |
|---|---|---|
| Farbstreifen | `border-left: 5px solid` | Einsatz `#e4322b`, Übung `#c9c9ce` |
| Datumsblock | `flex: 0 0 62px` | Tag `font-condensed text-2xl`, Wochentag `text-xs uppercase` |
| Titel | `flex: 1 1 auto; min-width: 120px` | Ort `text-[17px] font-semibold` + `PurposeBadge` (neu gestaltet, siehe unten), darunter „HH:MM · Pilot · Drohne" |
| Herkunft | `flex: 0 0 168px` | „Erfasst über Schnellerfassung (QR)" / „Erfasst von {Name}" / (nur Mitglied, für einen für-andere-erfassten Flug) „Für andere erfasst / von {Name}" |
| Aktionen | `flex: 0 0 116px` | „Öffnen"-Button + Zeilenmenü `⌄` (Details · Bearbeiten · Löschen, letztere zwei nur für Ersteller/Admin) |

`PurposeBadge` wird an das neue Farbschema angepasst: Einsatz `bg-danger-subtle text-danger`
(vorher `bg-brand text-white` - der Brief reserviert Vollrot jetzt für den Farbstreifen/die
"Flug registrieren"-Aktion, nicht mehr für den Chip selbst), Übung `bg-surface-sunken
text-ink-muted` (vorher outline). Ganze Zeile klickbar (öffnet Detail/Bearbeiten je nach Recht -
gleiches Doppelklick-vs-Einzelklick-Muster wie `EventListRow` im Kalender, falls ein Zeilenmenü UND
ein Zeilen-Klick koexistieren müssen; das Zeilenmenü `⌄` stoppt seine eigene Klick-Propagation).

Mobile (`sm:hidden`): Kartenliste, gleiches inhaltliches Layout vertikal gestapelt statt der
Flex-Row - bestehendes `FlightCard`-Konzept aus `flight-table.tsx` wird beibehalten, nur an die
neuen Datenfelder (Herkunfts-Label, neues `PurposeBadge`-Farbschema) angepasst.

## 8. Zustände

- **Laden**: sechs Skeleton-Zeilen in Listenform (`Skeleton`-Komponente aus
  `components/ui/skeleton.tsx`, bereits im Projekt), keine springende Höhe - via
  `src/app/(app)/drohnen/loading.tsx` (Next.js-Suspense-Konvention, gleiches Muster wie
  `admin/benutzer/loading.tsx`).
- **Leer nach Filterung**: „Keine Flüge für diese Filter" + Link/Button „Filter zurücksetzen"
  (navigiert zu `/drohnen?gruppe={aktuelle}` ohne weitere Parameter).
- **Ganz leer** (Mitglied, keine Filter aktiv, wirklich keine Flüge): „Noch keine Flüge erfasst"
  mit „Flug registrieren" als primärer (gefüllter) Aktion - bewusst anderer Text als der
  gefilterte Leerzustand.
- **Fehler**: bestehendes `sonner`-Toast-Muster (bereits app-weit eingerichtet in
  `(app)/layout.tsx`), konkreter Fehlertext statt „Fehler" - betrifft v. a. die Server Actions
  beim Löschen/Bearbeiten.

## 9. Nicht-Ziele

- Kein neues Datenmodell, keine Änderung an `DroneFlight`/`Drone`/`flight.schema.ts`.
- Keine Änderung an `createFlight`/`updateFlight`/`deleteFlight`s Kernlogik - nur ggf. die
  Ziel-Route nach Erfolg, falls sich URL-Strukturen ändern (`/drohnen` bleibt Zielroute,
  `revalidatePath('/drohnen')` bleibt gültig, evtl. um die `?gruppe=`-Variante ergänzen, falls
  Next.js das für Query-Parameter überhaupt braucht - zu prüfen beim Implementieren).
- Kein Self-Service für Mitglieder, den Gruppenstatus anderer einzusehen - unverändert
  Admin-only, wie schon bei `GroupStatusChart` heute.
- Keine Änderung an `/drohnen-schnell/[token]` (QR-Schnellerfassung) selbst - nur die Verlinkung
  darauf aus der Sidebar wird gruppen-scoped angezeigt.
- Keine Pagination-Bibliothek - "paginiert, nicht 512 Zeilen auf einmal" (Brief, Abnahme-Liste)
  wird über eine feste Seitengröße (50 Flüge) plus `?take=`-Parameter in der URL gelöst: die Seite
  lädt initial 50, ein „Weitere 50 laden"-Button am Ende der Liste erhöht `take` um 50 und
  navigiert zur selben URL mit dem neuen Wert (Server-Component-Link, kein Client-State,
  kein Infinite-Scroll) - einfachste Lösung, die "als Link teilbar" (Abnahme-Kriterium) bleibt, da
  `take` Teil der URL ist.

## 10. Abnahme (aus dem Brief übernommen, vollständig)

**Sichtbarkeit**
- Mitglied sieht ausschließlich Flüge, bei denen es Pilot ist oder die es erfasst hat.
- Ein Mitglied, das eine fremde Flug-ID aufruft, bekommt 404 - kein leeres Detail.
- Abschnittsadmin sieht nur die eigene Gruppe, auch bei manipulierter `?gruppe=`.
- Bezirksadmin sieht alle vier Gruppen und kann wechseln.
- Ein Mitglied ohne Gruppenzuordnung kommt gar nicht auf die Seite.

**Darstellung**
- Ein Monat ohne sichtbare Flüge erscheint nicht als leere Karte.
- Der Zähler über der Liste stimmt mit der Anzahl sichtbarer Zeilen überein.
- „Mein Status" und die eigene Zeile im Gruppenstatus zeigen denselben Wert.
- Für andere erfasste Flüge tragen das abweichende Label.
- Rot erscheint nur bei Einsatz-Chip, Streifen und „Flug registrieren".
- Bei 21 Piloten bleibt die Gruppenstatus-Liste lesbar, Namen ungekürzt.

**Verhalten**
- Filterzustand übersteht Reload und ist als Link teilbar.
- „Alle Flüge einsehen" aus behält die übrigen Filter bei.
- Zeitraum „Alle" lädt paginiert, nicht 512 Zeilen auf einmal.
- Bei der Flugerfassung sind nur die Drohnen der eigenen Gruppe wählbar (unverändert, bereits
  über `isActiveDrone`/`isEligiblePilot` abgesichert).
- Der QR-Code führt in das Flugformular DIESER Gruppe (unverändert, `DroneGroup.qrToken`).
