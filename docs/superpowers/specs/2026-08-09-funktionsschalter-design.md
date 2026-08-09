# Funktionsschalter je Heimatfeuerwehr — Design

Quelle: Claude-Design-Projekt `Funktionsschalter-Brief.md` (Mockup: `Heimatfeuerwehr Funktionen.dc.html`,
"Signalrot"). Betroffen: `/admin/heimatfeuerwehr`, `/meine-feuerwehr`, `/dashboard/[token]`.

**Kernregel (unverändert aus dem Brief):** Abschalten blendet aus, es löscht nichts. Kein `DELETE`, kein
Soft-Delete, kein Nullen von Feldern. Reaktivierung zeigt alle Daten unverändert wieder.

Zwei Punkte wurden gegenüber dem Original-Brief bewusst angepasst, nach Rücksprache mit dem App-Owner
(siehe Anhang "Abweichungen vom Brief" am Ende):

1. Das bestehende Facebook-Formular in der Verwaltung (Page-ID + Access-Token pro Feuerwehr) bleibt
   unverändert bestehen. Der Brief-Satz "Token gehört in die Serverkonfiguration" wird nicht umgesetzt.
2. `featureFacebook` startet nach der Migration `true` für jede Feuerwehr, die bereits sowohl
   `facebookPageId` als auch `facebookPageAccessToken` gesetzt hat (aktuell: Wolfsgraben) — sonst `false`.

## 1. Datenmodell

Auf dem bestehenden `Organization`-Modell (nicht ein neues `FireDepartment`-Modell — diese Codebase hat
bereits `Organization` für Feuerwehren und AFKDO):

```prisma
featureAtemschutz     Boolean   @default(true)
featureFacebook       Boolean   @default(false)
featuresUpdatedAt     DateTime?
featuresUpdatedByName String?
```

- `featuresUpdatedByName` ist ein reiner Namens-Schnappschuss zum Zeitpunkt der Änderung (z. B.
  "Florian Krebs"), keine FK-Relation zu `User` — analog zur bereits bestehenden Entscheidung, für den
  admin-ausgelösten Passwort-Reset-Trigger nur ein `console.log` statt einer persistierten Audit-Spalte zu
  verwenden (siehe CLAUDE.md, Benutzerverwaltung-Brief.md-Abschnitt). Vermeidet eine Diskussion über
  `onDelete`-Verhalten, falls der ändernde Admin später gelöscht wird.
- Migration: `featureAtemschutz` defaultet `true` für alle (Spalte nullable-los mit `@default(true)` direkt
  in derselben Migration angelegt, da eine reine `@default`-Spalte ohne Backfill-Bedarf ist). `featureFacebook`
  defaultet `false` in der Spaltendefinition, aber die Migration setzt sie per `UPDATE` explizit auf `true`
  für jede Organisation, deren `facebookPageId` UND `facebookPageAccessToken` beide `IS NOT NULL` sind —
  genau die "an, wenn schon ein Token existiert"-Regel oben.
- **`src/lib/heimatfeuerwehr/features.ts`**: `getOrganizationFeatures(organizationId)` als Helfer für
  Server Actions/Cron-Routen, die die Organisation noch nicht geladen haben (einzelne `findUniqueOrThrow`
  mit `select: { featureAtemschutz, featureFacebook }`). Seiten, die die Organisation ohnehin per `select`
  laden (`/admin/heimatfeuerwehr`, `/meine-feuerwehr`, `/dashboard/[token]`), ergänzen ihr bestehendes
  `select` um die zwei Felder und lesen sie direkt — keine zusätzliche Query. Cron-Loops (Facebook-Fetch,
  Atemschutz-Warnung), die ohnehin schon Organization-Zeilen in Bulk laden, fügen die Felder ihrem
  bestehenden `where`/`select` hinzu statt den Helfer pro Iteration aufzurufen (kein N+1).

## 2. Verwaltung: Block "Funktionen"

Neue Karte ganz oben auf `/admin/heimatfeuerwehr`, vor "Wappen" — gleiche Karten-Optik wie die anderen
Abschnitte dieser Seite (`rounded-lg bg-surface p-4 shadow-card`), keine neue Bibliothek nötig.

Kopf: Titel "Funktionen" + Erklärtext (Brief-Wortlaut übernommen).

Je Zeile: Name + Status-`Badge` (Aktiv = `success-subtle`, Aus = `bg-surface-sunken`), Erklärung, Metazeile;
rechts ein shadcn `Switch` (bereits im Projekt vorhanden, `components/ui/switch.tsx`).

| Zeile | Metazeile | Besonderheit |
|---|---|---|
| Modul Atemschutzgeräteträger | "{members.length} Mitglieder erfasst · zuletzt geändert {featuresUpdatedAt} durch {featuresUpdatedByName}" | — |
| Facebook-Integration Dashboard | "Verbunden mit facebook.com/{facebookPageId} · zuletzt abgerufen {facebookLastFetchAt}" wenn Token+aktiv; sonst nichts | ohne Token: `Switch disabled` + `warning-subtle`-Hinweisbox |

Abweichung vom Brief: die Metazeile nennt den `facebookPageId` (z. B. `facebook.com/feuerwehr.wolfsgraben`),
nicht einen "Seitennamen" — die App speichert aktuell keinen von Facebook aufgelösten Anzeigenamen, nur die
Page-ID (identisch zur bestehenden Anzeige auf dem Dashboard selbst). Bei einem Fehler beim letzten Abruf
(`facebookLastFetchError` gesetzt, Switch bleibt an) zeigt die Metazeile generisch "Fehler beim letzten
Abruf: {facebookLastFetchError}" statt spezifisch "Token abgelaufen" — eine zuverlässige Unterscheidung
"abgelaufen" vs. anderer Graph-Fehler würde brüchiges String-Parsing der Facebook-Fehlermeldung erfordern.

**Speichern**: sofort beim Umschalten, `setOrganizationFeature(organizationId, feature, enabled)` Server
Action, optimistisches Update im Client, bei Fehler zurückschalten + `sonner`-Toast (gleiche
Optimistic-Update-Handhabung wie andere `Switch`/`ToggleSwitch`-Stellen in dieser Codebase, z. B.
`toggleDroneActive` auf `/admin/drohnen`). Kein Speichern-Button.

## 3. Abschalt-Dialog

Nur beim Weg Ein → Aus (Einschalten braucht keine Rückfrage) — shadcn `AlertDialog` (bereits im Projekt),
Inhalt exakt wie im Brief spezifiziert: Mitgliederzahl serverseitig ermittelt (`members.length`, die Query
existiert auf dieser Seite bereits), grüne Erhaltungs-Hinweisbox ist Pflichtbestandteil, Buttons
Abbrechen/Modul abschalten.

## 4. Wirkung: Atemschutz aus

- **`/meine-feuerwehr`**: die gesamte Atemschutz-Karte (`id="atemschutz-status"`) entfällt vollständig,
  unabhängig von `istAtemschutzgeraeteTraeger` des Mitglieds. Der `buildAtemschutzTodo`-Eintrag im
  "Zu erledigen"-Block wird übersprungen. Die "Stand der Wehr"-Kachel "Atemschutz laufen ab" entfällt
  ebenfalls (statt eine sinnlose "0 laufen ab"-Kachel für ein ausgeschaltetes Modul zu zeigen) — die
  verbleibende Mitglieder-Kachel nimmt die volle Breite ein, analog zum bestehenden
  `droneMember ? grid-cols-2 : grid-cols-1`-Muster.
- **`/admin/heimatfeuerwehr`**: die gesamte Atemschutz-Karte (inkl. Sachbearbeiter-Formular, Tabelle,
  Excel-Export-Link) entfällt ersatzlos, kein Platzhalter.
- **Serverseitig**: `atemschutz-export`-Route liefert `notFound()`, wenn `featureAtemschutz` aus ist. Die
  Server Actions hinter `AtemschutzEditDialog` (Untersuchungs-/Finnentest-Daten speichern) und
  `AtemschutzSachbearbeiterForm` (`setAtemschutzSachbearbeiter`) prüfen das Flag zusätzlich zur
  bestehenden `canManageHeimatfeuerwehrFor`-Prüfung und lehnen ab, wenn es aus ist.
- **Tägliche Atemschutz-Warn-Mail** (`checkAndNotifyAtemschutzWarnungen`): die Organisations-Query bekommt
  `featureAtemschutz: true` zusätzlich zum bestehenden `atemschutzSachbearbeiterEmail`-Filter — pausiert
  automatisch, keine separate "Pause"-Logik nötig.
- **Unverändert**: die Atemschutzgeräteträger-Untersuchungs-/Finnentest-Datensätze, die
  Sachbearbeiter-E-Mail-Adresse selbst, und der `istAtemschutzgeraeteTraeger`-Schalter im
  Benutzerverwaltungs-Sheet (bleibt immer sichtbar/bedienbar, unabhängig vom Feature-Flag der Feuerwehr).

## 5. Wirkung: Facebook aus

Gilt sowohl wenn kein Token hinterlegt ist als auch wenn ein Token existiert, der Schalter aber manuell aus
ist — in beiden Fällen rendert das Dashboard die "ohne Facebook"-Variante, nicht nur eine leere
Facebook-Spalte.

- **Grid-Umschaltung** (`/dashboard/[token]`): dritte Spaltenbreite wechselt von
  `clamp(380px,27vw,560px)` (mit Facebook, ~508px @1920) auf `clamp(500px,36.5vw,760px)` (ohne Facebook,
  ~700px @1920 — proportional aus dem Brief abgeleitet, nicht als fixer Pixelwert übernommen, da diese
  Codebase durchgehend fluid mit `clamp()`/`vw` arbeitet statt fixer Breakpoint-Werte).
- Spalte 2 zeigt "Fahrzeuge + QR" (QR-Karte wandert von Spalte 3 in Spalte 2, unter die Fahrzeugtabelle),
  Spalte 3 zeigt ausschließlich die WASTL-Karte über die volle Spaltenhöhe.
- Die Fahrzeugtabelle bekommt ein zweites, schmaleres `grid-template-columns`-Preset für den Fall
  "Facebook aus" (da Spalte 2 durch die breitere Spalte 3 real schmaler wird) — beide Presets bleiben
  `clamp()`-basiert, ausgewählt anhand von `featureFacebook`, damit "Ausgeborgt von" nie aus der Karte
  läuft.
- Fußzeile: "Quellen: App-177, WASTL Niederösterreich" ohne "Facebook", wenn aus.
- **Facebook-Fetch-Cron** (`/api/cron/facebook-fetch`): die Organisations-Query bekommt
  `featureFacebook: true` zusätzlich zum bestehenden `facebookPageId: { not: null }`-Filter — eine pausierte
  Feuerwehr wird stündlich übersprungen, `facebookLastFetchAt/-Error` bleiben eingefroren auf ihrem letzten
  Stand (erwartetes Verhalten, kein Bug).

## 6. Umsetzungsreihenfolge

1. Migration (`featureAtemschutz`/`featureFacebook`/`featuresUpdatedAt`/`featuresUpdatedByName` + Backfill)
   + `getOrganizationFeatures()`-Helfer.
2. Funktionen-Karte in der Verwaltung + `setOrganizationFeature`-Server-Action (optimistisch, Facebook
   ohne Token deaktiviert).
3. Abschalt-Dialoge (nur Ein→Aus).
4. Atemschutz ausblenden — Client (`/meine-feuerwehr`, `/admin/heimatfeuerwehr`) und Server (Export-Route,
   beide Server Actions, Warn-Cron).
5. Dashboard-Grid-Umschaltung (Layout-Reflow, zweites Tabellen-Spaltenraster, Fußzeile) +
   Facebook-Fetch-Cron-Filter.
6. Verifikation: `tsc`/`build`, Migrations-Backfill gegen die lokale Dev-DB geprüft (Org mit Token → an,
   ohne → aus), Toggle-Rundlauf per Skript (Browser-Interaktion in dieser Umgebung nicht klickbar, siehe
   bereits dokumentierte Hydration-Einschränkung), Dashboard bei 1920×1080 mit UND ohne Facebook im Browser
   verglichen, CLAUDE.md-Eintrag, Commit.

## 7. Abnahme (aus dem Brief übernommen)

- Atemschutz aus → Modul verschwindet aus "Meine Feuerwehr" und der Verwaltung; Direktaufruf der
  Export-Route liefert 404.
- Atemschutz wieder ein → alle Datensätze unverändert vorhanden.
- Facebook aus → Dashboard bei 1920×1080 ohne Lücke, ohne Scrollbalken, Tabelle vollständig in ihrer Karte,
  WASTL-Karte größer als zuvor.
- Eine Feuerwehr mit Atemschutz aus beeinflusst keine andere Feuerwehr im selben Abschnitt.
- Bestandswehren nach der Migration: Atemschutz an; Facebook an nur bei bereits vorhandenem Token, sonst
  aus (angepasst gegenüber dem Brief, siehe oben).
- Eine Feuerwehr ohne Token kann Facebook nicht aktivieren — Switch gesperrt, auch ein manipulierter
  Request setzt das Flag nicht (serverseitig geprüft).

## Abweichungen vom Brief

1. **Facebook-Token-Pflege bleibt im Admin-UI.** Der Brief wollte die Token-Pflege komplett aus der
   Web-Oberfläche entfernen ("gehört in die Serverkonfiguration, gesetzt vom Systembetreuer"). Das
   widerspricht der bestehenden, gewollten Architektur dieser App (jede Feuerwehr konfiguriert ihre eigene
   Facebook-Seite selbst über `/admin/heimatfeuerwehr`, kein Server-seitiges Hardcoding). Der bestehende
   `DashboardFacebookConfigForm` bleibt unverändert; der neue Funktionen-Schalter steuert ausschließlich
   Sichtbarkeit/Aktivierung, nicht die Eingabe der Zugangsdaten.
2. **Facebook-Default nach Migration** ist token-abhängig (an mit Token, aus ohne), nicht unconditional
   "aus" wie im Brief — verhindert eine Unterbrechung der bereits laufenden Wolfsgraben-Integration.
