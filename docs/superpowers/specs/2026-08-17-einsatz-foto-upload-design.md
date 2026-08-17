# Einsätze erfassen und Fotos hochladen (neues Modul unter „Meine Feuerwehr")

**Status:** Approved, ready for implementation planning.
**Source:** Claude-Design-Projekt „Feuerwehr-Verwaltung UI Redesign"
(`cabb2cb1-85d4-4829-a3a4-eb667d733949`), Datei `Foto-Upload-Brief.md`, plus
Infrastruktur-Entscheidungen aus dem anschließenden Chat (Objektspeicher, Download-Mechanismus).
Designvorlage: `Einsatz erfassen.dc.html` (Signalrot).

## 1. Zweck

Zwei getrennte, aber zusammengehörige Funktionen unter „Meine Feuerwehr": **Einsätze erfassen**
(nur Berechtigte: Kommandant, Einsatzleiter, Schriftführer der Wehr) und **Fotos zu einem Einsatz
beitragen** (jedes Mitglied der Wehr, keine Einschränkung). `Incident` gehört immer **einer**
Feuerwehr — keine abschnittsweite Sichtbarkeit, keine Freischaltung pro Einsatz.

## 2. Datenmodell

```prisma
enum IncidentKind { TECHNISCH  BRAND  SCHADSTOFF  SONSTIGES }
enum PhotoStatus { PENDING  UPLOADING  READY  FAILED }

model Incident {
  id               String       @id @default(cuid())
  fireDepartmentId String
  fireDepartment   Organization @relation(fields: [fireDepartmentId], references: [id])
  kind             IncidentKind
  keyword          String                    // "T2 – Verkehrsunfall"
  location         String
  alarmedAt        DateTime
  endedAt          DateTime?
  crewCount        Int?
  createdById      String
  createdBy        User         @relation(fields: [createdById], references: [id])
  createdAt        DateTime     @default(now())
  vehicles         IncidentVehicle[]         // siehe unten - Mehrfachauswahl "Fahrzeuge"
  crewMembers      IncidentCrewMember[]      // siehe unten - optionale Personenauswahl "Mannschaft"
  photos           IncidentPhoto[]
}

// Reine Join-Tabelle für die Mehrfachauswahl "Fahrzeuge" (Brief §4.5) - Vehicle existiert
// bereits (meine-feuerwehr/Fuhrpark), keine Änderung an Vehicle selbst nötig.
model IncidentVehicle {
  incidentId String
  incident   Incident @relation(fields: [incidentId], references: [id], onDelete: Cascade)
  vehicleId  String
  vehicle    Vehicle  @relation(fields: [vehicleId], references: [id])

  @@id([incidentId, vehicleId])
}

// Brief §4.5 "Mannschaft - Anzahl plus optionale Personenauswahl": crewCount (auf Incident) ist
// die eigenständige, immer vorhandene Zahl - die Personenauswahl hier ist eine zusätzliche,
// unabhängige Anreicherung (muss nicht mit crewCount übereinstimmen, z.B. "12 Mann" bekannt,
// aber nur 4 Namen erfasst). Ohne diese Tabelle wäre die "optionale Personenauswahl" aus dem
// Brief nicht abbildbar gewesen - im ersten Entwurf dieser Spec fehlte sie versehentlich.
model IncidentCrewMember {
  incidentId String
  incident   Incident @relation(fields: [incidentId], references: [id], onDelete: Cascade)
  userId     String
  user       User     @relation(fields: [userId], references: [id])

  @@id([incidentId, userId])
}

model IncidentPhoto {
  id            String       @id @default(cuid())
  incidentId    String
  incident      Incident     @relation(fields: [incidentId], references: [id], onDelete: Cascade)
  uploadedById  String
  uploadedBy    User         @relation(fields: [uploadedById], references: [id])
  storageKey    String                        // Original, unverändert, S3-Objektschlüssel
  previewKey    String?                       // abgeleitete ~1600px-WebP-Ansicht
  thumbnailKey  String?                       // abgeleitetes ~400px-WebP-Thumbnail
  originalName  String
  mimeType      String                        // image/jpeg, image/heic, …
  byteSize      Int
  width         Int?
  height        Int?
  takenAt       DateTime?                     // aus EXIF, falls vorhanden
  publicRelease Boolean      @default(false)
  status        PhotoStatus  @default(PENDING)
  createdAt     DateTime     @default(now())
}
```

Additive Migration. Keine Änderung an bestehenden Modellen außer den beiden neuen
`@relation`-Gegenstücken auf `Organization`/`User`/`Vehicle` (nur die Relationsfelder, keine
Spaltenänderung).

## 3. Berechtigungen

| Aktion | Wer | Funktion in `permissions.ts` |
|---|---|---|
| Einsatz anlegen/bearbeiten/löschen | jedes Mitglied der Wehr | `canManageIncidentsFor(user, fireDepartmentId)` |
| Einsätze und Fotos sehen | jedes Mitglied der Wehr | `canViewIncidentsFor(user, fireDepartmentId)` |
| Fotos hochladen | jedes Mitglied der Wehr, keine Einschränkung | = `canViewIncidentsFor` |
| Eigene Fotos löschen | der Uploader | `photo.uploadedById === user.id` |
| Fremde Fotos löschen | Admin der Wehr | `canManageHeimatfeuerwehrFor(user, fireDepartmentId)` |
| Für Öffentlichkeitsarbeit freigeben | der Uploader, je Foto | `photo.uploadedById === user.id` |

**Rückfrage geklärt (App-Betreiber, Chat):** das Brief nannte „Kommandant, Einsatzleiter,
Schriftführer" als Berechtigte fürs Anlegen — keine bestehende Rollenunterscheidung in diesem
Projekt (aktuell nur `Dienstgrad`, eine reine Anzeige-/Kurzform-Tabelle ohne Berechtigungslogik).
Entschieden: **jedes Mitglied der Heimatfeuerwehr darf Einsätze anlegen/bearbeiten/löschen** —
dieselbe Regel wie beim Sehen/Foto-Hochladen, keine gesonderte Rollen-Einschränkung.
`canManageIncidentsFor` und `canViewIncidentsFor` sind damit inhaltlich identisch (Mitglied der
Feuerwehr, ODER wer sie laut `canManageHeimatfeuerwehrFor` administrativ verwaltet) — als zwei
benannte Funktionen gehalten statt einer gemeinsamen, falls sich das künftig doch trennt
(gleiches Muster wie z. B. `canManageUsersFor`/`canManageHeimatfeuerwehrFor` in diesem Projekt).
Alle Prüfungen laufen **serverseitig** in Route und Server Action; ein Mitglied einer anderen
Wehr bekommt `notFound()`, nicht nur eine ausgeblendete UI.

## 4. Objektspeicher (Chat-Entscheidung, nicht im ursprünglichen Brief)

Neuer, eigenständiger Exoscale-SOS-Bucket **`app-177-pictures`**, im selben Account und derselben
Zone wie der bestehende Backup-Bucket, aber komplett getrennt (andere Zugriffsmuster/
Sensibilität als Backups). Zugangsdaten werden laut App-Betreiber **wiederverwendet** —
`S3_ACCESS_KEY`/`S3_SECRET_KEY`/`S3_ENDPOINT_URL` bleiben identisch zum bestehenden
Backup-Setup, nur eine neue Variable **`S3_PHOTOS_BUCKET=app-177-pictures`** kommt hinzu. Der
Bucket selbst ist **komplett privat** (keine öffentliche Bucket-Policy) — es gibt zu keinem
Zeitpunkt eine dauerhafte, öffentlich erreichbare Foto-URL.

**Wichtiger Hinweis für die Implementierung:** falls der bestehende Exoscale-API-Schlüssel per
IAM-Policy auf den Backup-Bucket eingeschränkt ist (statt account-weit gültig), muss er vor dem
ersten Test um Rechte auf `app-177-pictures` erweitert werden — das kann nur der App-Betreiber
in der Exoscale-Konsole tun, nicht per Code.

### 4.1 Hochladen (presigned PUT)

```
POST /api/incidents/{id}/photos/presign   → { uploadUrl, storageKey, photoId }
PUT  {uploadUrl}                          ← Datei, direkt vom Gerät zum Bucket
POST /api/incidents/{id}/photos/{pid}/complete
```

- `presign` prüft `canViewIncidentsFor` (jedes Mitglied darf hochladen) und legt
  `IncidentPhoto` mit `status: PENDING` an, bevor die signierte URL zurückgeht.
- `complete` setzt `status: READY`, liest Bilddimensionen (`sharp(...).metadata()`) und
  EXIF-`takenAt` (`exifr` oder gleichwertig - neue, kleine Abhängigkeit, da dieses Projekt
  bislang keine EXIF-Bibliothek hat) und stößt die Vorschau-Ableitung an (Abschnitt 4.2).
- Ein Cron-Job (analog den bestehenden `docker/*.sh`-Mustern) räumt verwaiste
  `PENDING`-Datensätze älter als 24 h auf (Datenbankzeile UND, falls doch schon ein Objekt im
  Bucket liegt, das Objekt selbst).

### 4.2 Herunterladen/Anzeigen (Chat-Entscheidung)

**Nie eine dauerhafte öffentliche URL.** Jeder Foto-Zugriff läuft über eine eigene,
session-geschützte Route in app-177 — dasselbe Muster wie die bestehenden Wappen-/
PDF-Download-Routen (`api/organization/[organizationId]/wappen/route.ts`,
`drohnen/unterlagen/[id]/route.ts`): erst `requireUser()` + `canViewIncidentsFor`-Prüfung, **dann
erst** wird serverseitig eine sehr kurzlebige (60 Sekunden) Presigned-GET-URL erzeugt und die
Antwort dorthin weitergeleitet (`307`). Für Vorschauen (Thumbnail/Ansicht, klein) ist das
unkritisch; für Originale (bis 50 MB) vermeidet der Redirect zusätzlich, dass der Next.js-Server
selbst die Bytes puffern/streamen muss.

Der Download-Endpunkt für das Original setzt `ResponseContentDisposition` direkt beim Erzeugen
der Presigned-URL (von `@aws-sdk/client-s3`s `GetObjectCommand` unterstützt) auf
`attachment; filename="<originalName>"` — funktioniert identisch in iOS Safari/PWA, Android
Chrome und jedem Desktop-Browser (natives „Datei speichern").

### 4.3 Vorschauen ableiten

Angezeigt wird nie das Original. Serverseitig (im `complete`-Schritt) zwei Größen erzeugen,
beide WebP: Thumbnail ~400px, Ansicht ~1600px — mit dem im Projekt bereits vorhandenen `sharp`
(gleiche Bibliothek wie beim WASTL-Proxy und der Wappen-Re-Encodierung). Das Original bleibt
**byteidentisch unangetastet** im Bucket liegen.

### 4.4 HEIC

iPhones liefern standardmäßig HEIC. Das Original wird **so gespeichert, wie es hochgeladen
wurde** (kein Neukodieren) — nur die abgeleiteten Vorschauen werden nach WebP konvertiert
(`sharp` liest HEIC nativ über `libheif`, bereits Teil der installierten `sharp`-Binärdatei, siehe
`sharp.versions.heif` in diesem Projekt).

## 5. Client-seitige Upload-Warteschlange

- Mehrfachauswahl, sequenziell **2-3 parallel**. Fortschritt **in Bytes**, nicht in Dateien:
  „3 von 8 Fotos übertragen · 14,1 MB von 38,4 MB · Originalauflösung".
- Warteschlange in **IndexedDB** (neue, kleine Abhängigkeit `idb` oder gleichwertig - dieses
  Projekt hat bislang keinen IndexedDB-Zugriff) — übersteht App-Neustart und Verbindungsabbruch.
  Pausieren/Fortsetzen möglich; läuft im Hintergrund weiter, wenn der Nutzer die Seite wechselt.
- **„Nur über WLAN übertragen" ist voreingestellt an** (`navigator.connection`/Network
  Information API, wo verfügbar - iOS Safari unterstützt das nicht durchgängig, siehe
  Umsetzungshinweis unten). Bei Mobilfunk wartet die Warteschlange und sagt das.
- Fehlgeschlagene Uploads einzeln mit „Erneut versuchen", nicht als Alles-oder-nichts.
- Grenzen: maximal 50 MB je Datei, 30 Dateien je Vorgang, nur `image/*`. Der MIME-Typ wird
  **serverseitig über die Magic Bytes** geprüft (nicht über die Dateiendung) - dasselbe Muster
  wie die kürzlich gehärtete Wappen-Upload-Prüfung (Security-Review S3), nur diesmal mit HEIC
  zusätzlich zur bestehenden PNG/JPEG/WebP/GIF-Allowlist.

**Umsetzungshinweis zur Network Information API**: iOS Safari (und damit die iOS-PWA) unterstützt
`navigator.connection` nicht. Für diese Plattform gibt es keine zuverlässige
"WLAN-oder-Mobilfunk"-Erkennung im Browser - die Warteschlange fällt dort auf "immer sofort
starten" zurück (der Schalter existiert weiterhin und der Nutzer kann ihn aktiv lassen, er wird
auf iOS nur nicht automatisch durchgesetzt). Das ist eine reale Plattformgrenze, keine
Implementierungslücke - wird im Sheet-Text nicht gesondert erwähnt, aber im Code kommentiert.

## 6. Bildschirme

### 6.1 Startbildschirm „Meine Feuerwehr" — neuer Block

Nach Atemschutz und Fuhrpark, nur bei mindestens einem Einsatz mit `alarmedAt >= now() - 24h`
(absteigend sortiert) — **ohne Einsatz in diesem Fenster entfällt der ganze Block**, kein
Platzhalter. Pro Einsatz-Karte: Art-Chip, Zeit, Stichwort, Ort, bis zu 4 Foto-Vorschauen (letzte
Kachel „+N" bei mehr), „Fotos hinzufügen"-Button in der Karte. Ohne Fotos: leere Ablage mit
„Noch keine Fotos vorhanden." „Einsatz erfassen" als umrandeter 48px-Button oben im Screen,
direkt unter dem nächsten Termin, nur für Berechtigte (serverseitig geprüft, clientseitig
ausgeblendet). Scrollbereich braucht `padding-bottom` = Tab-Bar-Höhe + Safe Area (bestehendes
`.pb-safe-tabbar`/`.pb-content-safe`-Muster aus `globals.css` wiederverwenden, siehe root
CLAUDE.md „V2").

### 6.2 Einsatz erfassen

Formularseite, Felder: Einsatzart (2×2-Raster, 44px), Einsatzstichwort (Freitext), Ort (Freitext),
Datum/Alarm/Ende (dreispaltig, Zeiten in `font-mono`), Fahrzeuge (Mehrfachauswahl-Chips, nur
Fahrzeuge der eigenen Wehr), Mannschaft (Anzahl + optionale Personenauswahl). Fußzeile fix:
„Einsatz speichern" (52px, brand). Feststellungstext unter dem Formular (keine Checkbox): „Jedes
Mitglied der Feuerwehr {Name} darf Fotos zu diesem Einsatz hochladen und die eigenen wieder
löschen." Validierung: `endedAt > alarmedAt`, `alarmedAt` nicht in der Zukunft — Fehler unter dem
Feld, kein Toast.

### 6.3 Sheet „Fotos hinzufügen"

Bottom Sheet: `Foto aufnehmen` / `Aus der Fotobibliothek` / `Aus Dateien`. Zwei Schalterzeilen:
„Nur über WLAN übertragen" (an, Untertext „Originale sind 4-12 MB groß"), „Für
Öffentlichkeitsarbeit freigeben" (aus). Warnhinweis (`warning-subtle`): „Fotos werden unverändert
gespeichert - samt Aufnahmezeit und, falls im Bild vorhanden, Standortdaten. Bei Personen und
Kennzeichen gilt die Datenschutzregelung der Wehr." Primäraktion: „{n} Fotos übertragen".

### 6.4 Einsatz-Detail

Kopf (Art-Chip, Datum, Stichwort, Ort), Faktenraster (Alarm/Dauer/Mannschaft), Upload-Karte nur
während laufender Übertragung, „Fotos {n}" mit „+ Hinzufügen", Raster dreispaltig
(`aspect-ratio: 1`, 6px Gap): eigene Fotos rotes Initialen-Kürzel + Löschkreuz, fremde Fotos
graues Kürzel ohne Kreuz, laufende Uploads als Spinner-Kachel, letzte Kachel „+". Legende
darunter. Einzelbild-Ansicht: Uploader, Aufnahmezeit, Dateigröße, „Original herunterladen",
Freigabe-Schalter, „Löschen" (eigene) — mit Rückfrage, entfernt Original + alle abgeleiteten
Größen aus dem Bucket UND die DB-Zeile.

## 7. Umsetzungsreihenfolge

1. Migration `Incident`/`IncidentVehicle`/`IncidentPhoto` + Berechtigungsfunktionen
2. Einsatz anlegen/bearbeiten/löschen inkl. serverseitiger Rechteprüfung (kein Foto-Bezug nötig)
3. S3-Client-Modul für den neuen Bucket + Presign-/Complete-Route
4. Download-Route (Presigned-GET-Redirect, Abschnitt 4.2)
5. Upload-Warteschlange (IndexedDB, Fortschritt, Pause, WLAN-Regel, Abschnitt 5)
6. Vorschau-Ableitung im `complete`-Schritt (Thumbnail + Ansicht, `sharp`)
7. Einsatz-Detail mit Galerie, Löschen, Freigabe
8. 24-Stunden-Block auf dem Startbildschirm „Meine Feuerwehr"
9. Cron-Aufräumung verwaister `PENDING`-Datensätze (>24h)
10. Einsatzliste zum Nachtragen älterer Einsätze (Brief nennt dies als letzten Schritt, kein
    eigener Bildschirm-Abschnitt im Brief spezifiziert - Umsetzungsplan legt die konkrete Form fest)

## 8. Abnahmekriterien (aus dem Brief übernommen)

- [ ] Ein 11-MB-HEIC-Foto liegt nach dem Upload byteidentisch im Storage.
- [ ] Der Download liefert das Original, nicht die Vorschau.
- [ ] Acht Fotos gleichzeitig: Fortschritt in MB, pausierbar, App-Wechsel bricht nichts ab.
- [ ] Über Mobilfunk wartet die Warteschlange und sagt warum (außer iOS, siehe Abschnitt 5).
- [ ] Ein einzelner Fehlschlag lässt die übrigen sieben durchlaufen.
- [ ] Jedes Mitglied kann hochladen; niemand kann fremde Fotos löschen außer Admins.
- [ ] Ein Mitglied einer anderen Wehr bekommt beim Direktaufruf 404.
- [ ] Ohne Einsatz in 24 Stunden fehlt der Block auf dem Startbildschirm vollständig.
- [ ] Die letzte Karte liegt nicht unter der Tab-Bar.
- [ ] Kein Foto ist über eine dauerhafte/öffentliche URL erreichbar (Chat-Entscheidung, Abschnitt 4).
