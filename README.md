# Feuerwehr-App AFKDO Purkersdorf

Web-App für die 9 Feuerwehren und das Abschnittsfeuerwehrkommando des Abschnitts Purkersdorf. Installierbar
als PWA (Icon am Homescreen, iOS/Android) – kein App-Store-Build nötig.

## Module

- **Kalender** – eigener Kalender pro Feuerwehr + Abschnitt-weiter Kalender, Kalender- oder Listenansicht
  (Listenansicht ist Standard), .ics-Export/Abo für Outlook/Google/Apple Kalender.
- **Drohnengruppe** – Flugbuch (Datum/Uhrzeit, Pilot, Ort, Drohne, Zweck), nur sichtbar für Mitglieder der
  Drohnengruppe. Zeigt jedem Mitglied den eigenen Status zur 90-Tage/3-Flüge-Regel; ein QR-Code-Link erlaubt
  das Registrieren eines Flugs ohne Login. Optional: E-Mail-Benachrichtigung bei neuen Flügen.
- **Verwaltung** (nur Abschnittskommando-Admin) – Benutzerverwaltung (Suche, sortierbare Spalten,
  Passwort-Reset-E-Mail), Drohnengruppe (Drohnen-Liste, QR-Link), E-Mail (Mailjet-Test, Benachrichtigungsadresse),
  Status (Server/Datenbank/Mailjet-Check).
- **Feedback** – jeder Benutzer kann über das Profilmenü eine Sterne-Bewertung + Freitext senden.

## Tech-Stack

Next.js (App Router, TypeScript) · PostgreSQL + Prisma · Auth.js (E-Mail/Passwort) · Tailwind CSS · Mailjet
(Transaktions-E-Mails)

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

Login unter [http://localhost:3000](http://localhost:3000) mit den in `.env` konfigurierten `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`.

## Deployment

Siehe [docker/README.md](docker/README.md) für das Produktions-Setup (Hetzner Ubuntu Server, Docker Compose, Caddy, Backups).

## Feuerwehren im Abschnitt

Wolfsgraben, Pressbaum, Purkersdorf, Gablitz, Tullnerbach, Tullnerbach-Irenental, Steinbach, Mauerbach, Rekawinkel + Abschnittsfeuerwehrkommando (AFKDO) Purkersdorf. Siehe [prisma/seed.ts](prisma/seed.ts).
