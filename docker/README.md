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

`docker/backup.sh` lädt zusätzlich zum frischen `pg_dump` auch `.env` und `docker/Caddyfile` zu
einem S3-kompatiblen Bucket hoch (als `config-<timestamp>.tar.gz`, `chmod 600` wegen der
Klartext-Secrets in `.env`, lokal nur für die Dauer des Uploads vorhanden), sobald
`S3_BACKUP_BUCKET` in `.env` gesetzt ist — ist die Variable leer/nicht gesetzt, macht das Skript
unverändert nur das lokale DB-Backup wie bisher. Beide Dateien existieren nur auf diesem einen
Server (`.env` ist `.gitignore`t, die echte Domain in `Caddyfile` wurde nie committet) und sind für
einen Restore auf einem neuen Server genauso wichtig wie die Datenbank selbst — ohne sie insbesondere
kein Zugriff auf `VAPID_PRIVATE_KEY`, ohne den alle bestehenden Push-Abos aus dem DB-Restore
permanent nutzlos wären (jedes der ~200 Mitglieder müsste Push-Benachrichtigungen neu aktivieren).
In `.env` ergänzen:

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

Aufbewahrung/Löschung alter Backups im Bucket läuft direkt in `backup.sh` selbst (30 Tage, analog
zur lokalen `find -mtime +30`-Zeile) — **nicht** über eine Bucket-Lifecycle-Regel: Exoscale SOS
unterstützt (Stand jetzt) keine native Lifecycle-Policy, siehe
[community.exoscale.com/.../bucketlifecycle](https://community.exoscale.com/product/storage/object-storage/how-to/bucketlifecycle/).
Ein `PutBucketLifecycleConfiguration`-Aufruf wird von Exoscale je nach Rule-Inhalt entweder
stillschweigend ignoriert oder mit `MalformedXML` abgelehnt (beides getestet). Exoscales eigener
Workaround dafür ist ein separater, täglich laufender Docker-Container, der zusätzlich aktiviertes
Bucket-Versioning voraussetzt — für die paar kleinen Backup-Dateien hier unverhältnismäßig viel
zusätzliche Infrastruktur, daher die einfachere Inline-Löschung im ohnehin schon vorhandenen Skript.

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

## Täglicher Systemcheck per E-Mail

`docker/system-check-email.sh` ruft `/api/cron/system-check` auf, das denselben Check wie der
"System Check"-Button auf `/admin/status` ausführt (Server/Docker/Mailjet/Cron/NTP/Backup/S3-Verbindung/
S3-Backup) und das
Ergebnis als Tabelle an die unter Verwaltung → E-Mail → "System Check E-Mail" hinterlegte Adresse
mailt (analog zur "Drohnenflug E-Mail" — ohne hinterlegte Adresse wird keine E-Mail versendet, siehe
`notifySystemCheckResult` in `src/lib/system/notify-system-check.ts`). Täglich um 09:00
österreichischer Zeit einrichten:

```bash
crontab -e
# Daily at 09:00 Vienna time (CRON_TZ wird von Debian/Ubuntus cron seit ~2019 unterstützt und
# berücksichtigt automatisch die Sommerzeit-Umstellung, anders als ein fixer UTC-Offset)
CRON_TZ=Europe/Vienna
0 9 * * * /opt/app-177/docker/system-check-email.sh >> /var/log/ffapp-system-check.log 2>&1
```

Falls `CRON_TZ` auf dem jeweiligen System nicht greift (mit `date` bzw. am tatsächlichen
Zustellzeitpunkt der ersten Test-Mail prüfen), stattdessen die Stunde direkt auf die
Host-Systemzeit umrechnen (`timedatectl` zeigt die aktuell konfigurierte Host-Zeitzone).

## Tägliche Atemschutz-Fristen-Warnung per E-Mail

`docker/atemschutz-warnung-email.sh` ruft `/api/cron/atemschutz-warnung` auf, das prüft, ob bei
Atemschutzgeräteträgern einer Feuerwehr die Untersuchungs- oder Finnentest-Gültigkeit innerhalb der
nächsten 30 Tage abläuft, und - falls ja - eine Sammel-E-Mail an die unter Verwaltung →
Heimatfeuerwehr je Feuerwehr hinterlegte Adresse "Sachbearbeiter Atemschutz" schickt (siehe
`checkAndNotifyAtemschutzWarnungen` in `src/lib/heimatfeuerwehr/notify-atemschutz-warnung.ts`) -
anders als die übrigen Cron-E-Mails hier **pro Feuerwehr**, nicht eine einzige globale Adresse.
Ohne hinterlegte Adresse oder ohne bald ablaufende Fristen wird für diese Feuerwehr keine E-Mail
versendet. Täglich um 08:00 österreichischer Zeit einrichten:

```bash
crontab -e
CRON_TZ=Europe/Vienna
0 8 * * * /opt/app-177/docker/atemschutz-warnung-email.sh >> /var/log/ffapp-atemschutz-warnung.log 2>&1
```

## Restore-Test

DB-Restore (auf einem bereits laufenden Stack mit leerer/vorhandener DB):

```bash
gunzip -c docker/backups/db-2026-01-01_0300.sql.gz | docker compose -f docker/docker-compose.yml --env-file .env exec -T postgres psql -U ffapp -d ffapp
```

Voller Restore auf einem **neuen** Server (die DB allein reicht dafür nicht — siehe oben, `.env` und
`Caddyfile` sind genauso nötig): Repo klonen, dann `config-<timestamp>.tar.gz` vom S3-Bucket laden
und entpacken, bevor der Stack das erste Mal gestartet wird:

```bash
aws s3 cp s3://app-177-backup/config-2026-01-01_0300.tar.gz . --endpoint-url https://sos-at-vie-1.exo.io
tar -xzf config-2026-01-01_0300.tar.gz
```

Das legt `.env` und `docker/Caddyfile` an der richtigen Stelle im frisch geklonten Repo ab. Danach
wie im Setup oben `docker compose ... up -d --build`, Seed **weglassen** (die Datenbank wird stattdessen
aus dem DB-Backup wiederhergestellt, nicht neu geseedet), und den DB-Restore-Befehl von oben ausführen.

## Stündlicher Facebook-Feed-Abruf für Dashboard Feuerwehrhaus

`docker/facebook-fetch.sh` ruft `/api/cron/facebook-fetch` auf, das die neuesten Einträge des
Facebook-Feeds für das öffentliche Dashboard Feuerwehrhaus abruft (Issue #8). Stündlich ausführen:

```bash
crontab -e
CRON_TZ=Europe/Vienna
0 * * * * /opt/app-177/docker/facebook-fetch.sh >> /var/log/ffapp-facebook-fetch.log 2>&1
```

## ICS-Kalenderimport (alle 5 Minuten)

`docker/kalender-ics-sync.sh` ruft `/api/cron/kalender-ics-sync` auf, das für jede Feuerwehr mit
gesetzter `Organization.icsImportUrl` (Verwaltung → Heimatfeuerwehr → "Kalender-Import (ICS)")
externe Kalendertermine (z. B. ein per Google Kalender freigegebener .ics-Link) in ihren Kalender
importiert - neue Termine anlegen, geänderte aktualisieren, aus der Quelle entfernte löschen. Alle
5 Minuten ausführen:

```bash
crontab -e
CRON_TZ=Europe/Vienna
*/5 * * * * /opt/app-177/docker/kalender-ics-sync.sh >> /var/log/ffapp-kalender-ics-sync.log 2>&1
```

## Dashboard Feuerwehrhaus (Kiosk-Screen)

Der öffentliche Kiosk-Screen (`/dashboard/[token]`, Issue #8) läuft auf einem gewöhnlichen Windows-PC im
Feuerwehrhaus, Chrome im Vollbild. Den Link/QR-Code erzeugt ein Feuerwehr-Admin unter Verwaltung →
Heimatfeuerwehr → "Dashboard Feuerwehrhaus".

Empfohlener Chrome-Start (Verknüpfung im Autostart-Ordner):

```
chrome.exe --kiosk --noerrdialogs --disable-session-crashed-bubble "https://<domain>/dashboard/<token>"
```

Die Seite lädt sich selbst alle 5 Minuten neu (`<meta http-equiv="refresh">`) - kein zusätzlicher
Neustart-Mechanismus nötig. Kein Zoom/Skalierung erforderlich, das Layout passt sich der tatsächlichen
Displayauflösung automatisch an.
