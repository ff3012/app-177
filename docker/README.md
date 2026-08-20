# Deployment (Hetzner Ubuntu Server)

> **Domain-Umzug Produktion (2026-08-20):** die kanonische Produktions-Domain ist jetzt
> `app-17.bfkdo-stpoelten.at` (Bezirk-17-Branding), nicht mehr `app-177.ff-wolfsgraben.at` -
> `AUTH_URL` in der echten `/opt/app-177/.env` wurde entsprechend aktualisiert. Anders als beim
> Dev-Umzug einen Tag zuvor **kein kompletter Cutover**: die alte Domain bleibt bewusst "parallel
> für die Migrationszeit" erreichbar, aber nur noch als permanenter (301) Redirect auf die neue
> Domain in der echten Caddyfile (`app-177.ff-wolfsgraben.at { redir https://app-17.bfkdo-stpoelten.at{uri} permanent }`),
> nicht mehr als eigener `reverse_proxy`-Block. Wer noch eine aktive Session auf der alten Domain
> hatte, landet nach dem Redirect ausgeloggt auf der neuen Domain - `__Host-`-Cookies sind strikt an
> die exakte Origin gebunden, die sie gesetzt hat, das ist bei jedem Domain-Wechsel unvermeidbar,
> kein Bug. S3-Bucket-CORS (`app-177-pictures`) und der `qr-code.ts`-Fallback wurden ebenfalls auf
> die neue Domain aktualisiert; die alte Domain bleibt zusätzlich in `AllowedOrigins`, solange der
> Redirect noch aktiv ist. Denselben Docker-Bind-Mount-Stolperstein wie beim Dev-Umzug beachten: eine
> Caddyfile-Änderung wirkt erst nach `docker compose ... up -d --force-recreate caddy`, ein reines
> `caddy reload` reicht nicht (siehe die zugehörige Projekt-Memory-Notiz zu diesem genauen Bug).

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

### Einmaliger manueller Schritt für dieses Deploy: zwei umbenannte Migrationsordner

Bei der Umsetzung von Bezirksverwaltung wurde ein echter, vorbestehender Fehler in der bereits committeten
Migrations-Historie gefunden und behoben: `20260804090000_vehicle_booking_details` und
`20260804110000_vehicle_booking_approval` änderten die Tabelle `VehicleBooking`, bevor
`20260811090000_meine_feuerwehr` sie überhaupt anlegt — bei einer frischen Datenbank (neuer Server, CI,
frischer Klon) würde `prisma migrate deploy` deshalb mit einem Fehler abbrechen ("the underlying table for
model VehicleBooking does not exist"). Behoben durch Umbenennen der beiden Ordner auf
`20260811091000_vehicle_booking_details`/`20260811092000_vehicle_booking_approval` (sortieren jetzt korrekt
nach `meine_feuerwehr`).

**Auf der Produktionsdatenbank sind diese beiden Migrationen bereits unter den ALTEN Namen angewendet und
in `_prisma_migrations` entsprechend vermerkt.** Ohne Anpassung dieser Tabelle würde `prisma migrate deploy`
beim nächsten Deploy die beiden umbenannten Migrationen für "neu, noch nicht angewendet" halten und erneut
auszuführen versuchen — das schlägt fehl (Spalten/Constraints existieren bereits) und blockiert den
gesamten Deploy. **Vor dem ersten Deploy, das diesen Commit enthält**, folgendes einmalig gegen die
Produktionsdatenbank ausführen (z. B. `docker compose -f docker/docker-compose.yml --env-file .env exec
postgres psql -U ffapp -d ffapp`):

```sql
UPDATE "_prisma_migrations" SET migration_name = '20260811091000_vehicle_booking_details' WHERE migration_name = '20260804090000_vehicle_booking_details';
UPDATE "_prisma_migrations" SET migration_name = '20260811092000_vehicle_booking_approval' WHERE migration_name = '20260804110000_vehicle_booking_approval';
```

Danach `docker compose -f docker/docker-compose.yml --env-file .env exec app npx prisma migrate status`
zur Kontrolle ausführen — Erwartung: "Database schema is up to date!". Dieser Schritt ist nur EINMALIG
nötig, für genau dieses eine Deploy; danach ist die Historie dauerhaft korrekt.

**Zweiter, separater Befund (noch nicht behoben, eigener Vorgang):** `prisma migrate status` meldet
außerdem, dass `20260809010000_hierarchie_backfill` nach dem Anwenden nachträglich verändert wurde
(Checksumme in `_prisma_migrations` passt nicht mehr zum aktuellen Dateiinhalt - die Datei wurde nach dem
ersten Anwenden mehrfach für echte Bugfixes bearbeitet, siehe `git log` dieser Datei). Betrifft vermutlich
auch die Produktionsdatenbank. Muss separat untersucht/behoben werden, bevor eine weitere
`prisma migrate dev`/`deploy`-Ausführung dagegen verlässlich funktioniert.

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

### Facebook Page-ID + langlebiges Access Token beschaffen

Damit `fetchAndCacheFacebookPosts()` (`src/lib/facebook/fetch-posts.ts`) etwas abrufen kann, braucht jede
Feuerwehr unter Verwaltung → Heimatfeuerwehr → "Dashboard Feuerwehrhaus" ihre `facebookPageId` und ein
`facebookPageAccessToken`. Voraussetzung: eine Facebook-App unter developers.facebook.com (Entwicklungsmodus
reicht, keine App-Überprüfung nötig, solange der eigene Facebook-Account Admin der Seite ist) und
Anwendungsfall "Ich verwalte alles auf meiner Seite" bzw. "Sonstiges".

1. **Kurzlebiges Token holen** — [Graph API Explorer](https://developers.facebook.com/tools/explorer/)
   öffnen, oben rechts die eigene App auswählen, bei "User or Page" die Feuerwehr-Seite wählen,
   Berechtigungen `pages_read_engagement` + `pages_show_list` hinzufügen, "Generate Access Token" klicken
   und das Facebook-Login-Popup bestätigen. Das Token ist nur ~1–2 Stunden gültig.
2. **App-ID/App-Secret notieren** — App-Dashboard → Einstellungen → "Basic". App-Secret erst nach
   Passwort-Bestätigung sichtbar.
3. **Gegen langlebiges User-Token tauschen** (~60 Tage gültig):
   ```
   https://graph.facebook.com/v26.0/oauth/access_token?grant_type=fb_exchange_token&client_id=APP_ID&client_secret=APP_SECRET&fb_exchange_token=KURZLEBIGES_TOKEN
   ```
   Die Antwort enthält ein `access_token` — das ist erst das langlebige **User**-Token, noch nicht das
   Page-Token.
4. **Langlebiges Page-Token ableiten** (läuft praktisch nicht mehr ab, solange die App bestehen bleibt, der
   Account Admin der Seite bleibt und das Passwort nicht geändert wird):
   ```
   https://graph.facebook.com/v26.0/me/accounts?access_token=LANGLEBIGES_USER_TOKEN
   ```
   Die Antwort ist normalerweise eine Liste aller verwalteten Seiten, je mit `id` (= Page-ID) und
   `access_token` (= das gesuchte Page-Token). Die `id` hier gegen die tatsächliche Page-ID abgleichen, bevor
   sie eingetragen wird — Facebook-Page-IDs sind rein numerisch (z. B. `61234567890123`); ein alphanumerischer
   Wert ist meist eine andere Art ID (z. B. eine Asset-/App-scoped-ID) und wird von `/​{page-id}/posts` nicht
   akzeptiert.
   - **Falls `me/accounts` `{"data": []}` liefert, obwohl der Access Token Debugger für das langlebige
     User-Token unter "Granulare Bereiche" bereits `pages_show_list`/`pages_read_engagement` korrekt für
     genau diese Page-ID zeigt** (live durchgespielt, kein theoretisches Problem): die Seite läuft dann auf
     Facebooks "New Pages Experience", bei der `me/accounts` das Page-Token nicht mehr zuverlässig liefert.
     Stattdessen das Token direkt vom Seiten-Objekt selbst anfordern:
     ```
     https://graph.facebook.com/v26.0/{page-id}?fields=access_token&access_token=LANGLEBIGES_USER_TOKEN
     ```
     Antwort: `{"access_token": "...", "id": "{page-id}"}` — das ist das gesuchte Page-Token. Mit einem
     einfachen User-Token direkt `/{page-id}/posts` aufzurufen funktioniert bei diesen Seiten NICHT
     (Fehler `code 190`, `error_subcode 2069032`, "Für diesen Aufruf ist ein Seiten-Zugriffstoken für die
     neue Seitenversion erforderlich.") — es muss wirklich dieses abgeleitete Page-Token sein.
5. **Eintragen**: Page-ID → "Facebook Page-ID", zugehöriges `access_token` (aus Schritt 4, regulär oder über
   den New-Pages-Experience-Weg) → "Page Access Token".
6. **Optional prüfen** (zeigt u. a. `expires_at`; `0` = läuft nicht ab):
   ```
   https://graph.facebook.com/debug_token?input_token=TOKEN&access_token=APP_ID|APP_SECRET
   ```
7. **Vor dem Eintragen den eigentlichen Anwendungsfall testen** (genau der Aufruf, den
   `fetchAndCacheFacebookPosts()` später macht):
   ```
   https://graph.facebook.com/v26.0/{page-id}/posts?fields=message,created_time,permalink_url,full_picture&access_token=PAGE_ACCESS_TOKEN
   ```
   Kommen hier echte Beiträge zurück, ist das Token verifiziert richtig.

Kein automatischer Refresh vorgesehen — läuft das Token doch irgendwann ab (z. B. nach einem
Facebook-Passwortwechsel), zeigt das Dashboard einfach wieder "Facebook nicht verbunden"; Schritte 1–5
dann erneut durchführen.

**App-Berechtigung fehlt trotz korrektem Setup**: Falls eine Seite im OAuth-Berechtigungsdialog ("Auswählen,
auf welche Seiten [App] zugreifen soll") angehakt wurde, aber weiterhin nicht funktioniert — z. B. weil sie
im Graph API Explorer nicht unter "Seiten-Zugriffstokens" auftaucht — hilft meist eine komplett neue
Autorisierung: auf facebook.com unter Einstellungen → "Apps und Websites" den Zugriff der App entfernen,
Explorer in einem frischen Tab neu öffnen und den Token neu generieren. Eine Verknüpfung über die
Business-Einstellungen (Konten → Apps → App auswählen → "Assets verknüpfen") ist dafür **nicht** zwingend
nötig — bereits eine rein persönliche OAuth-Freigabe (ohne Business-Asset-Verknüpfung) reicht aus, wie ein
Live-Test bestätigt hat (die zuerst funktionierende Seite hatte ebenfalls keine verknüpften Assets).

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

## Tägliche Aufräumung: 96h-Speicherbegrenzung und verwaiste PENDING/UPLOADING-Foto-Uploads

`docker/photo-cleanup.sh` ruft `/api/cron/photo-cleanup` auf, das zwei unabhängige Aufräum-Durchläufe
macht:

1. **96h-Speicherbegrenzung** (Foto-Upload-Brief: reine, kurzlebige Foto-Sammlung, keine dauerhafte
   Einsatzdokumentation): jeder komplette `PhotoUpload` - samt aller zugehörigen `Photo`-Zeilen,
   unabhängig von deren `status` - wird 96 Stunden nach `PhotoUpload.createdAt` gelöscht, damit der
   Exoscale-S3-Bucket nicht unbegrenzt wächst. Das UI zeigt den genauen Löschzeitpunkt auf der
   Foto-Upload-Detailseite an.
2. **Verwaiste PENDING/UPLOADING-Fotos** (unverändert gegenüber vorher): `Photo`-Zeilen, die seit mehr
   als 24 Stunden auf `status: PENDING` oder `status: UPLOADING` stehen - PENDING: ein abgebrochener
   Upload, bei dem der Client presign aufgerufen, den PUT/complete-Ablauf aber nie beendet hat;
   UPLOADING: ein Absturz/Timeout während der serverseitigen Nachbearbeitung (S3-Download,
   Vorschau-Generierung, Vorschau-Upload) nach dem PUT. Fängt nur noch Fälle zwischen 24h und 96h ab,
   da Durchlauf 1 für alles ab 96h ohnehin schon den ganzen Foto Upload entfernt hat.

Beide Durchläufe löschen zuerst die (ggf. gar nicht existierenden) S3-Objekte - Original UND beide
Vorschaubilder, falls bereits erzeugt - dann die DB-Zeile(n); ein einzelner S3-Fehler blockiert dabei
nicht die Aufräumung der übrigen Zeilen. Täglich um 04:00 österreichischer Zeit einrichten:

```bash
crontab -e
CRON_TZ=Europe/Vienna
0 4 * * * /opt/app-177/docker/photo-cleanup.sh >> /var/log/ffapp-photo-cleanup.log 2>&1
```

## Einsatzfotos: CORS-Konfiguration des `app-177-pictures`-Buckets (einmalige manuelle Einrichtung)

Der Foto-Upload lädt Originale per Browser-`XMLHttpRequest PUT` **direkt** gegen
`https://sos-<zone>.exo.io/...` hoch (presigned URL, siehe `src/lib/photo-upload/foreground-upload.ts`), nicht über
einen App-Server-Umweg. Ein cross-origin `PUT` mit gesetztem `Content-Type`-Header löst im Browser einen
CORS-Preflight (`OPTIONS`) aus - ohne eine passende CORS-Konfiguration auf dem Bucket lehnt Exoscale SOS
diesen Preflight ab und jeder Foto-Upload schlägt fehl, komplett unabhängig davon, ob
`S3_ACCESS_KEY`/`S3_SECRET_KEY`/`S3_ENDPOINT_URL`/`S3_PHOTOS_BUCKET` korrekt gesetzt sind. Das ist eine
reine Bucket-seitige Einstellung bei Exoscale - Anwendungscode kann sie nicht setzen, die CSP-Freigabe für
den Exoscale-Origin (bereits erledigt, siehe `next.config.mjs`) betrifft nur den Browser-seitigen
Content-Security-Policy-Block und hat mit CORS nichts zu tun.

**Einmalig manuell einzurichten** (Exoscale-Konsole → Object Storage → Bucket `app-177-pictures` → CORS,
oder per AWS-CLI gegen den S3-kompatiblen Endpunkt, analog zum Backup-Bucket-Setup oben):

```bash
aws --endpoint-url https://sos-at-vie-1.exo.io s3api put-bucket-cors \
  --bucket app-177-pictures \
  --cors-configuration '{
    "CORSRules": [
      {
        "AllowedOrigins": ["https://app-17.bfkdo-stpoelten.at", "https://app-177.ff-wolfsgraben.at", "https://dev.app-17.bfkdo-stpoelten.at"],
        "AllowedMethods": ["PUT", "GET"],
        "AllowedHeaders": ["content-type"],
        "MaxAgeSeconds": 3000
      }
    ]
  }'
```

`AllowedOrigins` muss die tatsächlichen Origins der App enthalten (Produktion und, falls dort auch real
gegen S3 getestet wird, die Dev-Subdomain) - `content-type` muss in `AllowedHeaders` stehen, da der Client
diesen Header beim `PUT` explizit setzt. Ohne diesen Schritt schlägt jeder Foto-Upload mit einem
CORS-Fehler in der Browser-Konsole fehl, obwohl Server-seitige Logs (presign, complete) unauffällig
aussehen - ein typisches "funktioniert lokal nicht reproduzierbar, weil der Fehler nur im echten Browser
gegen den echten Bucket auftritt"-Symptom.

Wie beim Backup-Bucket gilt außerdem: der `app-177-pictures`-Bucket selbst muss **komplett privat** bleiben
(keine öffentliche Bucket-Policy) - Fotos sind ausschließlich über die session-geschützte
`/api/photo-uploads/[photoUploadId]/photos/[photoId]`-Route mit kurzlebigen presigned GET-URLs erreichbar, nie über
eine dauerhafte öffentliche URL (siehe Design-Spec Abschnitt 4). Die CORS-Konfiguration oben ändert daran
nichts - sie erlaubt nur Browser-seitige `PUT`/`GET`-Requests von der App aus, keine öffentliche Lesbarkeit.

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

## Zweiter Stack für eine Test-/Dev-Umgebung (dev.app-17.bfkdo-stpoelten.at)

> **Domain-Umzug (2026-08-19):** die Dev-Umgebung lief ursprünglich unter
> `dev.app-177.ff-wolfsgraben.at`. Ein neuer DNS-Eintrag verankert sie jetzt bei
> `dev.app-17.bfkdo-stpoelten.at` (Bezirk-17-Branding statt der alten, Purkersdorf-spezifischen
> Domain) - kompletter Umzug, kein Parallelbetrieb beider Domains. Die Schritte unten spiegeln bereits
> die neue Domain; wer diesen Umzug auf dem echten Server nachvollzieht, muss zusätzlich: die reale
> Caddyfile-Zeile für die alte Domain entfernen (nicht nur die neue ergänzen), den alten Origin aus der
> S3-CORS-`AllowedOrigins`-Liste löschen, und `AUTH_URL`/`SEED_ADMIN_EMAIL` in der echten
> `/opt/app-177-dev/.env` von Hand aktualisieren (`.env.staging.example` ist nur die Vorlage für einen
> Neuaufbau, kein automatischer Sync für einen bestehenden Stack).

Nach Release 2.0.0 (echte Nutzer in Produktion) sollte eine neue Änderung nicht mehr direkt gegen Prod
getestet werden. Dieser Abschnitt richtet einen **zweiten, komplett eigenständigen Stack** auf demselben
Hetzner-Server ein: eigener Checkout-Ordner, eigene Postgres-Datenbank, eigenes `.env`, erreichbar über
eine eigene Subdomain. Der bestehende Produktions-Caddy übernimmt weiterhin **beide** Domains - ein
zweiter Caddy-Container würde mit dem bestehenden auf Port 80/443 kollidieren.

**Nicht zu verwechseln** mit der bereits vorhandenen `docker-compose.dev.yml` im Repo-Root - die startet
nur eine lokale Postgres-Instanz für `npm run dev` auf dem eigenen Rechner, kein vollständiger,
öffentlich erreichbarer Stack. Die Dateien hier heißen deshalb bewusst `*.staging.*`, um Verwechslungen
zu vermeiden, auch wenn die Umgebung selbst im Alltag "Dev-Server" genannt wird.

### 1. Voraussetzungen

- **DNS**: einen A-Record für `dev.app-17.bfkdo-stpoelten.at` anlegen, der auf dieselbe Server-IP zeigt
  wie der bestehende Prod-Record. Ohne diesen Eintrag kann Caddy später kein Let's-Encrypt-Zertifikat
  für die neue Subdomain ausstellen.
- **Serverkapazität** prüfen (`free -h`, `df -h`) - ein zweiter Next.js- + Postgres-Container läuft
  dauerhaft parallel zu Prod, nicht nur während eines Tests.

### 2. Zweiten Checkout anlegen

```bash
git clone <dasselbe Repo-Remote wie /opt/app-177> /opt/app-177-dev
cd /opt/app-177-dev
cp .env.staging.example .env
```

`.env` jetzt ausfüllen - **jeder Wert muss sich von der Produktions-`.env` unterscheiden** (siehe die
Kommentare in `.env.staging.example` für die Begründung je Variable, insbesondere die Mailjet-Warnung:
echte E-Mail-Versendung an echte Mitglieder nur vermeiden, indem diese Umgebung ausschließlich mit
`prisma/seed.ts`-Testdaten läuft, nie mit einer Kopie der echten Produktionsdatenbank).

### 3. Gemeinsames Docker-Netzwerk für Prod-Caddy ↔ Dev-App

Einmalig anlegen:

```bash
docker network create caddy_net
```

Der **bestehende** Prod-Stack muss diesem Netzwerk zusätzlich beitreten, damit sein Caddy den neuen
Dev-App-Container erreichen kann. In `/opt/app-177/docker/docker-compose.yml` beim `caddy`-Service
ergänzen:

```yaml
  caddy:
    image: caddy:2-alpine
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    networks:
      - default
      - caddy_net          # neu
    depends_on:
      - app
    restart: unless-stopped

networks:                  # neu
  caddy_net:
    external: true
```

Danach NUR den Caddy-Container neu erstellen (Prod-App/-Postgres bleiben unberührt, kurze Unterbrechung
im Sekundenbereich beim Neustart von Caddy selbst):

```bash
cd /opt/app-177
docker compose -f docker/docker-compose.yml --env-file .env up -d caddy
```

### 4. Dev-Stack starten

`docker/docker-compose.staging.yml` ist bereits im Repo vorbereitet (App + eigene Postgres, kein
eigener Caddy, tritt `caddy_net` selbst bei). Immer mit einem **eigenen Projektnamen** starten, damit
Container/Volumes nie mit Prod kollidieren:

```bash
cd /opt/app-177-dev
docker compose -p app177-dev -f docker/docker-compose.staging.yml --env-file .env up -d --build
docker compose -p app177-dev -f docker/docker-compose.staging.yml --env-file .env exec dev-app node node_modules/tsx/dist/cli.mjs prisma/seed.ts
```

### 5. Caddy: neue Subdomain eintragen

Auf dem Server die **echte** Caddyfile bearbeiten (nicht die Platzhalter-Vorlage im Repo,
`docker/Caddyfile` - die echte Domain wird laut bestehender Konvention nie committet, siehe oben) und
einen zweiten Site-Block ergänzen:

```
dev.app-17.bfkdo-stpoelten.at {
	reverse_proxy app177-dev-app:3000
}
```

`app177-dev-app` ist der explizite `container_name` aus `docker-compose.staging.yml`. Der Compose-Service
selbst heißt dort bewusst `dev-app`, nicht `app` - reicht nicht, das nur in dieser `reverse_proxy`-Zeile zu
vermeiden: Docker Compose vergibt jedem Service auf **jedem** Netzwerk, dem er beitritt, automatisch einen
DNS-Alias gleich dem Service-Namen, auch auf `caddy_net`. Hieße der Dev-Service ebenfalls `app`, gäbe es auf
`caddy_net` zwei Container mit Alias `app`, und Prod-Caddys eigene `reverse_proxy app:3000`-Zeile (die ja
den *Prod*-App-Container meint) würde uneindeutig - das ist real passiert: Prod-Aufrufe von
app-177.ff-wolfsgraben.at landeten zeitweise beim Dev-Container und wurden auf die Dev-Domain umgeleitet
(deren abweichende `AUTH_URL`), aber nur solange der Dev-Stack lief. Danach Caddy ohne Neustart/Downtime
neu laden:

```bash
cd /opt/app-177
docker compose -f docker/docker-compose.yml --env-file .env exec caddy caddy reload --config /etc/caddy/Caddyfile
```

`https://dev.app-17.bfkdo-stpoelten.at` sollte jetzt erreichbar sein (Caddy stellt beim ersten Aufruf
automatisch ein eigenes Let's-Encrypt-Zertifikat für die neue Subdomain aus - vorausgesetzt der
DNS-Eintrag aus Schritt 1 ist bereits gesetzt). Login mit `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` aus
der Dev-`.env` testen.

### 6. Laufende Nutzung

Eine neue Änderung testen, ohne Prod anzufassen:

```bash
cd /opt/app-177-dev
git checkout <feature-branch>   # oder: git pull für main
docker compose -p app177-dev -f docker/docker-compose.staging.yml --env-file .env up -d --build
```

Erst nach erfolgreichem Test in `/opt/app-177` wie gewohnt nach `main` mergen und dort separat
deployen (`git pull` + `docker compose -f docker/docker-compose.yml --env-file .env up -d --build`) -
die beiden Checkouts/Stacks beeinflussen sich nie gegenseitig.

**Bewusst nicht eingerichtet**: keiner der host-seitigen Cronjobs (`backup.sh`,
`send-scheduled-news.sh`, `system-check-email.sh`, `atemschutz-warnung-email.sh`,
`facebook-fetch.sh`, `kalender-ics-sync.sh`, `photo-cleanup.sh`) läuft standardmäßig für
diesen Stack - die würden sonst
unnötig externe Dienste (Mailjet, S3, Facebook) mit Testdaten treffen. Nur gezielt und temporär
einrichten, wenn ein cron-gesteuertes Feature selbst getestet werden soll, und danach wieder aus der
Dev-Crontab entfernen.
