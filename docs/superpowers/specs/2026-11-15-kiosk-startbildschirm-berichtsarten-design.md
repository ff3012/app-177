# Kiosk-Startbildschirm und Berichtsarten je Feuerwehr — Design

Stand: 2026-11-15. Status: vom App-Betreiber im Brainstorming freigegeben, Spec zur Durchsicht.
Baut auf `docs/superpowers/specs/2026-11-14-berichte-schnellerfassung-ipad-design.md` auf (iPad-Schnellerfassung, auf `main`).

## Ziel

Der iPad-Kiosk (`/berichte-schnell/[token]`) bekommt einen Startbildschirm "Welches Formular ausfüllen?" mit einer Kachel je
Formular (Tätigkeitsbericht, Übungsbericht, Einsatzbericht, Getränkeautomat, Schadensmeldung) in den Farben der App.
Jede Berichtsart lässt sich je Feuerwehr einzeln ein- und ausschalten und hat eine eigene Empfängerliste (wer den Bericht per
E-Mail erhält). Für die erste Stufe sind nur Tätigkeits- und Übungsbericht nutzbar, die übrigen Kacheln sind sichtbar, aber
ausgegraut.

## Entscheidungen (alle vom App-Betreiber)

| Frage | Entscheidung |
|---|---|
| Bedeutung der "eigenen Mitglieder" je Kachel | Es sind die **Empfänger** des Berichts. Alle Mitglieder dürfen jedes Formular ausfüllen, die Namensliste ist für alle Formulare dieselbe |
| Geltungsbereich des Ein-/Aus-Schalters | **iPad und App**: eine abgeschaltete Berichtsart verschwindet auch in der App und wird serverseitig abgelehnt |
| Geräte | Weiterhin **ein Link** je Feuerwehr, dazu ein einstellbarer **Gerätename** (Anzeige im Kopf) |
| Aussehen | Wie die App: heller Hintergrund `#f6f6f7`, dunkler Kopf `#1c1c1e`, Markenrot `#e4322b`, weiße Kacheln (nicht das dunkle Aussehen des Vorbild-Screenshots) |
| Erste Stufe | Nur Tätigkeits- und Übungsbericht aktiv; Einsatzbericht, Getränkeautomat und Schadensmeldung ausgegraut und nicht einstellbar |

## Nicht-Ziele

- Keine Funktion hinter Getränkeautomat und Schadensmeldung; Einsatzbericht bleibt in der App nicht freigeschaltet
  (`ACTIVE_REPORT_TYPES` bleibt `['ACTIVITY', 'EXERCISE']`).
- Keine mehreren Geräte mit eigenem Link, keine Versionsangabe im Kopf.
- Keine Einschränkung, wer ein Formular ausfüllen darf (alle aktiven Mitglieder der Feuerwehr, wie heute).
- Keine Änderung an PDF, E-Mail-Inhalt, Berichtsnummern und MCP-Werkzeugen.

## 1. Datenmodell

Neue Tabelle `ReportTypeSetting` (je Feuerwehr und Berichtsart eine Zeile):

```
model ReportTypeSetting {
  id             String       @id @default(cuid())
  organizationId String
  type           ReportType
  enabled        Boolean      @default(true)
  recipients     String[]     @default([])
  updatedAt      DateTime     @updatedAt
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  @@unique([organizationId, type])
}
```

- **Fehlende Zeile bedeutet:** Berichtsart an, keine Empfänger. Zeilen entstehen erst, wenn ein Admin etwas ändert (kein Anlegen
  für alle 124 Feuerwehren nötig).
- **Migration** `<zeitstempel>_report_type_setting` (von Hand, `migrate dev` ist wegen der bekannten Reihenfolge-Störung der
  Historie tabu): Tabelle anlegen, für jede Organisation mit nicht leerem `reportRecipients` je eine Zeile für `ACTIVITY` und
  `EXERCISE` mit denselben Empfängern anlegen, danach die Spalte `Organization.reportRecipients` löschen (dieselbe sichere
  Reihenfolge wie bei früheren Array-Umbauten: hinzufügen, übernehmen, alte Spalte entfernen). Die Löschung ist nicht
  umkehrbar, daher vor dem PROD-Deploy ein Backup.
- Zusätzlich neue nullable Spalte `Organization.reportKioskDeviceName String?` (Anzeigename des iPads im Kopf).
- `Organization.reportRecipients` wird nur noch an zwei Stellen gelesen (`submit-report-core.ts`, Admin-Formular); beide werden
  umgestellt.

Neue Hilfsfunktionen in `src/lib/heimatfeuerwehr/report-type-settings.ts`:
`getReportTypeSettings(organizationId)` (Karte `{ ACTIVITY, EXERCISE }` mit `{ enabled, recipients }` inkl. Voreinstellung),
`getEnabledReportTypes(organizationId): ReportType[]` (nur Arten aus `ACTIVE_REPORT_TYPES`, die eingeschaltet sind),
`isReportTypeEnabled(organizationId, type)`, `setReportTypeEnabled(organizationId, type, enabled)` und
`setReportTypeRecipients(organizationId, type, recipients)` (je `upsert`). Schreibfunktionen akzeptieren nur Arten aus
`ACTIVE_REPORT_TYPES`.

## 2. Wirkung im geteilten Kern (App und iPad)

`submitReportCore` bekommt als **erste** Prüfung (vor dem Datenbankzugriff der übrigen Validierung):

- Art nicht in `ACTIVE_REPORT_TYPES` oder für die Feuerwehr abgeschaltet: Fehler `'Diese Berichtsart ist nicht verfügbar.'`

Damit gilt die Sperre für die App-Aktion `submitReport` und die Kiosk-Abgabe gleich. Die bisherige Einzelprüfung in
`report-kiosk-submit.ts` entfällt (der Kern deckt sie ab), die zugehörigen Tests wandern in die Tests des Kerns. Das schließt auch
die bekannte Lücke, dass `submitReport` nicht aktive Berichtsarten serverseitig nicht ablehnt.

Empfänger: `submitReportCore` liest die E-Mail-Empfänger aus der Zeile `ReportTypeSetting` der Feuerwehr und der **Art des
Berichts** statt aus `Organization.reportRecipients`. Ohne Zeile oder ohne Empfänger wird wie bisher keine E-Mail an Empfänger
gesendet (die Bestätigung an den Ausfüller bleibt unverändert).

## 3. App: abgeschaltete Arten ausblenden

- `ReportTypeSheet` (Blatt "Welcher Bericht?") bekommt die Liste der eingeschalteten Arten als Prop; abgeschaltete und nicht
  freigeschaltete Arten erscheinen ausgegraut und nicht antippbar. Der Aufrufer `meine-feuerwehr/action-row.tsx` bekommt die Liste
  von der Seite `meine-feuerwehr/page.tsx` (`getEnabledReportTypes(user.homeOrganizationId)`).
- `meine-feuerwehr/berichte/neu/page.tsx`: Ein Parameter `type`, der nicht in der Liste der eingeschalteten Arten steht, wird durch
  die erste eingeschaltete Art ersetzt. Ist keine Art eingeschaltet, antwortet die Seite `notFound()`. Die "Zu erledigen"-
  Fahrzeug-Erinnerung (Link mit `type`) landet dadurch nie auf einer abgeschalteten Art.
- Abschalten versteckt nur: bereits abgegebene Berichte bleiben in "Meine Berichte", PDF und Verwaltungsliste unverändert.

## 4. iPad: Startbildschirm und neuer Ablauf

Ablauf von `kiosk-flow.tsx`: **Formular wählen → Name wählen → Assistent (Art steht fest) → Bestätigung → zurück zum
Formularbildschirm** (nach 30 Sekunden oder "Neues Formular"). Auf dem Namensbildschirm gibt es "← Anderes Formular", im Assistenten
bricht "Abbrechen" zum Formularbildschirm zurück.

**Kopf:** Feuerwehrname klein und in Großbuchstaben, darunter der Titel "Welches Formular ausfüllen?". Rechts eine Gerätekarte
mit "Gerät" und dem Gerätenamen (nur wenn gesetzt), dazu Datum ("So., 15. November 2026") und Uhrzeit, in Wiener Zeit
(`Intl`, `Europe/Vienna`), alle 30 Sekunden aktualisiert. Datum und Uhrzeit werden erst nach dem Einhängen im Browser gesetzt
(kein Unterschied zwischen Server- und Browser-Rendering).

**Kacheln** (fünf, in dieser Reihenfolge, Raster bis vier Spalten, je mindestens 120 px hoch): Icon (lucide, Markenrot), Titel,
Untertitel.

| Kachel | Untertitel | Zustand |
|---|---|---|
| Tätigkeitsbericht | Dienste, Versammlungen, Wartung | aktiv, wenn für die Feuerwehr eingeschaltet |
| Übungsbericht | Geplante Übungen, Schulungen | aktiv, wenn für die Feuerwehr eingeschaltet |
| Einsatzbericht | Alarmierungen, Einsätze | immer ausgegraut, Hinweis "Bald verfügbar" |
| Getränkeautomat | Meldung an Getränkewart | immer ausgegraut, Hinweis "Bald verfügbar" |
| Schadensmeldung | Defekte Ausrüstung melden | immer ausgegraut, Hinweis "Bald verfügbar" |

Eine von der Feuerwehr abgeschaltete Art (Tätigkeits- oder Übungsbericht) erscheint ebenfalls ausgegraut, mit dem Hinweis
"Nicht aktiviert". Ausgegraute Kacheln sind nicht antippbar. Sind alle Kacheln ausgegraut, steht darunter der Hinweis, dass
aktuell kein Formular verfügbar ist.

**Seitendaten** (`loadKioskData`): zusätzlich `deviceName` und `enabledTypes`; "Zuletzt verwendet" nur für eingeschaltete Arten.
Der Rest (Mitglieder nur Id und Name, Fahrzeuge) bleibt. Der Kern lehnt eine inzwischen abgeschaltete Art bei der Abgabe ab, auch
wenn die Seite noch offen war; die Fehlermeldung erscheint im Assistenten wie jeder andere Abgabefehler.

**Farben und Form:** Seite `#f6f6f7`, Kopf `#1c1c1e` mit Markenrot als Akzent, Kacheln weiß mit Rand und leichtem Schatten,
Icons in Markenrot, ausgegraute Kacheln mit gedämpftem Text und grauem Icon. Alle Tipp-Ziele mindestens 48 px.

## 5. Verwaltung (`/admin/heimatfeuerwehr`)

- Die Karte "Berichte-Schnellerfassung (iPad)" bekommt ein Feld **Gerätename** (Speichern per Server Action, leerer Wert =
  Name entfernt, höchstens 60 Zeichen, gekürzt/getrimmt). Link erzeugen/neu erzeugen/abschalten bleibt wie bisher, nur für aktive
  Feuerwehren.
- Die bisherige Empfängerliste in der Karte "Berichte" (`ReportRecipientsForm`) wird durch zwei Blöcke **Tätigkeitsbericht** und
  **Übungsbericht** ersetzt: je ein Schalter "Aktiviert" und die Empfängerliste (gleiche Chips und derselbe Mitglieder-Picker wie
  heute, Kommentar im Formular: wer den Bericht per E-Mail mit PDF erhält). Das Formular wird so verallgemeinert, dass es je Berichtsart
  gebunden ist (`organizationId` und `type`).
- Die Textzeile "Tätigkeitsbericht: Aktiv · Übungsbericht: Nicht aktiv · Einsatzbericht: Nicht aktiv" in dieser Karte wird durch den
  tatsächlichen Stand der Schalter ersetzt (sie ist heute veraltet).
- Beim Ausschalten einer Art fragt ein Dialog nach, nennt die Wirkung (verschwindet in der App und am iPad, bestehende Berichte
  bleiben) und ändert nichts an den Empfängern. Einschalten fragt nicht.
- Jede Server Action prüft `canManageHeimatfeuerwehrFor(user, organizationId)` neu und akzeptiert nur Arten aus
  `ACTIVE_REPORT_TYPES`.

## 6. Tests und Prüfung

- **DB-Tests (nur lokale Datenbank, mit geschützter Aufräumung):** abgeschaltete Art wird vom Kern auf App- und Kiosk-Weg abgelehnt
  (Fehlertext, kein Bericht, keine Nummer verbraucht); nicht freigeschaltete Art (Einsatzbericht) weiter abgelehnt; die Empfänger
  stammen aus der Zeile der Berichtsart (Tätigkeits- und Übungsbericht mit verschiedenen Listen); fehlende Zeile = eingeschaltet,
  keine Empfänger; `set…`-Funktionen legen an/ändern und lehnen Einsatzbericht ab; die Migration übernimmt `reportRecipients` in beide
  Zeilen. Geprüft einmalig von Hand an der lokalen Entwicklungsdatenbank (ein Neuaufbau aus der Historie scheitert am bekannten
  Reihenfolge-Fehler): vor `prisma migrate deploy` eine Beispiel-Feuerwehr mit gesetztem `reportRecipients` anlegen, Migration
  anwenden, die zwei neuen Zeilen mit denselben Empfängern prüfen, Beispiel-Feuerwehr wieder löschen; `loadKioskData` liefert
  `deviceName` und `enabledTypes`.
- **Unit-/Render-Tests:** Kachelzustände (aktiv, "Bald verfügbar", "Nicht aktiviert", alle ausgegraut), neuer Ablauf (erste Phase ist
  der Formularbildschirm, kein Namensraster), Kopf mit/ohne Gerätename, `ReportTypeSheet` mit Liste, Auswahlregel der Art im
  App-Assistenten (reine Funktion, getestet).
- Prüfung vor Abschluss: `npx tsc --noEmit`, `npm test`, `npm run test:db`, `npm run build`; im Browser (1180×820) der
  serverseitig gerenderte Formularbildschirm und der 404 für einen ungültigen Link. Das Durchklicken am echten iPad macht der
  App-Betreiber.

## 7. Rollout

1. DEV: Migration läuft im Entrypoint. Prüfen: bestehende Empfänger sind nach dem Deploy je Berichtsart sichtbar, Schalter
   umlegen, Gerätename setzen, am iPad beide Formulare abgeben und prüfen, dass Mails nur an die Empfänger der jeweiligen Art gehen.
2. PROD: Backup (die Migration löscht eine Spalte), `git pull`, Rebuild. Keine neue Umgebungsvariable, keine Cron- oder
   Compose-Änderung.
3. Die Standardeinstellung (fehlende Zeile) schaltet beide Berichtsarten ein, damit sich für bestehende Nutzer nichts ändert.

## Offene Punkte (nicht blockierend)

- Texte der Untertitel und Hinweise ("Bald verfügbar", "Nicht aktiviert") können nach dem ersten Blick am iPad angepasst werden.
- Sobald Getränkeautomat und Schadensmeldung echte Funktionen bekommen, brauchen sie je eine eigene Spec (eigener Datentyp,
  Empfänger-Mitglieder wie "Getränkewart"); die Tabelle `ReportTypeSetting` ist dafür ausdrücklich nicht gedacht, weil diese
  Formulare keine Berichte (`Report`) sind.
