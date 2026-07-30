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
0 3 * * * /opt/app-177/docker/backup.sh >> /var/log/ffapp-backup.log 2>&1
```

Backups landen (gzip) in `docker/backups/`, 30 Tage Aufbewahrung. `backup.sh` und
`send-scheduled-news.sh` sind im Repo als ausführbar (`chmod +x`) getrackt — nach einem frischen
`git clone` sollte kein manuelles `chmod +x` mehr nötig sein; falls doch (z. B. nach einem
Checkout-Tool, das den Modus nicht überträgt), gibt cron sonst stillschweigend `Permission denied`
in `/var/log/ffapp-backup.log` aus, ohne dass irgendwo sonst ein Fehler auftaucht.

### Off-Box-Kopie auf S3-kompatiblen Object Storage (z. B. Exoscale SOS)

`docker/backup.sh` lädt den frischen Dump zusätzlich zu einem S3-kompatiblen Bucket hoch, sobald
`S3_BACKUP_BUCKET` in `.env` gesetzt ist — ist die Variable leer/nicht gesetzt, macht das Skript
unverändert nur das lokale Backup wie bisher. In `.env` ergänzen:

```
S3_BACKUP_BUCKET=app-177-backup
S3_ENDPOINT_URL=https://sos-at-vie-1.exo.io
S3_ACCESS_KEY=<Access Key aus dem Exoscale-Portal>
S3_SECRET_KEY=<Secret Key aus dem Exoscale-Portal>
```

Voraussetzung ist die AWS CLI auf dem Host (Exoscale SOS ist S3-kompatibel, daher genügt ein
generischer S3-Client mit `--endpoint-url`, keine Exoscale-spezifische Tooling-Abhängigkeit):

```bash
apt-get update && apt-get install -y awscli
```

Aufbewahrung/Löschung alter Backups im Bucket läuft bewusst **nicht** über das Skript, sondern über
eine Lifecycle-Regel im Exoscale-Portal (Bucket → Lifecycle Rules, z. B. "nach 30 Tagen löschen") —
das erspart eine zweite Löschlogik gegen eine zweite Storage-API im Skript, die sonst parallel zur
lokalen 30-Tage-`find`-Löschung gepflegt werden müsste.

## News-Modul: terminierte Push-Nachrichten versenden

Sofort-Versand passiert direkt in der Server Action beim Erstellen einer News. Für **terminierte**
News braucht es zusätzlich einen Cronjob, der `docker/send-scheduled-news.sh` regelmäßig aufruft
(das Skript ruft `/api/cron/send-scheduled-news` mit dem `CRON_SECRET` aus `.env` auf):

```bash
crontab -e
# Every 5 minutes
*/5 * * * * /opt/app-177/docker/send-scheduled-news.sh >> /var/log/ffapp-news.log 2>&1
```

Ohne diesen Cronjob werden nur sofort gesendete News tatsächlich zugestellt; terminierte News
bleiben in der Datenbank auf "Ausstehend" stehen.

## Restore-Test

```bash
gunzip -c docker/backups/db-2026-01-01_0300.sql.gz | docker compose -f docker/docker-compose.yml --env-file .env exec -T postgres psql -U ffapp -d ffapp
```
