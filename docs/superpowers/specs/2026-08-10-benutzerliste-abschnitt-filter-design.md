# Benutzerliste: Abschnitt-Filter + durchsuchbarer Feuerwehr-Filter

**Status:** Approved, ready for implementation planning.
**Quelle:** `Verwaltung-Filter-Brief.md` §3/§5, weiter eingegrenzt aus der ursprünglichen Phase-3-
Definition ("gemeinsame Filterleiste als Komponente" in Isolation) auf die kleinste Scheibe, die den
in Phase 1+2 gebauten Geltungsbereich-Wähler tatsächlich nutzbar macht. Betrifft ausschließlich
`/admin/benutzer`.

## 1. Zweck

Der Geltungsbereich-Wähler (Phase 1+2) verändert bisher keine Liste. Diese Phase liefert seinen
ersten echten Nutzen: die Benutzerliste bekommt einen neuen Abschnitt-Filter (nur für Bezirksadmins
sichtbar, aus dem Geltungsbereich vorbelegt) und der bestehende Feuerwehr-Filter wird von einem
flachen `<Select>` (bei 124 Feuerwehren unbedienbar) auf eine durchsuchbare Popover+Command-Auswahl
umgestellt - dieselbe Bauweise wie das bereits bestehende `AdminOrgMultiSelect`.

**Bewusst NICHT Teil dieser Phase** (weiterhin eigene, spätere Specs): der Drohnengruppe-Filter, die
Rolle-Erweiterung auf die vier Admin-Stufen, serverseitige Filterung/Paginierung, die Abschnittsliste
und die Drohnengruppen-Übersicht.

## 2. Datenfluss: Vorbelegung aus dem Geltungsbereich, serverseitig

`admin/benutzer/page.tsx` liest bereits seine eigenen `searchParams` und berechnet bereits
`reachableScopes` (Phase 1). Beides zusammen reicht, um den neuen Abschnitt-Filter serverseitig aus
dem aktuellen Geltungsbereich vorzubelegen - **ohne** eine zweite `useSearchParams()`-Instanz:
`resolveAdminScope(reachableScopes, params.ebene, params.bereich)` liefert den aktuellen
Geltungsbereich; ist er vom Typ `ABSCHNITT` und ist **kein** expliziter `?abschnitt=`-Parameter
gesetzt, wird dessen `organizationId` als `initialAbschnitt` an die Client-Komponente
durchgereicht. Ist explizit `?abschnitt=<id>` in der URL, gewinnt dieser Wert (ein Reload mit
gesetztem Filter darf nicht durch den Geltungsbereich überschrieben werden). Für einen
Abschnitts-/Feuerwehr-Admin (nicht `isFullAdmin`) bleibt der neue Filter unsichtbar - ihre Liste ist
serverseitig bereits auf ihre eigene(n) Feuerwehr(en) beschränkt, eine Vorbelegung wäre wirkungslos.

## 3. Neue, wiederverwendbare Komponente: `OrgSearchSelect`

Einzelauswahl-Geschwister von `AdminOrgMultiSelect` - gleiche Popover+Command-Bauweise, gleiches
"nach Abschnitt gruppiert"-Verhalten (inkl. der bestehenden Regel, die Gruppenüberschrift wegzulassen,
wenn kein Eintrag einen `abschnittName` mitbringt - relevant für die neue Abschnitt-Auswahl selbst,
deren 7 Einträge keinen `abschnittName` haben und deshalb flach, ohne Überschrift, erscheinen).
Geschlossen zeigt der Trigger entweder den gewählten Namen oder ein `allLabel` (z. B. "Alle
Feuerwehren"/"Alle Abschnitte") - anders als `AdminOrgMultiSelect`s "N von M ausgewählt"-Zeile, da
das hier eine Einzelauswahl ist, keine Mehrfachauswahl.

`groupByAbschnitt` existiert heute redundant an zwei Stellen (`admin-org-multiselect.tsx` und
`user-management-section.tsx`, beide fast identisch) - mit `OrgSearchSelect` als drittem echtem
Verwender wird das zu einem gemeinsamen `src/lib/admin/group-by-abschnitt.ts` extrahiert und an
beiden bestehenden Stellen ersetzt, statt eine dritte Kopie anzulegen.

**Bewusst KEINE neue generische "FilterChips"-Komponente**: die bestehenden drei Chip-Buttons
(Feuerwehr/Rolle/Status) in `user-management-section.tsx` sind bereits inline implementiert und
haben aktuell nur diesen einen Verwender - eine Abstraktion dafür wäre verfrüht (YAGNI), solange kein
zweiter echter Konsument existiert. Der neue Abschnitt-Chip wird im selben, bereits etablierten
Inline-Muster ergänzt.

## 4. Abschnitt-Filter + Feuerwehr-Filter-Abhängigkeit

- Neuer State `abschnitt` (`'ALLE'` oder eine Abschnitt-Organisations-ID), nur gerendert wenn
  `isFullAdmin`. Optionen kommen aus `reachableScopes.filter(s => s.level === 'ABSCHNITT')` - keine
  neue Query nötig, diese Liste existiert bereits aus Phase 1.
- Ändert sich `abschnitt`, wird `feuerwehr` sofort auf `'ALLE'` zurückgesetzt (Brief §3: "Ändert sich
  der Abschnitt, wird die Feuerwehr-Auswahl geleert").
- Ist `abschnitt !== 'ALLE'`, zeigt der Feuerwehr-`OrgSearchSelect` nur noch Organisationen, deren
  `abschnittId` dem gewählten Abschnitt entspricht - dafür braucht `Organization` (das lokale
  Prop-Interface in `user-management-section.tsx`) ein neues `abschnittId?: string`-Feld, gefüllt aus
  `org.parent?.id` in `page.tsx` (die bestehende `parent`-Select-Klausel dort bekommt zusätzlich
  `id: true`, da sie heute nur `shortName`/`name` selektiert).
- Entfernen des Abschnitt-Chips setzt `abschnitt` auf `'ALLE'` zurück - die Liste erweitert sich
  automatisch auf die höchste Ebene, für die Rechte bestehen (für einen Bezirksadmin: den ganzen
  Bezirk), da die zugrundeliegende `users`-Query ohnehin unverändert alle Zeilen liefert und nur
  clientseitig gefiltert wird.

## 5. Filterlogik/URL-Zustand

- `activeFilterCount` erweitert sich um `abschnitt !== 'ALLE'`.
- `resetFilters()` setzt zusätzlich `abschnitt` zurück.
- Der bestehende URL-Sync-Effekt (Query-Params `q`/`feuerwehr`/`rolle`/`status`/`sort`/`dir`, plus
  `ebene`/`bereich` seit dem letzten Fix-Durchgang) bekommt einen weiteren bedingten Eintrag:
  `if (abschnitt !== 'ALLE') params.set('abschnitt', abschnitt);`.
- Kein neuer Name-Konflikt: `abschnitt` ist ein Seiten-lokaler Filter-Parameter, keine Kollision mit
  `?ebene=`/`?bereich=` (dem globalen Geltungsbereich-Konzept) oder mit `/admin/heimatfeuerwehr`s
  `?org=` (andere Seite, anderer Namensraum).

## 6. Bestehende Duplikation, die diese Änderung sonst verdoppeln würde

`user-management-section.tsx` hat die Filterzeile aktuell **zweimal** im Code: einmal als
`filterControls`-Variable (nur fürs mobile Bottom Sheet verwendet) und ein zweites Mal identisch von
Hand ausgeschrieben in der Desktop-Inline-Zeile - obwohl ein Kommentar direkt darüber behauptet, es
handle sich um denselben, gemeinsam genutzten Ausdruck. Da diese Änderung ohnehin beide Stellen
anfassen müsste, wird die Desktop-Zeile in derselben Änderung auf `{filterControls}` umgestellt statt
weiter eine zweite, jetzt garantiert abweichende Kopie zu pflegen - eine naheliegende Bereinigung
direkt am Ort der ohnehin nötigen Änderung, keine unabhängige Umgestaltung.

## 7. Umfang / Nicht-Ziele

- Keine serverseitige Filterung/Paginierung - die `users`-Query in `page.tsx` bleibt unverändert
  ungefiltert, alles Filtern bleibt clientseitig wie heute.
- Kein Drohnengruppe- oder erweiterter Rolle-Filter.
- Keine neue Abschnittsliste-Seite.
- `OrgSearchSelect` wird bewusst generisch genug gebaut, um in einer späteren Phase (Abschnittsliste,
  Drohnengruppenliste) wiederverwendbar zu sein, ohne dass diese Phasen hier vorgezogen werden.

## 8. Abnahme

- Ein Bezirksadmin sieht den neuen Abschnitt-Filter; ein Abschnitts-/Feuerwehr-Admin sieht ihn nicht.
- Der Feuerwehr-Filter ist durchsuchbar und nach Abschnitt gruppiert, auch bei allen ~124 Einträgen.
- Wechselt der Geltungsbereich-Wähler auf einen Abschnitt und die Benutzerliste wird ohne expliziten
  `?abschnitt=`-Parameter neu geladen, ist der Abschnitt-Filter bereits entsprechend vorausgewählt.
- Ein expliziter `?abschnitt=<id>`-Parameter in der URL gewinnt gegenüber dem Geltungsbereich.
- Abschnitt wechseln leert die Feuerwehr-Auswahl; die Feuerwehr-Optionen sind auf den gewählten
  Abschnitt beschränkt.
- Entfernen des Abschnitt-Chips zeigt wieder alle Benutzer, für die Rechte bestehen.
- Die Desktop- und Mobile-Filterzeile sind wieder derselbe Codepfad (`filterControls`), nicht zwei
  unabhängige Kopien.
