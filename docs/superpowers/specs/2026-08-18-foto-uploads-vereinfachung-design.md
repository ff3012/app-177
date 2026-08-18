# Foto Uploads (Vereinfachung) — neues Modul unter „Meine Feuerwehr"

**Status:** Approved, ready for implementation planning.
**Source:** Claude-Design-Projekt „Feuerwehr-Verwaltung UI Redesign"
(`cabb2cb1-85d4-4829-a3a4-eb667d733949`), Datei `Foto-Upload-Brief.md`, überarbeitete Fassung
(ersetzt vollständig `docs/superpowers/specs/2026-08-17-einsatz-foto-upload-design.md`).

## 0. Was sich ändert

Die bereits vollständig implementierte, final-reviewte „Einsätze erfassen und Fotos hochladen"-
Funktion (Branch `worktree-einsatz-foto-upload`, 10 Plan-Tasks + Fixes, **noch nicht nach `main`
gemergt**) wird durch diese Spec **ersetzt**, nicht ergänzt. Der App-Betreiber hat den Brief in
Claude Design grundlegend vereinfacht: **es ist keine Einsatzdokumentation mehr, sondern reine
Foto-Sammlung.** Drei Klärungen wurden im Chat explizit entschieden (überschreiben die
Brief-Formulierung an diesen Stellen):

- **Anlegen-Rechte**: der Brief schreibt weiterhin „Kommandant, Einsatzleiter, Schriftführer der
  Wehr" — identisch zur allerersten Brief-Fassung. Wie schon damals entschieden: es gibt in dieser
  App kein Rollensystem (nur `Dienstgrad`, eine reine Anzeige-Tabelle ohne Berechtigungslogik).
  **Jedes Mitglied der Feuerwehr darf einen Foto Upload anlegen/bearbeiten/löschen** — identisch
  zur Sichtbarkeits-/Hochlade-Regel.
- **Migration**: die bestehende Migration (`Incident`/`IncidentVehicle`/`IncidentCrewMember`/
  `IncidentPhoto`) ist committet, aber nirgends außerhalb des lokalen Dev-Postgres angewendet —
  nicht auf DEV, nicht auf PROD. Sie wird **ersetzt**, nicht durch eine zweite additive Migration
  ergänzt.
- **Routen**: der Brief nennt `/foto-uploads/*` als eigenständige Top-Level-Route (nicht mehr
  verschachtelt unter `/meine-feuerwehr/einsaetze/*`). Wird wörtlich umgesetzt — die alten Routen
  entfallen vollständig.

Was aus der bisherigen Implementierung **unverändert wiederverwendet** wird (Architektur bereits
bewährt, kein Grund zur Änderung): das S3-Client-Modul für den Bucket `app-177-pictures`
(gleiche Credentials, gleiche presigned-URL-Mechanik), die session-geschützte Download-Route mit
60-Sekunden-Presigned-GET-Redirect, die serverseitige `sharp`-Decode-Validierung (nie
Client-MIME-Type vertrauen), die `exifr`-EXIF-Auslese, die CORS-Dokumentation im
`docker/README.md`, der CSP-Fix in `next.config.mjs` (`https://*.exo.io` bleibt unverändert
nötig), und das Cron-Aufräum-Muster für verwaiste Datensätze.

## 1. Zweck

Fotos von Einsätzen und Übungen an einer Stelle sammeln. Es ist **keine** Einsatzdokumentation —
kein Ort, keine Einsatzzeiten, keine Mannschaftserfassung. Wer einen Foto Upload anlegt, tut es,
damit Fotos einen Platz haben.

Zwei Dinge sind getrennt zu behandeln: **Foto Upload anlegen** und **Fotos beitragen** (beides:
jedes Mitglied der Wehr).

## 2. Datenmodell

```prisma
enum PhotoUploadKind { EINSATZ  UEBUNG  SONSTIGES }
enum PhotoStatus     { PENDING  UPLOADING  READY  FAILED }

model PhotoUpload {
  id               String   @id @default(cuid())
  fireDepartmentId String
  fireDepartment   Organization @relation(fields: [fireDepartmentId], references: [id])
  kind             PhotoUploadKind
  description      String                    // "T2 – Verkehrsunfall B44"
  occurredOn       DateTime                  // nur Datum, keine Uhrzeit
  createdById      String
  createdBy        User     @relation(fields: [createdById], references: [id])
  createdAt        DateTime @default(now())
  photos           Photo[]
}

model Photo {
  id            String      @id @default(cuid())
  photoUploadId String
  photoUpload   PhotoUpload @relation(fields: [photoUploadId], references: [id], onDelete: Cascade)
  uploadedById  String
  uploadedBy    User        @relation(fields: [uploadedById], references: [id])
  storageKey    String                        // Original, unverändert, S3-Objektschlüssel
  previewKey    String?                       // abgeleitete ~1600px-WebP-Ansicht
  thumbKey      String?                       // abgeleitetes ~400px-WebP-Thumbnail
  originalName  String
  mimeType      String                        // image/jpeg, image/heic, …
  byteSize      Int
  width         Int?
  height        Int?
  takenAt       DateTime?                     // aus EXIF, falls vorhanden
  status        PhotoStatus @default(PENDING)
  createdAt     DateTime    @default(now())
}
```

Drei Felder auf `PhotoUpload`, absichtlich: **Anlass (kind), Beschreibung, Datum.** `occurredOn`
ist ein Datum ohne Uhrzeit. `Photo` hat **kein** `publicRelease`-Feld — die Fotorechte gehen laut
Feststellungstext beim Anlegen automatisch mit dem Hochladen an die Feuerwehr über, es gibt keinen
Schalter und keine Filterung danach.

Ersatzlos entfernt gegenüber der vorherigen Implementierung: `IncidentVehicle`,
`IncidentCrewMember` (keine Fahrzeug-/Mannschaftsauswahl mehr), `Incident.location`,
`Incident.alarmedAt`, `Incident.endedAt`, `Incident.crewCount`, `IncidentPhoto.publicRelease`.
Keine dieser Spalten bleibt als ungenutztes optionales Feld liegen — vollständig aus Schema und
Code entfernt.

**Migration**: die bestehende Migration `20260817130709_einsatz_foto_upload` wird durch eine neue
ersetzt (gelöscht und durch die korrekte Fassung neu erzeugt) — sie wurde nie außerhalb des
lokalen Dev-Postgres angewendet, ein Ersetzen ist damit risikofrei. Die Relationsfelder auf
`Organization`/`User`/`Vehicle` aus der alten Migration (`incidents`, `createdIncidents`,
`incidentCrewMemberships`, `uploadedIncidentPhotos`, `incidentVehicles`) werden durch die neuen
Gegenstücke ersetzt (`photoUploads`, `createdPhotoUploads`, `uploadedPhotos` — `Vehicle` braucht
gar keine neue Relation mehr, da es keine Fahrzeugauswahl mehr gibt).

## 3. Berechtigungen

| Aktion | Wer | Funktion in `permissions.ts` |
|---|---|---|
| Foto Upload anlegen/bearbeiten/löschen | jedes Mitglied der Wehr | `canManagePhotoUploadsFor(user, fireDepartmentId)` |
| Foto Uploads und Fotos sehen | jedes Mitglied der Wehr | `canViewPhotoUploadsFor(user, fireDepartmentId)` |
| Fotos hochladen | jedes Mitglied der Wehr, keine Einschränkung | = `canViewPhotoUploadsFor` |
| Eigene Fotos löschen | der Uploader | `photo.uploadedById === user.id` |
| Fremde Fotos löschen | Admin der Wehr | `canManageHeimatfeuerwehrFor(user, fireDepartmentId)` |

`canDeletePhoto(user, photo, fireDepartmentId)` kombiniert die letzten beiden Zeilen (Uploader ODER
Admin), analog zum bisherigen `canDeleteIncidentPhoto`. **Kein** `canTogglePhotoRelease` mehr —
es gibt kein Freigabe-Feld, über das entschieden werden müsste.

`canManagePhotoUploadsFor`/`canViewPhotoUploadsFor` sind inhaltlich identisch (jedes Mitglied),
als zwei benannte Funktionen gehalten — gleiches Muster wie zuvor bei
`canManageIncidentsFor`/`canViewIncidentsFor` bzw. `canManageUsersFor`/`canManageHeimatfeuerwehrFor`
in diesem Projekt.

Alle Prüfungen laufen serverseitig in Route und Server Action; ein Mitglied einer anderen Wehr
bekommt `notFound()`.

## 4. Objektspeicher

Unverändert gegenüber der vorherigen Implementierung: Bucket `app-177-pictures`, gleiche
Credentials (`S3_ACCESS_KEY`/`S3_SECRET_KEY`/`S3_ENDPOINT_URL`/`S3_PHOTOS_BUCKET`), gleiche
CORS-Anforderung (bereits in `docker/README.md` dokumentiert), gleicher CSP-Eintrag
(`https://*.exo.io` in `connect-src`/`img-src`, bereits in `next.config.mjs`).

### 4.1 Hochladen (presigned PUT)

```
POST /api/photo-uploads/{id}/photos/presign   → { uploadUrl, storageKey, photoId }
PUT  {uploadUrl}                              ← Datei, direkt vom Gerät
POST /api/photo-uploads/{id}/photos/{pid}/complete
```

- `presign` prüft `canViewPhotoUploadsFor` und legt `Photo` mit `status: PENDING` an.
- `complete` setzt `status: READY`, liest Bilddimensionen und EXIF-`takenAt`, leitet die beiden
  Vorschaugrößen ab — identische Logik wie zuvor (`sharp`-Decode-Validierung gegen eine
  Format-Allowlist inkl. HEIC/HEIF, atomarer `PENDING`→`UPLOADING`-Claim gegen
  Doppel-`complete`-Aufrufe, Revert auf `PENDING` bei „Objekt noch nicht da").
- Cron-Job räumt verwaiste `PENDING`/`UPLOADING`-Datensätze älter als 24 h auf (inkl. aller drei
  Storage-Keys), identisches Muster wie zuvor.

### 4.2 Herunterladen/Anzeigen

Unverändert: nie eine dauerhafte öffentliche URL. `GET /api/photo-uploads/{id}/photos/{photoId}
?variant=original|view|thumbnail` prüft `requireUser()` + `canViewPhotoUploadsFor`, dann
307-Redirect auf eine 60-Sekunden-Presigned-GET-URL. `variant=original` setzt
`ResponseContentDisposition: attachment; filename="..."`.

### 4.3 Vorschauen ableiten, 4.4 HEIC, 4.5 Grenzen

Unverändert: zwei WebP-Vorschauen (Thumbnail ~400px, Ansicht ~1600px) im `complete`-Schritt,
Original byteidentisch, HEIC nur für Vorschauen dekodiert nie umkodiert. Maximal 50 MB je Datei,
30 Dateien je Vorgang, nur `image/*`, MIME-Typ serverseitig über Magic Bytes geprüft.

## 5. Foto-Upload — Vordergrund statt Warteschlange

**Größte technische Änderung.** Die bisherige IndexedDB-Warteschlange (`src/lib/upload-queue/`,
Pause/Resume, WLAN-Only-Schalter, Hintergrundbetrieb über Seitenwechsel hinweg) entfällt
vollständig und wird durch einen synchronen Vordergrund-Upload ersetzt:

- Der Upload ist eine **blockierende Aktion** — der Nutzer bleibt auf dem Sheet/Screen, bis der
  Vorgang durch ist. Fortschritt **in Bytes**, nicht nur in Dateien: „3 von 8 Fotos übertragen ·
  14,1 MB von 38,4 MB · Originalauflösung".
- **Kein Pause-Button, keine Hintergrund-Warteschlange, kein IndexedDB.** Versucht der Nutzer den
  Screen zu verlassen, während eine Übertragung läuft, kommt eine Rückfrage, dass laufende
  Übertragungen abgebrochen werden. Umsetzung: `window.onbeforeunload` fängt Tab-Schließen/Reload/
  echte Navigation weg von der Seite ab; der Sheet-eigene Schließen-Button („Fertig"/Backdrop-Klick)
  wird bei aktivem Upload zusätzlich mit einem `window.confirm(...)` vor dem eigentlichen Schließen
  versehen — eine vollständige Abfangung *jeder* denkbaren Next.js-App-Router-Client-Navigation
  (z. B. Klick auf einen anderen Nav-Link während des Uploads) ist ohne einen globalen
  Router-Interceptor, den App Router nicht eingebaut anbietet, nicht praktikabel; dieser bewusst
  begrenzte Schutzumfang (Tab-Ereignisse + der Sheet-eigene Schließen-Pfad) wird im Code kommentiert,
  analog zur bereits dokumentierten iOS-Netzwerk-API-Einschränkung der Vorgängerversion.
- 2–3 Dateien parallel hochladen, darüber hinaus sequenziell abarbeiten.
- Fehlgeschlagene Uploads einzeln mit „Erneut versuchen", nicht als Alles-oder-nichts — ein
  einzelner Fehlschlag darf die übrigen nicht mitreißen.
- **Keine WLAN-Option.** Kein `navigator.connection`-Check, keine Gate-Logik — es wird übertragen,
  sobald der Nutzer bestätigt.
- Implementierung: eine einfache client-seitige Funktion (kein persistenter Store, kein Modul-Level
  Zustand über Seitenwechsel hinweg) — ein `useState`-Array von Datei-Fortschritts-Objekten im
  Sheet-Client-Component, das den bekannten presign→PUT(mit `xhr.upload.onprogress`)→complete-Ablauf
  pro Datei ausführt, mit `Promise`-basierter 2-3-fach-Parallelität (z. B. ein einfacher
  Worker-Pool-Ansatz mit einem festen Parallelitäts-Limit, keine externe Bibliothek nötig).

## 6. Bildschirme

### 6.1 Startbildschirm „Meine Feuerwehr" — Block umbenannt

„FOTO UPLOADS LETZTE 24 STUNDEN" (vorher „Einsätze (letzte 24 Stunden)"). Fenster:
`createdAt >= now() - 24h`, absteigend sortiert. Ohne Foto Upload in diesem Fenster entfällt der
ganze Block — kein Platzhalter. Pro Karte: Anlass-Chip (`Einsatz`/`Übung`/`Sonstiges`), Zeit,
Beschreibung, **„Angelegt von {Name}"** (nicht mehr Ort — den gibt es nicht), bis zu 4
Foto-Vorschauen (letzte Kachel „+N" bei mehr), „Fotos hinzufügen"-Button in der Karte. Ohne Fotos:
„Noch keine Fotos vorhanden." **„Foto Upload"** als umrandeter Button oben im Screen, direkt unter
dem nächsten Termin, für jedes Mitglied (serverseitig geprüft).

### 6.2 Foto Upload anlegen

Sheet/Seite, Titel „Foto Upload". Genau drei Felder:

1. **Anlass** — drei Kacheln in einer Reihe (`repeat(3,1fr)`, 44px): `Einsatz` · `Übung` ·
   `Sonstiges`. Aktive Kachel brand-gefüllt.
2. **Beschreibung** — Freitext, z. B. „T2 – Verkehrsunfall B44".
3. **Datum** — ausgeschrieben, Standard heute, Zukunft gesperrt.

Darunter als Feststellung, keine Checkbox: „Jedes Mitglied der Feuerwehr {Name} darf Fotos zu
diesem Einsatz hochladen und die eigenen wieder löschen. Durch das Hochladen werden Fotorechte an
die Feuerwehr für die Veröffentlichung abgetreten." Fußzeile fix: „Speichern und Fotos wählen" —
führt direkt in die Fotoauswahl.

### 6.3 Sheet „Fotos hinzufügen"

Bottom Sheet: `Foto aufnehmen` / `Aus der Fotobibliothek` / `Aus Dateien`. Darunter, **ohne
Schalter**, zwei Hinweise: ein grüner Punkt „Durch das Hochladen werden die Fotorechte an die
Feuerwehr für die Veröffentlichung abgetreten." und ein `warning-subtle`-Hinweis „Fotos werden
unverändert gespeichert — samt Aufnahmezeit und, falls im Bild vorhanden, Standortdaten. Bei
Personen und Kennzeichen gilt die Datenschutzregelung der Wehr." Primäraktion: „{n} Fotos
übertragen". Kein WLAN-Schalter, kein Freigabe-Schalter.

### 6.4 Detailansicht

Kopf: Anlass-Chip, Datum, Beschreibung, „Angelegt von {Name}". **Kein Faktenraster** (Alarm/Dauer/
Mannschaft entfällt komplett). Upload-Karte nur während laufender Übertragung. „Fotos {n}" mit
„+ Hinzufügen", Raster dreispaltig (`aspect-ratio: 1`, 6px Gap): eigene Fotos rotes
Initialen-Kürzel + Löschkreuz, fremde Fotos graues Kürzel ohne Kreuz, laufende Uploads als
Spinner-Kachel, letzte Kachel „+". Legende darunter. Einzelbild-Ansicht: Uploader, Aufnahmezeit,
Dateigröße, „Original herunterladen", „Löschen" (eigene oder Admin) — mit Rückfrage. **Kein
Freigabe-Schalter.**

### 6.5 Routen

Alle unter neuem Top-Level-Segment `/foto-uploads` (nicht mehr unter `/meine-feuerwehr/einsaetze`):
`/foto-uploads` (Liste), `/foto-uploads/neu` (anlegen), `/foto-uploads/[id]` (Detail),
`/foto-uploads/[id]/bearbeiten` (bearbeiten). Die alten `/meine-feuerwehr/einsaetze/*`-Routen
werden vollständig entfernt.

## 7. Umsetzungsreihenfolge

1. Migration `PhotoUpload`/`Photo` (ersetzt die alte Migration) + Berechtigungsfunktionen
2. Foto Upload anlegen/bearbeiten/löschen (3 Felder) inkl. serverseitiger Rechteprüfung
3. S3-Client-Modul (umbenannt) + Presign-/Complete-Route
4. Download-Route (Presigned-GET-Redirect)
5. Vordergrund-Upload-Mechanik (Byte-Fortschritt, Einzel-Retry, `beforeunload`-Bestätigung, 2-3
   parallel) im Sheet „Fotos hinzufügen"
6. Vorschau-Ableitung im `complete`-Schritt
7. Detailansicht mit Galerie, Löschen
8. 24-Stunden-Block auf dem Startbildschirm (umbenannt)
9. Cron-Aufräumung verwaister `PENDING`/`UPLOADING`-Datensätze
10. Liste zum Nachtragen älterer Foto Uploads

## 8. Abnahmekriterien

- [ ] Das Formular hat genau drei Felder: Anlass, Beschreibung, Datum.
- [ ] Ein 11-MB-HEIC-Foto liegt nach dem Upload byteidentisch im Storage.
- [ ] Der Download liefert das Original, nicht die Vorschau.
- [ ] Acht Fotos: Fortschritt in MB, kein Pause-Button, Verlassen des Screens fragt nach.
- [ ] Ein einzelner Fehlschlag lässt die übrigen sieben durchlaufen.
- [ ] Jedes Mitglied kann hochladen; niemand kann fremde Fotos löschen außer Admins.
- [ ] Ein Mitglied einer anderen Wehr bekommt beim Direktaufruf 404.
- [ ] Ohne Foto Upload in 24 Stunden fehlt der Block auf dem Startbildschirm vollständig.
- [ ] Nirgends erscheint ein Feld für Ort, Fahrzeuge, Mannschaft, Alarm- oder Endzeit.
- [ ] Nirgends erscheint ein Freigabe- oder WLAN-Schalter.
- [ ] Die letzte Karte liegt nicht unter der Tab-Bar.
- [ ] Kein Foto ist über eine dauerhafte/öffentliche URL erreichbar.
