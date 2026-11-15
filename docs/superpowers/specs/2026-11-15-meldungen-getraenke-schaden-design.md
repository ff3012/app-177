# Meldungen "Getränkeautomat" und "Schadensmeldung" (iPad und App) — Design

Stand: 2026-11-15. Status: vom App-Betreiber im Brainstorming freigegeben, Spec zur Durchsicht.
Baut auf `docs/superpowers/specs/2026-11-15-kiosk-startbildschirm-berichtsarten-design.md` auf (Startbildschirm mit fünf Kacheln,
`ReportTypeSetting`); dort sind diese beiden Kacheln bisher ausgegraut ("Bald verfügbar").

## Ziel

Zwei einfache Meldeformulare, die als E-Mail an eine je Feuerwehr einstellbare Empfängerliste gehen:

- **Getränkeautomat:** "Welche Produkte fehlen?" (Auswahl aus der Produktliste der Feuerwehr) plus Anmerkung, Meldung an den Getränkewart.
- **Schadensmeldung:** Datum, betroffenes Gerät/Ausrüstung, "Ist der Schaden akut?", Beschreibung, Meldung für defekte Ausrüstung.

Beide sind am iPad (Kacheln des Startbildschirms) und in der App (angemeldete Mitglieder) verfügbar. Es sind **keine Berichte**
(`Report`): kein PDF, keine Nummer, **nichts wird gespeichert**.

## Entscheidungen (alle vom App-Betreiber)

| Frage | Entscheidung |
|---|---|
| Speichern | **Nur E-Mail** an die Empfänger, keine Datenbankzeile, kein Verlauf |
| Produktliste (Getränkeautomat) | **Je Feuerwehr einstellbar**, Voreinstellung Bier, Spritzer, Eistee, Spezi |
| Geltungsbereich | **iPad und App** |
| Empfänger und Schalter | Je Feuerwehr und Formular eigene Empfängerliste und eigener Schalter (wie bei den Berichtsarten) |
| Aussehen | Wie die App (hell), Vorlage für Aufbau und Felder sind die Screenshots des Betreibers |

## Nicht-Ziele

- Kein Speichern, kein Verlauf, keine Statusanzeige für Admins, keine Wiederholung eines fehlgeschlagenen Versands aus der Verwaltung.
- Keine Fotos oder Anhänge, kein PDF.
- Keine weiteren Formulare (nur diese zwei), keine MCP-Werkzeuge.
- Keine Änderung an Berichten, `ReportTypeSetting` und der Berichts-Abgabe.

## 1. Daten

Neue Aufzählung und Tabelle (Migration rein additiv):

```
enum NotificationForm { DRINKS DAMAGE }

model NotificationFormSetting {
  id             String           @id @default(cuid())
  organizationId String
  form           NotificationForm
  enabled        Boolean          @default(true)
  recipients     String[]         @default([])
  products       String[]         @default([])   // nur DRINKS; leer = Standardprodukte
  updatedAt      DateTime         @updatedAt
  organization   Organization     @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  @@unique([organizationId, form])
}
```

- **Fehlende Zeile bedeutet:** eingeschaltet, keine Empfänger, Standardprodukte.
- **Verfügbar** ist ein Formular für eine Feuerwehr nur, wenn es **eingeschaltet ist und mindestens einen Empfänger hat**.
  Ohne Empfänger gäbe es sonst eine Meldung, die nirgends ankommt.
- **Produktliste:** 1 bis 12 Produkte, je getrimmt, 1 bis 30 Zeichen, ohne Doppelte (Groß-/Kleinschreibung ignoriert).
  `DEFAULT_DRINK_PRODUCTS = ['Bier', 'Spritzer', 'Eistee', 'Spezi']`. Eine leere gespeicherte Liste bedeutet die Standardliste.
- **Bibliothek** `src/lib/heimatfeuerwehr/notification-form-settings.ts`: `getNotificationFormSettings(organizationId)` (Karte
  `{ DRINKS, DAMAGE }` mit `{ enabled, recipients, products }`, Voreinstellungen aufgelöst), `isNotificationFormAvailable(organizationId, form)`,
  `getAvailableNotificationForms(organizationId)`, `saveNotificationFormEnabled`, `saveNotificationFormRecipients`, `saveDrinkProducts`
  (je `upsert`, nur für aktive `FEUERWEHR`; ungültige Produktlisten werden abgelehnt) und die reinen Hilfen `parseDrinkProducts(raw)` und
  `resolveNotificationFormSettings(rows)`.
- **Formular-Kennungen für URLs:** `getraenkeautomat` ↔ `DRINKS`, `schadensmeldung` ↔ `DAMAGE` (eine Konstante, ein Mapping in beide Richtungen).

## 2. Abgabe (gemeinsamer Kern)

`submitNotificationCore({ organizationId, senderId, input })` in `src/lib/heimatfeuerwehr/submit-notification-core.ts`. Eingabe:

```
type NotificationInput =
  | { form: 'DRINKS'; products: string[]; note: string | null }
  | { form: 'DAMAGE'; occurredOn: string /* YYYY-MM-DD */; equipment: string; acute: boolean | null; description: string };
```

Der Kern prüft serverseitig **in dieser Reihenfolge**:

1. Formular bekannt und für die Feuerwehr **verfügbar** (eingeschaltet, mindestens ein Empfänger), sonst `'Dieses Formular ist nicht verfügbar.'`
2. Absender: aktives (nicht bewusst deaktiviertes, `NOT_DEACTIVATED_WHERE`) Mitglied genau dieser Feuerwehr, sonst
   `'Das ausgewählte Mitglied gehört nicht zu dieser Feuerwehr.'`
3. Felder:
   - **Getränkeautomat:** mindestens ein Produkt, jedes Produkt steht in der Produktliste der Feuerwehr (ohne Doppelte), Anmerkung höchstens 1000 Zeichen.
   - **Schadensmeldung:** Datum gültig, nicht in der Zukunft (Wiener Datum) und höchstens 365 Tage zurück; Gerät/Ausrüstung 1 bis 120 Zeichen;
     Beschreibung 1 bis 2000 Zeichen; `acute` ist `true`, `false` oder `null` (nicht angegeben).
   Fehlertexte statisch, nie Eingabewerte zitieren. Alle Texte werden getrimmt, Pflichtfelder dürfen nicht nur aus Leerzeichen bestehen.
4. Versand: **eine E-Mail je Empfänger** (kein gemeinsames An/Cc, wie bei den übrigen Benachrichtigungen), Absenderadresse nur als `replyTo`.

Inhalt der Mail (Text und HTML, alle Werte per `escapeHtml`): Feuerwehrname, Formularname, gemeldet von (Name), Zeitpunkt (Wiener Zeit), danach die Felder.
Betreff Getränkeautomat: `Getränkeautomat: Produkte fehlen – <Feuerwehr>`; Betreff Schadensmeldung: `Schadensmeldung: <Gerät> – <Feuerwehr>`, bei
`acute === true` mit Vorsatz `AKUT: `. Bei der Schadensmeldung steht im Text "Akut: Ja / Nein / nicht angegeben". Der Versand liegt in
`src/lib/heimatfeuerwehr/notify-notification-form.ts` und liefert `{ attempted, failed }`; einzelne Fehler werden pro Empfänger abgefangen und
protokolliert (ohne Adressen und Inhalte im Log).

**Ergebnis:** `{ ok: true }`, wenn mindestens eine Mail rausging. Scheitert der Versand an **allen** Empfängern, ist das Ergebnis
`{ error: 'Die Meldung konnte nicht gesendet werden. Bitte erneut versuchen.' }` und der Nutzer kann es erneut versuchen (es ist ja nichts
gespeichert). Teilausfälle gelten als gesendet. Der Kern wirft nie nach außen, ein unerwarteter Fehler wird als derselbe allgemeine Fehler
gemeldet.

**Einstiege:**
- **Kiosk:** `submitNotificationForKiosk(token, senderId, input)` (neue Datei `report-kiosk-notification-submit.ts`): Link bei jeder Abgabe neu
  auflösen (sonst `'Die Schnellerfassung ist nicht mehr aktiv.'`), Limit mit **derselben** Funktion und demselben Schlüssel wie die Berichte
  (`kioskRateKey`, 20 pro Stunde und Link, gezählt erst nach der Linkprüfung), dann der Kern. Dünne Server Action `submitNotificationViaKiosk` in
  `src/app/berichte-schnell/[token]/actions.ts`.
- **App:** Server Action `submitNotification(input)` in `src/app/(app)/meine-feuerwehr/meldungen/actions.ts`: `requireUser()` und
  `canCreateReportFor(user, user.homeOrganizationId)` (jedes Mitglied der Heimatfeuerwehr), Absender ist der angemeldete Benutzer.

Hinweis zum Betrieb: Ohne konfiguriertes Mailjet (z. B. lokale Entwicklung) scheitert der Versand an allen Empfängern und der Nutzer sieht den Fehler.

## 3. Formulare (Oberfläche)

Eine gemeinsame Komponente `NotificationFormView` (`src/components/heimatfeuerwehr/notification-form-view.tsx`) mit `layout: 'mobile' | 'tablet'`:

- **Getränkeautomat:** Karte "Meldung": "Welche Produkte fehlen?" als Auswahl-Chips (Mehrfachauswahl, Pflicht, mindestens eines) und "Anmerkung" (Textfeld).
  Pflichtfelder: 1.
- **Schadensmeldung:** Karte "Datum" (Datum, Pflicht, Vorgabe heute) und Karte "Schaden": "Betroffenes Gerät / Ausrüstung" (Pflicht), "Ist der Schaden
  akut?" (zwei Schalter "Akut" / "Nicht akut", optional, ein erneuter Tipp hebt die Wahl wieder auf), "Beschreibung des Schadens" (Pflicht).
  Pflichtfelder: 3.
- Fußzeile (Tablet fest unten, Handy fest über der Leiste wie im Assistenten): "Abbrechen", Mitte "x / y Pflichtfelder ausgefüllt", rechts
  "Meldung absenden" (erst aktiv, wenn alle Pflichtfelder ausgefüllt sind; während des Sendens gesperrt). Ein Fehler vom Server steht über der Fußzeile.
- Reine Logik in `notification-form-fields.ts`: `countRequired(form, values)` ergibt `{ filled, total, complete }`, `emptyValues(form, today)`,
  `toInput(form, values)`. Alle Tipp-Ziele mindestens 48 px, App-Look (`#f6f6f7`, weiße Karten, Markenrot für die Auswahl).
- Kein zweiter Zustand und keine zweite Prüfung am Server: die Komponente sammelt nur, der Kern prüft alles.

## 4. iPad

- Startbildschirm: Die Kacheln Getränkeautomat und Schadensmeldung sind **aktiv**, wenn das Formular verfügbar ist. Zusätzlicher Zustand
  `'norecipient'` (Hinweis "Kein Empfänger hinterlegt") für ein eingeschaltetes Formular ohne Empfänger, `'off'` ("Nicht aktiviert") für ein
  abgeschaltetes. Nur der Einsatzbericht bleibt "Bald verfügbar". `getKioskTiles` bekommt die verfügbaren Formulare zusätzlich zu den
  eingeschalteten Berichtsarten.
- Ablauf: Kachel → Name wählen → Formular (`NotificationFormView`, Layout wie der Assistent: ab 1024 px Tablet, darunter Handy) → Bestätigung
  "Meldung gesendet" (ohne Nummer) → nach 30 Sekunden oder "Neues Formular" zurück zum Startbildschirm. Der Kopf zeigt wie beim Assistenten
  Feuerwehrname · Name des Ausfüllers und den Formulartitel. Abbrechen führt zum Startbildschirm.
- Seitendaten (`loadKioskData`): zusätzlich `notificationForms` je Formular `{ state, products }` (Produkte nur für Getränkeautomat). Es verlassen
  weder Empfängeradressen noch Einstellungen außer dem Zustand und den Produktnamen den Server.

## 5. App

- `ReportTypeSheet` ("Welcher Bericht?") bekommt einen zweiten Abschnitt **"Meldungen"** mit Getränkeautomat und Schadensmeldung (gleiche
  Zustände und Hinweise wie am iPad, gesperrt = nicht antippbar). `meine-feuerwehr/page.tsx` lädt die verfügbaren Formulare zusammen mit den
  eingeschalteten Berichtsarten.
- Neue Seite `/meine-feuerwehr/meldungen/[formular]` (`getraenkeautomat` oder `schadensmeldung`, sonst 404, ebenso 404, wenn das Formular
  nicht verfügbar ist). Sie rendert `NotificationFormView` im Handy-Layout, nach dem Absenden erscheint "Meldung gesendet" mit Link zurück zur
  Startseite.

## 6. Verwaltung (`/admin/heimatfeuerwehr`)

In der Karte "Berichte" kommt unter den Berichtsarten ein Abschnitt **"Meldungen"** (nur für Feuerwehren): je Formular eine Zeile mit Schalter
"Aktiviert", Empfängerliste (gleiche Chips und derselbe Mitglieder-Picker wie bei den Berichtsarten), beim Getränkeautomat zusätzlich die
**Produktliste** (Chips, Hinzufügen/Entfernen, 1 bis 12, Hinweis auf die Standardprodukte). Ein Hinweistext erklärt: eine Meldung ist nur
verfügbar, wenn sie eingeschaltet ist und mindestens einen Empfänger hat. Beim Ausschalten fragt ein Dialog nach (Wirkung: verschwindet am iPad und
in der App, Empfänger und Produkte bleiben erhalten). Server Actions in `admin/heimatfeuerwehr/actions.ts`: `setNotificationFormEnabled`,
`setNotificationFormRecipients`, `setDrinkProducts`, jede mit `canManageHeimatfeuerwehrFor(user, organizationId)` neu geprüft, Formular
gegen die bekannten Werte validiert, Fehler nur bei bekannten Geschäftsmeldungen, sonst allgemeiner Text und `console.error` (kein bloßes `catch {}`).

## 7. Tests und Prüfung

- **DB-Tests (nur lokale Datenbank, geschützte Aufräumung, Mail gemockt):** Einstellungen (Standardwerte, Schalter, Empfänger, Produkte getrennt je
  Formular, Ablehnung für Nicht-Feuerwehren und ungültige Produktlisten); Kern: abgeschaltetes Formular und Formular ohne Empfänger werden abgelehnt,
  Absender einer anderen Feuerwehr und deaktivierter Absender werden abgelehnt, ein Produkt außerhalb der Liste wird abgelehnt, Datum in der
  Zukunft und zu alt werden abgelehnt, ungültige Längen werden abgelehnt, ein gültiger Versand erzeugt je Empfänger genau eine Mail mit den
  erwarteten Betreff- und Textbausteinen (AKUT-Vorsatz, "nicht angegeben"), ein Totalausfall des Versands liefert den Fehler, ein Teilausfall
  nicht; Kiosk: unbekannter und abgeschalteter Link, Limit mit gemeinsamem Zähler, fremder Absender; `loadKioskData` liefert Zustände und Produkte.
- **Unit-/Render-Tests:** `countRequired`, `emptyValues`, `toInput`, `parseDrinkProducts`; Kachelzustände (`getKioskTiles` mit den neuen Zuständen);
  `NotificationFormView` (Pflichtfeldzähler, "Meldung absenden" gesperrt/aktiv, beide Layouts); `ReportTypeSheet` mit Abschnitt "Meldungen".
- Prüfung vor Abschluss: `npx tsc --noEmit`, `npm test`, `npm run test:db`, `npm run build`; im Browser (1180×820) der serverseitig
  gerenderte Startbildschirm mit den neuen Kachelzuständen und die 404-Seite für ein nicht verfügbares Formular. Das Durchklicken der Formulare
  macht der App-Betreiber am echten iPad und im Handy.

## 8. Rollout

1. Migration additiv, läuft im Entrypoint, kein neues Backup nötig über das übliche hinaus. Keine neue Umgebungsvariable, keine Cron- oder
   Compose-Änderung. Voraussetzung ist ein konfiguriertes Mailjet (wie für alle übrigen E-Mails der App; auf dem jeweiligen Stack vor dem Test prüfen).
2. Nach dem Deploy sind beide Formulare standardmäßig **nicht verfügbar**, bis ein Admin Empfänger einträgt (bei Getränkeautomat optional
   die Produktliste anpasst). Bestehende Funktionen ändern sich nicht.
3. DEV-Prüfung: je Formular Empfänger eintragen, am iPad und in der App je eine Meldung absenden, die E-Mails kontrollieren (Betreff, Inhalt,
   Reply-To, AKUT-Vorsatz); Formular abschalten und prüfen, dass die Kachel und der App-Eintrag grau werden.

## Offene Punkte (nicht blockierend)

- Weil nichts gespeichert wird, gibt es keinen Nachweis über abgeschickte Meldungen außer den E-Mails selbst; wer das später braucht, ergänzt eine
  Speicherung als eigene Spec.
- Texte der Hinweise und Untertitel können nach dem ersten Blick am iPad angepasst werden.
