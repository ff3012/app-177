# Feuerwehr-App Bezirk 17 St. Pölten

Web-App für den Bezirk 17 St. Pölten (Niederösterreich): 7 Abschnitte, 124 Feuerwehren/
Betriebsfeuerwehren, 4 Drohnengruppen. Installierbar als PWA (Icon am Homescreen, iOS/Android) –
kein App-Store-Build nötig.

> Die App wurde ursprünglich für einen einzelnen Abschnitt gebaut (Abschnitt Purkersdorf,
> 9 Feuerwehren, ~200 Benutzer) und danach auf den gesamten Bezirk erweitert. Branding (Logo,
> Login-Seite, PWA-Manifest, Absenderadresse) ist an einigen Stellen noch Purkersdorf-spezifisch –
> ein bekannter, bewusst aufgeschobener Nachzieher, kein Zeichen dafür, dass die App noch
> single-Abschnitt wäre. Details zur Bezirk/Abschnitt/Feuerwehr-Hierarchie und dem
> Berechtigungsmodell stehen in [CLAUDE.md](CLAUDE.md).

## Module

- **Kalender** – eigener Kalender pro Feuerwehr + Abschnitt-weiter Kalender, Kalender- oder
  Listenansicht (Listenansicht ist Standard), .ics-Export/Abo für Outlook/Google/Apple Kalender,
  optionaler read-only Import aus einem externen .ics-Feed und optionales Rückschreiben eigener
  Termine in einen Google Kalender.
- **Meine Feuerwehr** – Startbildschirm nach dem Login: eigener Atemschutz-Status, Fuhrpark der
  eigenen Feuerwehr mit Fahrzeug-Reservierungen (optional mit Freigabe-Workflow per E-Mail), und
  eine "Zu erledigen"-Liste (offene Termin-Rückmeldungen, ablaufende Atemschutz-Fristen, 90-Tage-
  Regel für Drohnengruppen-Mitglieder).
- **Drohnengruppe** – Flugbuch je Drohnengruppe (Datum/Uhrzeit, Pilot, Ort, Drohne, Zweck), nur
  sichtbar für Mitglieder der jeweiligen Gruppe. Zeigt jedem Mitglied den eigenen Status zur
  90-Tage/3-Flüge-Regel, Admins zusätzlich einen Gruppenüberblick mit Qualifikations-Filter
  (Ausbildungsstufen). Ein QR-Code-Link (nur von Drohnengruppen-Admins in der Verwaltung erzeugbar)
  erlaubt das Registrieren eines Flugs ohne Login. Optional: E-Mail-Benachrichtigung bei neuen
  Flügen.
- **News** – Push-Benachrichtigung an eine Feuerwehr oder eine Drohnengruppe, sofort oder
  terminiert. Glocken-Icon in der Kopfzeile zeigt grün/rot, ob am aktuellen Gerät Push aktiviert
  ist; Aktivierung selbst läuft über das Profilmenü. Auf iPhone/iPad nur nutzbar, wenn die App zuvor
  über "Zum Home-Bildschirm" installiert wurde (iOS-Einschränkung, keine App-Beschränkung).
- **Verwaltung** – je nach Rolle (Bezirksadmin/Abschnittsadmin/Feuerwehr-Admin/Admin Drohnengruppe)
  ein Teil von: Benutzerverwaltung (Suche, sortierbare Spalten, Excel-Export/Import mit allen
  Benutzerfeldern, Passwort-Reset-E-Mail, Willkommen-E-Mail optional abschaltbar), Heimatfeuerwehr
  (Fuhrpark, Atemschutz, Fahrzeug-Reservierungen, Kalender-Import/Google-Rückschreiben,
  Dashboard-Feuerwehrhaus-Token), Drohnengruppe (Drohnen-Liste, QR-Link, Einsatzbereitschaft-Ampel),
  E-Mail (Mailjet-Test, Benachrichtigungsadressen), Status (Server/Datenbank/Mailjet/Backup-Check).
- **Dashboard Feuerwehrhaus** – ein öffentlicher, token-authentifizierter Kiosk-Bildschirm für einen
  PC im Feuerwehrhaus: kommende Termine, ausgeborgte Fahrzeuge, die WASTL-Niederösterreich-
  Feuerwehrstatuskarte, ein Facebook-Feed und ein QR-Code zur App.
- **FAQ** (`/how-to.html`) – eine öffentlich erreichbare, statische Hilfeseite (App-Funktionen,
  Installation am Home-Bildschirm, Passwort zurücksetzen), verlinkt aus der Willkommens- und der
  Passwort-Reset-E-Mail – bewusst ohne Login abrufbar, da genau die Nutzer, die sie am meisten
  brauchen (z. B. für "Passwort vergessen"), sich sonst noch nicht anmelden können.
- **Feedback** – jeder Benutzer kann über das Profilmenü eine Sterne-Bewertung + Freitext senden.

## Tech-Stack

Next.js (App Router, TypeScript) · PostgreSQL + Prisma · Auth.js v5 (Passwort oder E-Mail-Token) ·
Tailwind CSS · Mailjet (Transaktions-E-Mails) · Web Push/VAPID (News-Modul) · exceljs
(Excel-Export/Import) · ical-generator/node-ical (Kalender .ics Export/Import) ·
google-auth-library (Google-Kalender-Rückschreiben) · qrcode/sharp (Dashboard Feuerwehrhaus) ·
@aws-sdk/client-s3 (Backup-Status-Check gegen Exoscale SOS)

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

## Deployment

Siehe [docker/README.md](docker/README.md) für das Produktions-Setup (Hetzner Ubuntu Server, Docker
Compose, Caddy, Backups inkl. Off-Box-Kopie nach Exoscale SOS, VAPID-Schlüssel, Cronjobs für
terminierte News/Kalender-Import/Atemschutz-Warnung/System-Check/Facebook-Feed).

## Bezirk 17 St. Pölten

7 Abschnitte (Herzogenburg, Kirchberg/Pielach, Neulengbach, Purkersdorf, St. Pölten-West,
St. Pölten-Stadt, St. Pölten-Ost), 124 Feuerwehren/Betriebsfeuerwehren, 4 Drohnengruppen, jede an
einem Abschnitt verankert. Seed-Daten: [prisma/seed.ts](prisma/seed.ts) und
[prisma/data/feuerwehren-bezirk-17-raw.json](prisma/data/feuerwehren-bezirk-17-raw.json).
