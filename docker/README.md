# Deployment (Hetzner Ubuntu Server)

## Voraussetzungen auf dem Server

- Docker Engine + Docker Compose Plugin installiert (`curl -fsSL https://get.docker.com | sh`)
- DNS-Eintrag der Domain zeigt bereits auf die Server-IP (Caddy braucht das für das TLS-Zertifikat)
- Ports 80/443 offen (Hetzner-Firewall + `ufw` falls aktiv)

## Setup

1. Repo auf den Server klonen, z. B. nach `/opt/ffapp`.
2. `.env` im Repo-Root anlegen (Vorlage: [.env.example](../.env.example)). Wichtig für Produktion:
   - `DATABASE_URL` muss den Docker-Compose-Servicenamen `postgres` als Host verwenden, **nicht** `localhost`:
     `postgresql://ffapp:<PASSWORT>@postgres:5432/ffapp?schema=public`
   - `AUTH_URL` auf die echte Domain setzen (z. B. `https://termine.abschnitt-purkersdorf.at`)
   - `AUTH_SECRET` mit `openssl rand -base64 32` erzeugen
   - `ABSCHNITTS_ICS_TOKEN` mit `openssl rand -hex 16` erzeugen
   - `MAILJET_API_KEY` / `MAILJET_API_SECRET` aus [app.mailjet.com/account/apikeys](https://app.mailjet.com/account/apikeys)
   - `MAILJET_FROM_EMAIL` muss eine bei Mailjet validierte Absender-Domain/-Adresse sein, sonst schlägt der Versand fehl
   - `CRON_SECRET` mit `openssl rand -hex 16` erzeugen (schützt den News-Versand-Cronjob, siehe unten)
3. [docker/Caddyfile](Caddyfile): Platzhalter-Domain durch die echte Domain ersetzen.
4. Stack bauen und starten:
   ```bash
   docker compose -f docker/docker-compose.yml --env-file .env up -d --build
   ```
   Der `app`-Container führt beim Start automatisch `prisma migrate deploy` aus (siehe [entrypoint.sh](entrypoint.sh)).
5. Erstes Seed ausführen (legt die 9 Feuerwehren, das Abschnittskommando, die Drohnen-Lookup-Einträge und den Bootstrap-Admin an). `tsx` direkt aufrufen statt `prisma db seed` zu verwenden, da dessen `package.json#prisma.seed`-Konfiguration im Runner-Image (vom Next-Standalone-Build generiertes `package.json`) nicht zuverlässig übernommen wird:
   ```bash
   docker compose -f docker/docker-compose.yml --env-file .env exec app node node_modules/tsx/dist/cli.mjs prisma/seed.ts
   ```
6. VAPID-Schlüsselpaar für das News-Modul (Web-Push) erzeugen, `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` in `.env` eintragen und den Stack einmal neu starten:
   ```bash
   docker compose -f docker/docker-compose.yml --env-file .env exec app node -e "console.log(require('web-push').generateVAPIDKeys())"
   docker compose -f docker/docker-compose.yml --env-file .env up -d app
   ```
7. Bootstrap-Login mit `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` aus der `.env` testen, danach Passwort in der Benutzerverwaltung ändern.

## Migrationen bei späteren Deploys

`git pull` + erneut `docker compose -f docker/docker-compose.yml --env-file .env up -d --build` — Migrationen laufen automatisch im Entrypoint, bevor der Server startet.

## Backups

`docker/backup.sh` per Cron einrichten (siehe Kommentar im Skript):

```bash
crontab -e
# Nightly at 03:00
0 3 * * * /opt/ffapp/docker/backup.sh >> /var/log/ffapp-backup.log 2>&1
```

Backups landen (gzip) in `docker/backups/`, 30 Tage Aufbewahrung. Empfehlung: zusätzlich regelmäßig off-box sichern (z. B. `rsync` auf eine Hetzner Storage Box).

## News-Modul: terminierte Push-Nachrichten versenden

Sofort-Versand passiert direkt in der Server Action beim Erstellen einer News. Für **terminierte**
News braucht es zusätzlich einen Cronjob, der `docker/send-scheduled-news.sh` regelmäßig aufruft
(das Skript ruft `/api/cron/send-scheduled-news` mit dem `CRON_SECRET` aus `.env` auf):

```bash
chmod +x docker/send-scheduled-news.sh
crontab -e
# Every 5 minutes
*/5 * * * * /opt/ffapp/docker/send-scheduled-news.sh >> /var/log/ffapp-news.log 2>&1
```

Ohne diesen Cronjob werden nur sofort gesendete News tatsächlich zugestellt; terminierte News
bleiben in der Datenbank auf "Ausstehend" stehen.

## Restore-Test

```bash
gunzip -c docker/backups/db-2026-01-01_0300.sql.gz | docker compose -f docker/docker-compose.yml --env-file .env exec -T postgres psql -U ffapp -d ffapp
```
