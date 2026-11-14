# Feuerwehr-App Bezirk 17 St. Pölten

Web-App für den Bezirk 17 St. Pölten (Niederösterreich): 7 Abschnitte, 124 Feuerwehren/
Betriebsfeuerwehren, 4 Drohnengruppen. Installierbar als PWA (Icon am Homescreen, iOS/Android) –
kein App-Store-Build nötig.

> Die App wurde ursprünglich für einen einzelnen Abschnitt gebaut (Abschnitt Purkersdorf,
> 9 Feuerwehren, ~200 Benutzer) und danach auf den gesamten Bezirk erweitert. Das Branding (Logo,
> Login-Seite, PWA-Manifest, E-Mail-Texte) ist seit August 2026 auf "BFKDO St. Pölten" umgestellt;
> in der Datenbank gespeicherte Organisationsnamen (z. B. "AFKDO Purkersdorf") sind bewusst
> unverändert. Details zur Bezirk/Abschnitt/Feuerwehr-Hierarchie und dem Berechtigungsmodell stehen
> in [CLAUDE.md](CLAUDE.md).

## Module

- **Kalender** – eigener Kalender pro Feuerwehr + Abschnitt-weiter Kalender, Kalender- oder
  Listenansicht (Listenansicht ist Standard), .ics-Export/Abo für Outlook/Google/Apple Kalender,
  optionaler read-only Import aus einem externen .ics-Feed und optionales Rückschreiben eigener
  Termine in einen Google Kalender. Termine können bezirksweit sein oder einer Sondergruppe zugeordnet
  werden (jedes Mitglied kann einzelne Sondergruppen für sich ausblenden).
- **Meine Feuerwehr** – Startbildschirm nach dem Login: eigener Atemschutz-Status, Fahrzeug-
  Reservierungen (optional mit Freigabe-Workflow per E-Mail) über eine eigene Auswahlseite mit
  Status je Fahrzeug für heute (frei/ab-bis belegt/belegt/außer Dienst) und "Zuletzt verwendet"-
  Schnellzugriff, Tätigkeits-/Übungsbericht (mehrstufiger Assistent, mehrere Fahrzeuge pro Bericht
  mit Mitglieder-Zuordnung je Fahrzeug, PDF- und E-Mail-Versand, Übungsbericht nach der offiziellen
  NÖ-Landesfeuerwehrverband-Papiervorlage), und eine "Zu erledigen"-Liste (offene Termin-
  Rückmeldungen, ablaufende Atemschutz-Fristen, 90-Tage-Regel für Drohnengruppen-Mitglieder,
  Erinnerung an einen ausstehenden Bericht nach einer Fahrzeug-Reservierung).
- **Drohnengruppe** – Flugbuch je Drohnengruppe (Datum/Uhrzeit, Pilot, Ort, Drohne, Zweck), nur
  sichtbar für Mitglieder der jeweiligen Gruppe. Zeigt jedem Mitglied den eigenen Status zur
  90-Tage/3-Flüge-Regel, Admins zusätzlich einen Gruppenüberblick mit Qualifikations-Filter
  (Ausbildungsstufen). Ein QR-Code-Link (nur von Drohnengruppen-Admins in der Verwaltung erzeugbar)
  erlaubt das Registrieren eines Flugs ohne Login. Optional: E-Mail-Benachrichtigung bei neuen
  Flügen.
  **Checkliste Drohnenflug** (Testversion, je Drohnengruppe über einen Funktionsschalter aktivierbar):
  neun Schritte nach dem BOS-Formular vor, während und nach dem Flug mit laufendem
  Zwischenspeichern; in Schritt 7 "Flug starten"/"Flug beenden" (laufende Flüge erscheinen in der
  Übersicht als "Im Flug") und der Tab "Piloten Wechsel" (die Kontrollen Nr. 15–17 werden mit dem
  neuen Piloten wiederholt). Am Ende entsteht ein PDF, das per E-Mail an die Benachrichtigungs-
  adressen der Gruppe geht; beim Registrieren eines Flugs lässt sich eine der letzten Checklisten
  übernehmen.
- **News** – Nachrichten an eine Feuerwehr oder eine Drohnengruppe, sofort, terminiert oder als
  Entwurf; Senden bleibt Admin-Rechten vorbehalten (Feuerwehr-Admin/Drohnengruppen-Admin/
  Bezirksadmin je nach Empfängerkreis), **Lesen ist für jedes Mitglied offen** – auf Mobile wie am
  Desktop. Ein Tippen auf die Push-Benachrichtigung öffnet direkt die vollständige Nachricht statt
  nur den Startbildschirm. Glocken-Icon in der Kopfzeile zeigt sowohl den Ungelesen-Zähler als auch
  grün/rot, ob am aktuellen Gerät Push aktiviert ist; Aktivierung selbst läuft über das Profilmenü. Auf
  iPhone/iPad ist Push nur nutzbar, wenn die App zuvor über "Zum Home-Bildschirm" installiert wurde
  (iOS-Einschränkung, keine App-Beschränkung) – die Nachrichten selbst bleiben aber auch ohne Push
  über `/news` lesbar.
- **Foto-Upload** – kurzlebige Foto-Sammlung je Feuerwehr (z. B. Einsatzfotos): die Fotos gehen direkt
  aus dem Browser in einen S3-Bucket (Exoscale), mit Vorschaubildern, Einzel- und Gesamt-Download
  und optionaler E-Mail-Benachrichtigung. Jeder Foto-Upload wird nach 96 Stunden automatisch gelöscht.
- **Registrierung** (`/registrieren`) – öffentliche Selbstregistrierung neuer Mitglieder; ein Admin der
  Feuerwehr wird per E-Mail benachrichtigt, prüft die Angaben und schaltet das Konto frei.
- **Verwaltung** – je nach Rolle (Bezirksadmin/Abschnittsadmin/Feuerwehr-Admin/Admin Drohnengruppe)
  ein Teil von: Benutzerverwaltung (Suche, sortierbare Spalten, Excel-Export/Import mit allen
  Benutzerfeldern, Passwort-Reset-E-Mail, Willkommen-E-Mail optional abschaltbar), Heimatfeuerwehr
  (Fuhrpark, Atemschutz, Fahrzeug-Reservierungen, Kalender-Import/Google-Rückschreiben,
  Dashboard-Feuerwehrhaus-Token), Drohnengruppe (Drohnen-Liste, QR-Link, Einsatzbereitschaft-Ampel, Ausbildungsstufen-Import,
  Checklisten-Übersicht mit PDF und erneutem Versand),
  E-Mail (Mailjet-Test, Benachrichtigungsadressen), Status (Server/Datenbank/Mailjet/Backup-Check).
- **Dashboard Feuerwehrhaus** – ein öffentlicher, token-authentifizierter Kiosk-Bildschirm für einen
  PC im Feuerwehrhaus: kommende Termine, ausgeborgte Fahrzeuge, die WASTL-Niederösterreich-
  Feuerwehrstatuskarte, ein Facebook-Feed und ein QR-Code zur App.
- **FAQ** (`/how-to.html`) – eine öffentlich erreichbare, statische Hilfeseite (App-Funktionen,
  Installation am Home-Bildschirm, Passwort zurücksetzen), verlinkt aus der Willkommens- und der
  Passwort-Reset-E-Mail – bewusst ohne Login abrufbar, da genau die Nutzer, die sie am meisten
  brauchen (z. B. für "Passwort vergessen"), sich sonst noch nicht anmelden können.
- **Feedback** – jeder Benutzer kann über das Profilmenü eine Sterne-Bewertung + Freitext senden.
- **Native Hüllen (Capacitor)** – `capacitor.config.ts` und `android/` verpacken die gehostete Web-App in
  eine native App (WebView auf die Live-Domain); Push läuft dort über Firebase Cloud Messaging.
- **MCP-Connector für Claude und ChatGPT** – Benutzer mit dem Recht "KI-Zugriff (MCP)" (Lesen/Schreiben, in der Benutzerverwaltung
  vergeben) können Claude oder ChatGPT mit der App verbinden: Abfragen zu Benutzerverwaltung, Drohnengruppe (Flugbuch,
  90-Tage-Regel, Einsatzbereitschaft, abgeschlossene Checklisten), Berichte (Tätigkeits-/Übungsberichte, solange sie noch nicht automatisch gelöscht sind), Kalender und Atemschutzstatus sowie (mit "Schreiben") Neuanlage von Benutzern. Die KI sieht nur,
  was der Benutzer auch in der App sehen darf. Anmeldung per OAuth mit dem normalen App-Login, Verbindungen verwaltet jeder unter
  "Verbundene KI-Apps" im Profil; ein-/ausgeschaltet (standardmäßig aus) vom Bezirksadmin unter Verwaltung → KI-Zugriff. Prüfprotokoll für
  Schreibaktionen und abgelehnte Zugriffe. Als Connector-URL wird `https://<Domain>/api/mcp` eingetragen (genau die `AUTH_URL` der App,
  ohne Schrägstrich am Ende). Technik: [src/lib/mcp/CLAUDE.md](src/lib/mcp/CLAUDE.md), Einführung: [docker/README.md](docker/README.md).

## Tech-Stack

Next.js (App Router, TypeScript) · PostgreSQL + Prisma · Auth.js v5 (Passwort oder E-Mail-Token) ·
Tailwind CSS + shadcn/ui (Radix) in der Verwaltung · Mailjet (Transaktions-E-Mails) · Web Push/VAPID und
Firebase Cloud Messaging (News-Modul) · exceljs (Excel-Export/Import) · ical-generator/node-ical
(Kalender .ics Export/Import) · google-auth-library (Google-Kalender-Rückschreiben) ·
qrcode/sharp (Dashboard Feuerwehrhaus, Foto-Vorschauen) · @react-pdf/renderer (Berichts- und
Checklisten-PDFs) · @modelcontextprotocol/sdk (MCP-Endpunkt) · @aws-sdk/client-s3 (Exoscale SOS: Foto-Uploads, Berichts-/Checklisten-PDFs,
Backup-Status-Check) · Capacitor (native Hülle) · vitest (Tests)

## Lokale Entwicklung

Voraussetzung: Node.js 20+ und Docker (für die lokale Postgres-Datenbank).

```bash
cp .env.example .env
docker compose -f docker-compose.dev.yml up -d
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Login unter [http://localhost:3000](http://localhost:3000) mit den in `.env` konfigurierten
`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`.

> **Git-Worktree-Hinweis:** in einer Umgebung mit mehreren Git-Worktrees desselben Repos (mehrere
> Checkouts nebeneinander, z. B. Haupt-Checkout + `.claude/worktrees/...`) kann `next dev` beim
> Start eine Warnung "inferred your workspace root" ausgeben und dabei fälschlich das Root eines
> *anderen* Checkouts wählen (Next erkennt mehrere `package-lock.json`-Dateien und pickt eine davon
> als Basis) – der Server läuft dann scheinbar normal, serviert aber den Code eines anderen
> Checkouts. Prüfen mit `Get-CimInstance Win32_Process -Filter "ProcessId=<PID>"` (PID über
> `netstat -ano | findstr :3000`) – die `CommandLine` muss auf das eigene Worktree-Verzeichnis
> zeigen, sonst `npm run dev` im richtigen Verzeichnis neu starten.

## Tests

```bash
npm test          # Unit-Tests (vitest, ohne Datenbank)
npm run test:db   # Integrationstests gegen die LOKALE Dev-Datenbank (räumen ihre Testdaten selbst auf)
npx tsc --noEmit  # Typprüfung
```

Die Datenbank-Tests nutzen die `DATABASE_URL` aus `.env` und haben keinen eingebauten Schutz: nur mit der lokalen
Entwicklungsdatenbank ausführen, nie mit einer Dev- oder Produktions-URL. ESLint ist
nicht eingerichtet (`npm run lint` startet nur die Next.js-Einrichtung); Typprüfung und `npm run build`
ersetzen es.

## Deployment

Siehe [docker/README.md](docker/README.md) für das Produktions-Setup (Hetzner Ubuntu Server, Docker
Compose, Caddy, Backups inkl. Off-Box-Kopie nach Exoscale SOS mit 30 Tagen Aufbewahrung, VAPID-Schlüssel,
Cronjobs für terminierte News/Kalender-Import/Atemschutz-Warnung/System-Check/Facebook-Feed/
Foto-Aufräumung/Berichts-Aufbewahrung/MCP-Aufräumen).

## Bezirk 17 St. Pölten

7 Abschnitte (Herzogenburg, Kirchberg/Pielach, Neulengbach, Purkersdorf, St. Pölten-West,
St. Pölten-Stadt, St. Pölten-Ost), 124 Feuerwehren/Betriebsfeuerwehren, 4 Drohnengruppen, jede an
einem Abschnitt verankert. Seed-Daten: [prisma/seed.ts](prisma/seed.ts) und
[prisma/data/feuerwehren-bezirk-17-raw.json](prisma/data/feuerwehren-bezirk-17-raw.json).
