# Kalender Desktop-Browser-Ansicht (≥1024px) — Design

Quelle: Claude-Design-Projekt `Kalender Browser.dc.html` (Signalrot). Ziel: die Desktop-Listenansicht des
Kalender-Moduls auf dieselben Bausteine wie die mobile Ansicht abstimmen — Datumsblock links, Farbstreifen
für die Ebene links am Termin, Rückmeldung direkt in der Zeile — statt der aktuellen flachen Tabelle.

**Scope-Grenze:** Alles unten gilt ausschließlich ab `lg:` (1024px) aufwärts. Die Tablet-Tabelle
(640–1023px) und die mobile Kartenliste + das Bottom-Sheet (`KalenderFiltersContent`, `<640px`) bleiben
unverändert — keine der folgenden Änderungen berührt deren Code-Pfade.

## 1. Listen-Umbau (`event-list-view.tsx`, `lg:`-Zweig)

- **Monatsgruppen**: die bereits sortierte `events`-Liste wird nach dem Monat von `startsAt` gruppiert;
  jede Gruppe rendert als eigene weiße `rounded-lg`-Karte mit einer kleinen Großbuchstaben-Monatsüberschrift
  darüber ("August 2026", "September 2026", …) — ersetzt die heutige einzelne durchlaufende `<table>` in
  diesem Breakpoint. Reihen sind `<div>`-Flex-Zeilen, keine `<table>`-Zeilen mehr (nur im `lg:`-Zweig; der
  Tablet-Zweig behält seine `<table>`).
- **RSVP-Anzeige**: die bisherige eine zusammengeführte `RsvpBadge`-Pille wird durch drei separate, kompakte
  Zahlen-Chips ersetzt (Zugesagt=grün, Abgesagt=rot, Offen=grau), gespeist aus denselben bereits geladenen
  `event.rsvpCounts`. Neue, `lg:`-spezifische Darstellung — `RsvpBadge`/dessen `compact`-Variante bleiben für
  Tablet/Mobile/FullCalendar-Chip unverändert.
- **Inline Zusage/Absage**: ersetzt den bisherigen reinen "Zusage"-Text-Link. Klick ruft `setRsvp(eventId,
  status)` direkt auf (Server Action existiert bereits, aktuell nur von `HomeTodoList` genutzt) mit
  optimistischem UI-Update, kein Navigieren. Datum/Titel bleiben klickbar für die Detailseite; der
  bestehende 220ms Single-/Double-Click-Mechanismus (Doppelklick → Bearbeiten, falls `editable`) bleibt
  unverändert bestehen.
- **Zeile aufklappen**: ein neuer "⌄"-Button pro Zeile blendet `description` und den vollen `location`-Text
  inline ein/aus — kein Navigieren, kein neues Datenfeld nötig (`description` wird bereits in
  `kalender/page.tsx` geladen und durchgereicht).
- **Fahrzeug-Reservierungs-Zeilen** (`event.isVehicleBooking`): keine Zusage/Absage-Buttons, kein
  Aufklapp-Chevron, keine RSVP-Chips — stattdessen ein "Fahrzeug"-Label-Pill neben dem Titel und ein
  einzelner "Buchung öffnen"-Button rechts, der zur Detailseite verlinkt.
- Das `.ics`-Download-Icon (`AddToCalendarLink`, `variant="icon"`) bleibt unverändert erhalten.

## 2. Sidebar-Umbau (neue, `lg:`-exklusive Komponente)

Da Tablet/Mobile unverändert bleiben müssen, wird die Desktop-Sidebar eine eigene Komponente statt
zusätzlicher Verzweigungen in `KalenderFiltersContent` — analog zum bereits etablierten Muster dieser
Codebase, Desktop- und Mobile-Navigation bei echter Divergenz bewusst zu trennen (`AdminSidebarNav` vs.
`AdminMobileTabs`).

- **Ebenen-Karte**: unverändert drei Toggles, aber die bisher separate `LayerLegend`-Karte entfällt in
  dieser Ansicht — ihre Erklärung wird zu einer Fußzeile innerhalb der Ebenen-Karte ("Die Farbe links am
  Termin zeigt die Ebene…").
- **Neue "Nur anzeigen"-Karte**: Chips `Alle / Offen (n) / Zugesagt`, filtert die Liste nach dem eigenen
  Rückmeldestatus des Nutzers. "Offen" = sichtbare Termine in den nächsten 14 Tagen ohne eigene Zusage
  (gleiches Zeitfenster wie `HomeTodoList`s "Zu erledigen"). Darunter eine neue kleine Farb-Swatch-Legende
  für die drei RSVP-Chip-Farben (Zugesagt/Abgesagt/Offen) — eine andere Legende als die entfallene
  Ebenen-Legende.
- **ICS-Kalender-Import-Karte**: Inhalt unverändert, nur innerhalb der schmaleren Sidebar.
- Sidebar-Breite: `lg:w-64` (256px) bleibt bestehen, sofern `lg:w-[250px]` keinen sauberen Vorteil bringt —
  rein kosmetischer 6px-Unterschied, Entscheidung fällt bei der Umsetzung, keine Spec-relevante Anforderung.
- **Label-Angleichung**: `layer-colors.ts`s `LAYER_LABELS` ("Allgemein · eigene Feuerwehr" / "Abschnittsweit")
  wird an die bereits im Ebenen-Toggle verwendeten Labels ("Meine Feuerwehr" / "Abschnitt-Kalender")
  angeglichen — behebt eine bestehende Inkonsistenz, die auch die weiterhin sichtbare mobile Legende betrifft
  (nicht nur diese Desktop-Änderung).

## 3. Kopfzeile

Die bestehende Titel-/Toggle-/"Neuer Termin"-Zeile bekommt ab `lg:` eine Unterzeile: "`{total}` Termine ·
`{openCount}` offene Rückmeldungen" — `openCount` nutzt dieselbe 14-Tage/keine-Zusage-Definition wie der
"Offen"-Chip der Sidebar.

## 4. Daten/State-Ergänzungen

- Neuer Client-State in `KalenderWithLayers`: `statusFilter: 'ALLE' | 'OFFEN' | 'ZUGESAGT'`, wirkt sich nur
  auf den `lg:`-Zweig aus (Tablet/Mobile setzen diesen State nie, da ihre UI keinen Chip dafür zeigt).
  `openCount` wird aus derselben, bereits vorhandenen `events`-Liste + `myRsvpByEvent`-Zuordnung abgeleitet,
  keine neue Server-Query nötig.
- Kein Schema-/Migrations-Bedarf — alle benötigten Felder (`description`, `location`, `rsvpCounts`,
  `isVehicleBooking`) existieren bereits im an die Client-Komponente übergebenen Datensatz.

## Abnahme

- Bei `lg:` (1024px) und größer: Termine erscheinen in Monatsgruppen-Karten statt einer durchlaufenden
  Tabelle; ein Klick auf Zusage/Absage speichert sofort ohne Seitenwechsel und aktualisiert Badge/Buttons;
  der Aufklapp-Chevron zeigt Beschreibung/Ort inline; Fahrzeug-Reservierungs-Zeilen zeigen ausschließlich
  "Buchung öffnen", keine RSVP-Elemente.
- Die "Nur anzeigen"-Chips filtern die Liste korrekt (Alle/Offen/Zugesagt), der Offen-Zähler in Sidebar und
  Kopfzeile stimmt überein.
- Unterhalb `lg:` (Tablet-Tabelle, Mobile-Kartenliste, Bottom-Sheet) ist optisch und funktional nichts
  verändert — Regressionstest per Vorher/Nachher-Vergleich bei 768px und 390px.
- Die mobile `LayerLegend` zeigt die angeglichenen Labels ("Meine Feuerwehr"/"Abschnitt-Kalender") statt der
  bisherigen abweichenden Formulierungen.
