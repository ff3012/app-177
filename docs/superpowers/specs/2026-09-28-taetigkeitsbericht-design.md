# Tätigkeitsbericht (Berichte) in „Meine Feuerwehr" — Design

## 0. Herkunft

Ursprung: `Bericht-Brief.md` (Claude Design, Projekt `cabb2cb1-85d4-4829-a3a4-eb667d733949`), plus zwei
Referenzdateien: `Taetigkeitsbericht_SAMPLE.pdf` (Mock-up des App-eigenen Belegs) und
`Tätigkeitsbericht_VORLAGE.docx` (offizielles NÖ-Landesfeuerwehrverband-Formular, **verbindliche Quelle**
für Tätigkeitsarten/Verbrauchsmaterial/Geräte laut Brief). Dieses Dokument übersetzt das Brief auf die
echte Codebase und hält jede Abweichung/Korrektur fest, die während des Abgleichs gefunden wurde.

## 1. Korrekturen gegenüber dem Brief

Diese Punkte wurden geprüft und weichen vom Brief-Wortlaut ab — mit dem App-Betreiber abgestimmt:

1. **`react-pdf` ist KEINE bestehende Abhängigkeit** (Brief: "bestehend react-pdf") — `package.json` enthält
   keine PDF-Bibliothek. Wird als neue Abhängigkeit `@react-pdf/renderer` ergänzt.
2. **„HomeFireDepartment"** entspricht dem bestehenden `Organization`-Modell — das Relationsnamensmuster
   `fireDepartmentId`/`fireDepartment: Organization` existiert bereits identisch bei `PhotoUpload`, passt
   also direkt.
3. **Reservierungsende-Auslöser** (Brief nennt nur das Ergebnis, nicht den Mechanismus): neuer periodischer
   Cron-Job, gleiches Muster wie `photo-cleanup`/`atemschutz-warnung` (bestätigt).
4. **E-Mail-Versand**: best-effort, **kein** Retry-Job (Brief: "Versand als Job mit Retry") — entspricht
   damit exakt dem bestehenden Muster jeder anderen E-Mail in dieser App (try/catch, nie blockierend). Die
   Verwaltungsseite zeigt trotzdem einen Status pro Bericht (gesendet/fehlgeschlagen), nur ohne automatische
   Wiederholung (bestätigt).
5. **Mitgliedersuche**: wird als neue, echte Such-Combobox gebaut (nicht das bestehende einfache
   `<select>`-Muster aus dem Fahrzeug-Buchungsformular) — näher am Brief-Wortlaut „Mitgliedersuche"
   (bestätigt).
6. **„Funktion"-Liste**: nicht in Brief oder Vorlage enumeriert. Bestätigte Liste: **Kommandant, Fahrer,
   Mannschaft**.
7. **Tätigkeitsart-Liste**: Brief sagt "alle 38 Tätigkeitsarten", die Vorlage enthält bei genauer
   Formularfeld-Analyse (`FORMCHECKBOX`-Felder, nicht nur Text) tatsächlich **39** wählbare Codes plus einen
   separaten Freitext-Fallback „Sonstige". Siehe §4 für die vollständige, geprüfte Liste. „Feuerwehrjugend"
   selbst ist keine eigene Checkbox, nur eine Gruppenüberschrift über 7 Unterpunkten (bestätigt). Das
   Vorlagen-Exemplar zeigt „Journaldienst Purkerdorf" — „Purkerdorf" ist eine ortsspezifische Notiz dieses
   einen (Purkersdorfer) Formularexemplars, im Bezirk-17-weiten Text heißt die Kategorie nur „Journaldienst"
   (bestätigt).
8. **Kein Mitglieder-Raster in der offiziellen Vorlage**: „Eingesetzte Mitglieder" (Name/Stb/Funktion) kommt
   in der offiziellen Papiervorlage nicht vor — das ist eine reine App-Ergänzung (wie auch im Sample-PDF zu
   sehen). Ändert nichts am Brief-Vorhaben, nur zur Einordnung.

## 2. Datenmodell

Übernimmt die Brief-Struktur mit an dieser Codebase üblichen Namen/Konventionen:

```prisma
enum ReportType   { ACTIVITY  EXERCISE  INCIDENT }
enum ReportStatus { DRAFT  SUBMITTED }
enum ReportMemberFunktion { KOMMANDANT  FAHRER  MANNSCHAFT }

model Report {
  id               String       @id @default(cuid())
  number           Int?         // erst bei Abgabe vergeben, siehe §7 - beide nullable, gemeinsam gesetzt
  year             Int?         // erst bei Abgabe vergeben (Kalenderjahr von submittedAt, siehe §7)
  type             ReportType
  status           ReportStatus @default(DRAFT)
  fireDepartmentId String
  fireDepartment   Organization @relation(fields: [fireDepartmentId], references: [id])
  vehicleBookingId String?      @unique
  vehicleBooking   VehicleBooking? @relation(fields: [vehicleBookingId], references: [id], onDelete: SetNull)
  filledById       String       // Ausfüller, darf ≠ Ersteller sein
  filledBy         User         @relation("ReportFilledBy", fields: [filledById], references: [id])
  createdById      String
  createdBy        User         @relation("ReportCreatedBy", fields: [createdById], references: [id])
  startAt          DateTime
  endAt            DateTime
  ownActivity      Boolean?     // "Eigene Tätigkeit" - nullable bis Pflichtfeld befüllt (Entwurf)
  activityKinds    String[]     // Codes aus ACTIVITY_KINDS, siehe §4
  activityOther    String?      // Freitext zu "Sonstige"
  vehicleId        String?
  vehicle          Vehicle?     @relation(fields: [vehicleId], references: [id])
  vehicleKm        Int?
  remark           String?      // Pflicht nur bei Abgabe, nullable im Entwurf
  emailSentAt      DateTime?
  emailError       String?
  submittedAt      DateTime?
  createdAt        DateTime     @default(now())
  updatedAt        DateTime     @updatedAt

  members   ReportMember[]
  materials ReportQuantity[]

  @@unique([fireDepartmentId, year, number])
  @@index([fireDepartmentId, status])
}

model ReportMember {
  id       String @id @default(cuid())
  reportId String
  report   Report @relation(fields: [reportId], references: [id], onDelete: Cascade)
  userId   String
  user     User   @relation(fields: [userId], references: [id])
  funktion ReportMemberFunktion

  @@unique([reportId, userId])
}

enum ReportQuantityKind { MATERIAL  EQUIPMENT }

model ReportQuantity {
  id       String              @id @default(cuid())
  reportId String
  report   Report              @relation(fields: [reportId], references: [id], onDelete: Cascade)
  kind     ReportQuantityKind
  code     String              // Code aus MATERIALS/EQUIPMENT, siehe §4
  value    Decimal

  @@unique([reportId, kind, code])
}
```

`Organization.reportRecipients String[] @default([])` (analog `fahrzeugReservierungEmails`/
`photoUploadNotificationEmails`).

Alle Pflichtfelder des fertigen Formulars (`ownActivity`, `activityKinds` min. 1 Eintrag ODER `activityOther`,
`remark`) sind im Prisma-Schema **nullable/optional**, weil ein `DRAFT` unvollständig sein darf — die
Pflicht wird ausschließlich serverseitig bei der Abgabe (§6) erzwungen, gleiches Muster wie
`VehicleBooking.details`/`stbNr` an anderer Stelle dieser Codebase (nullable Spalte, Pflicht nur im
Formular/Server-Action).

## 3. Fortlaufende Nummerierung

Prisma hat kein natives "auto-increment scoped by two columns". Löse über eine eigene Zähler-Tabelle statt
`MAX(number)+1` (race-anfällig ohne explizites Row-Lock, das über den Prisma-Client nicht ausdrückbar ist):

```prisma
model ReportSequence {
  fireDepartmentId String
  year             Int
  lastNumber       Int    @default(0)

  @@id([fireDepartmentId, year])
}
```

`getNextReportNumber(fireDepartmentId, year)` innerhalb der Abgabe-Transaktion (§6):
`prisma.reportSequence.upsert({ where: {...}, create: { ..., lastNumber: 1 }, update: { lastNumber: { increment: 1 } } })`,
liefert `lastNumber` als neue `number`. Postgres serialisiert konkurrierende `upsert`s auf denselben
Primärschlüssel automatisch (Row-Lock durch die `INSERT ... ON CONFLICT`-Umsetzung) — keine Lücken, keine
Duplikate, auch bei zwei gleichzeitigen Abgaben derselben Feuerwehr im selben Jahr.

## 4. Konstanten (wortgetreu aus der Vorlage, siehe §1 Punkt 7)

`src/lib/heimatfeuerwehr/report-constants.ts`:

```typescript
export interface ActivityKindOption {
  code: string;
  label: string;
  group?: 'FEUERWEHRJUGEND';
}

export const ACTIVITY_KINDS: ActivityKindOption[] = [
  { code: 'ATEMSCHUTZ', label: 'Atemschutz' },
  { code: 'AUSBILDUNG', label: 'Ausbildung' },
  { code: 'AUSUEBUNG_DIENSTAUFSICHT', label: 'Ausübung der Dienstaufsicht' },
  { code: 'BERATUNG_BEHOERDEN', label: 'Beratung der Behörden' },
  { code: 'CHARGENSITZUNG', label: 'Chargensitzung' },
  { code: 'DIENSTBESPRECHUNG', label: 'Dienstbesprechung' },
  { code: 'EDV', label: 'EDV' },
  { code: 'FAHRZEUG_GERAETEDIENST_FAHRMEISTER', label: 'Fahrzeug u. Gerätedienst / Fahrmeister' },
  { code: 'FAHRZEUG_GERAETEDIENST_ZEUGMEISTER', label: 'Fahrzeug u. Gerätedienst / Zeugmeister' },
  { code: 'FEUERWEHRBALL', label: 'Feuerwehrball' },
  { code: 'FEUERWEHRFEST', label: 'Feuerwehrfest' },
  { code: 'FEUERWEHRMEDIZINISCHER_DIENST', label: 'Feuerwehrmedizinischer Dienst' },
  { code: 'FJ_ALLG_JUGENDARBEIT', label: 'Allg. Jugendarbeit', group: 'FEUERWEHRJUGEND' },
  { code: 'FJ_FACHLICHE_AUSBILDUNG', label: 'feuerwehrfachliche Ausbildung', group: 'FEUERWEHRJUGEND' },
  { code: 'FJ_EIGENE_VERANSTALTUNG', label: 'Eigene Veranstaltung', group: 'FEUERWEHRJUGEND' },
  { code: 'FJ_HAUS_DER_NOE_FJ', label: 'Haus der NÖ FJ', group: 'FEUERWEHRJUGEND' },
  { code: 'FJ_SELBST_VERANSTALTETE_LAGER', label: 'selbst veranstaltete Lager', group: 'FEUERWEHRJUGEND' },
  { code: 'FJ_BEZIRKS_ABSCHNITTSLAGERTEILNAHME', label: 'Bezirks/Abschnittslagerteilnahme', group: 'FEUERWEHRJUGEND' },
  { code: 'FJ_LANDESLAGERTEILNAHME', label: 'Landeslagerteilnahme', group: 'FEUERWEHRJUGEND' },
  { code: 'INSPEKTION', label: 'Inspektion' },
  { code: 'JOURNALDIENST', label: 'Journaldienst' },
  { code: 'KIRCHGANG', label: 'Kirchgang' },
  { code: 'KOMMANDOBESPRECHUNG', label: 'Kommandobesprechung' },
  { code: 'MITGLIEDERVERSAMMLUNG', label: 'Mitgliederversammlung' },
  { code: 'NACHRICHTENDIENST', label: 'Nachrichtendienst' },
  { code: 'OEFFENTLICHKEITSARBEIT_DOKUMENTATION', label: 'Öffentlichkeitsarbeit und Dokumentation' },
  { code: 'REPRAESENTATION', label: 'Repräsentation' },
  { code: 'SCHADSTOFFDIENST', label: 'Schadstoffdienst' },
  { code: 'SCHRIFTVERKEHR', label: 'Schriftverkehr' },
  { code: 'SONSTIGE_FEUERWEHRTAETIGKEITEN', label: 'sonstige Feuerwehrtätigkeiten' },
  { code: 'SPRENGDIENST', label: 'Sprengdienst' },
  { code: 'STRAHLENSCHUTZDIENST', label: 'Strahlenschutzdienst' },
  { code: 'TAETIGKEIT_IM_FEUERWEHRHAUS', label: 'Tätigkeit im Feuerwehrhaus' },
  { code: 'VERANSTALTUNGEN', label: 'Veranstaltungen' },
  { code: 'VERWALTUNGSTAETIGKEITEN', label: 'Verwaltungstätigkeiten' },
  { code: 'VORBEUGENDER_BRANDSCHUTZ', label: 'Vorbeugender Brandschutz' },
  { code: 'VORTRAEGE_SCHULUNGEN', label: 'Vorträge/Schulungen' },
  { code: 'WARTUNGSARBEITEN', label: 'Wartungsarbeiten' },
  { code: 'WASSERDIENST', label: 'Wasserdienst' },
];
// 39 fixe Codes. "Sonstige" (Freitext -> activityOther) ist bewusst NICHT Teil dieser Liste - eigener
// Mechanismus in der UI (§5) und im PDF-Ausdruck (§7), kein ACTIVITY_KINDS-Code.

export interface QuantityOption {
  code: string;
  label: string;
  unit: 'LITER' | 'SAECKE' | 'STUECK' | 'BETRIEBSSTUNDEN';
}

export const MATERIALS: QuantityOption[] = [
  { code: 'WASSER', label: 'Wasser', unit: 'LITER' },
  { code: 'SCHAUMMITTEL', label: 'Schaummittel', unit: 'LITER' },
  { code: 'BIOVERSAL', label: 'Bioversal', unit: 'LITER' },
  { code: 'OELBINDEMITTEL', label: 'Ölbindemittel', unit: 'SAECKE' },
  { code: 'PLANEN', label: 'Planen', unit: 'STUECK' },
  { code: 'NASSLOESCHER', label: 'Nasslöscher', unit: 'STUECK' },
  { code: 'SCHAUMLOESCHER', label: 'Schaumlöscher', unit: 'STUECK' },
  { code: 'PULVERLOESCHER', label: 'Pulverlöscher', unit: 'STUECK' },
  { code: 'CO2_LOESCHER', label: 'CO2 Löscher', unit: 'STUECK' },
];
// 9 Positionen. Die 4 Löscher-Codes werden in der UI (§5) als ein Chip "+ Löscher (4)" zusammengefasst.
export const LOESCHER_CODES = ['NASSLOESCHER', 'SCHAUMLOESCHER', 'PULVERLOESCHER', 'CO2_LOESCHER'];

export const EQUIPMENT: QuantityOption[] = [
  { code: 'ATEMSCHUTZGERAETE', label: 'Atemschutzgeräte', unit: 'STUECK' },
  { code: 'HYDR_RETTUNGSGERAET', label: 'Hydr. Rettungsgerät', unit: 'STUECK' },
  { code: 'STROMA_125KVA', label: 'STROMA-125kVA', unit: 'BETRIEBSSTUNDEN' },
  { code: 'STROMA_60KVA', label: 'STROMA-60kVA', unit: 'BETRIEBSSTUNDEN' },
  { code: 'SPA_200', label: 'SPA-200', unit: 'BETRIEBSSTUNDEN' },
];
// 5 Positionen.
```

Diese Datei ist die **einzige** Quelle für Formular-UI (Checkboxen/Chips), Speicherung (`activityKinds`-Codes,
`ReportQuantity.code`) und PDF-Ausdruck (§7) — kann nie auseinanderlaufen.

## 5. Einstiege und Startseite

Wie im Brief §3/§4 beschrieben, mit konkreten Datei-/Komponentennamen:

- **Cron-Auslöser** (§1 Punkt 3): neuer `src/app/api/cron/report-drafts/route.ts` (secret-gated wie die
  übrigen Cron-Routen), alle ~15 Min: `VehicleBooking`-Zeilen mit `endsAt < now()`, `status = GENEHMIGT`
  und noch keinem verknüpften `Report` (`vehicleBookingId` ist `@unique`, also einfacher
  `findMany({ where: { endsAt: { lt: now }, status: 'GENEHMIGT', report: null } })`) erhalten automatisch
  einen `Report(DRAFT, type: ACTIVITY, vehicleBookingId, filledById: booking.userId, createdById:
  booking.userId, startAt: booking.startsAt, endAt: booking.endsAt, vehicleId: booking.vehicleId,
  fireDepartmentId: vehicle.organizationId)`.
- **„Neuer Bericht"-Kachel** (ohne Reservierung): `POST` Server Action `createReportDraft(type)` — legt
  sofort einen leeren `DRAFT` an (`filledById`/`createdById` = aktueller Benutzer, `startAt`/`endAt` = heute,
  `vehicleId: null`) und leitet zu Schritt 1 weiter. Öffnet zuerst das Sheet „Welcher Bericht?" (Brief §1b):
  `type='EXERCISE'`/`'INCIDENT'` sind auswählbar, aber ausgegraut/nicht antippbar ("Bald verfügbar") — reine
  UI-Sperre, das Datenmodell selbst unterstützt beide Typen schon (kein Migrationsaufwand später).
- **Startseite** (`meine-feuerwehr/page.tsx`): ersetzt den bestehenden Block
  (aktuell Zeilen 357-369, das einzelne "Foto Upload"-Button-Paar direkt nach `<HomeTodoList>`) durch das im
  Brief beschriebene 1:1-Grid „Neuer Bericht" (führt zum Berichtsart-Sheet) · „Foto Upload" (unverändert,
  gleicher Link/gleiche Berechtigung wie bisher). Direkt darunter, vor dem bestehenden
  `Fahrzeug Reservierungen`/`Flug registrieren`-Grid: „Zu erledigen"-Block (offene `Report(DRAFT)` mit
  `vehicleBookingId` des aktuellen Benutzers) und „Meine Berichte" (letzte 3 eigene Berichte, Status-Chip),
  beide bedingt gerendert wie im Brief beschrieben (kein Block, wenn leer).

## 6. Formular (3 Schritte)

Eigenständige Route `meine-feuerwehr/berichte/[reportId]/schritt-{1,2,3}` (Server Component pro Schritt,
liest/schreibt denselben `Report` per `updateReportDraft(reportId, patch)` Server Action, debounced
client-seitig wie im Brief gefordert — kein eigener Speichern-Button). Inhalte exakt wie Brief §5
beschrieben; Details, die das Brief offenlässt:

- **Mitgliedersuche**: neue Komponente `src/components/heimatfeuerwehr/member-search-select.tsx`
  (`MemberSearchSelect`, Einzelauswahl für „Ausfüller ändern") und `member-multi-select.tsx`
  (`MemberMultiSelect`, für „+ Mitglied hinzufügen" in Schritt 2) — Popover+Command-Combobox nach dem
  Muster von `org-search-select.tsx`/`admin-org-multiselect.tsx`, aber über `User` statt `Organization`
  gescoped auf `homeOrganizationId` der Feuerwehr des Berichts, gefiltert mit `NOT_DEACTIVATED_WHERE`.
- **Abweichung von der Reservierung** (Brief §5 Schritt 1): Vergleich der aktuellen `startAt`/`endAt`/
  `vehicleId` gegen die verknüpfte `VehicleBooking` (falls `vehicleBookingId` gesetzt) — nur relevant, wenn
  der Bericht aus Einstieg A stammt.
- **Verbrauchsmaterial/Geräte-Eingabe** (Schritt 3): `ReportQuantity`-Zeilen werden nur für tatsächlich
  befüllte Positionen angelegt (`value > 0`); Löscher-Codes gemeinsam über einen Chip „+ Löscher (4)"
  eingeblendet, aber als 4 einzelne `ReportQuantity`-Zeilen mit je eigenem Wert gespeichert.

## 7. Abgabe (Transaktion)

`submitReport(reportId)` Server Action, eine `prisma.$transaction`:

1. Serverseitige Pflichtfeld-Prüfung: `ownActivity !== null`, (`activityKinds.length > 0` ODER
   `activityOther` nicht leer), `remark` nicht leer, `vehicleId === null` ODER `vehicleKm !== null`.
   Fehlt etwas → Transaktion bricht ab, Fehlermeldung an die UI (keine Nummer vergeben, kein PDF).
2. `report.year` wird **beim Abgeben** aus `submittedAt`s Kalenderjahr gesetzt (`new Date().getFullYear()`),
   nicht aus `startAt` der Tätigkeit — eine Tätigkeit Ende Dezember, erst im Januar abgegeben, zählt damit
   für das neue Jahr. Klargestellt, da das Brief `year` nur als Feld nennt, ohne die Quelle zu spezifizieren.
3. `getNextReportNumber(fireDepartmentId, year)` (§3), `status = SUBMITTED`, `submittedAt = now()`.
3. Nach erfolgreichem Commit (außerhalb der Transaktion, da PDF-Erzeugung/S3-Upload/E-Mail keine
   DB-Operationen sind und die Transaktion nicht offen halten sollen): PDF erzeugen (§8), im Storage
   ablegen, E-Mail versenden (§9, best-effort siehe §1 Punkt 4) — `emailSentAt`/`emailError` danach separat
   per `update` geschrieben.

## 8. PDF (`@react-pdf/renderer`, neue Abhängigkeit)

`src/lib/heimatfeuerwehr/report-pdf.tsx` — Layout wie Vorlage (Brief §7), mit `ACTIVITY_KINDS`/`MATERIALS`/
`EQUIPMENT` aus §4 (immer **alle** Positionen zweispaltig/vierspaltig gedruckt, gewählte fett/☒ markiert —
"nicht nur die gewählten"). Dateiname `Taetigkeitsbericht_{Nr}_{JJJJMMTT}.pdf`, eine Seite A4.

**Speicherung**: neuer, eigener S3-Bucket-Client `src/lib/storage/report-pdf-s3.ts`, nach dem Muster von
`photo-uploads-s3.ts`, aber mit **eigenem** Bucket-Env-Var (`S3_REPORTS_BUCKET`) statt Wiederverwendung von
`S3_PHOTOS_BUCKET` — bewusst getrennt, weil Fotos einer 96-Stunden-Löschung unterliegen
(`photo-cleanup`-Cron) und Tätigkeitsberichte als offizielle Dokumente **dauerhaft** aufbewahrt werden
müssen, niemals automatisch gelöscht werden dürfen.

## 9. E-Mail

`src/lib/heimatfeuerwehr/notify-report-submitted.ts`, `sendEmail()` (`mailjet.ts`) erweitert um
`replyTo?: string` und `attachments?: { filename: string; contentType: string; content: Buffer }[]`
(Mailjet v3.1 unterstützt `ReplyTo`/`Attachments` nativ — kleine, in sich geschlossene Erweiterung der
bestehenden Funktion, keine neue Abhängigkeit). Ein Sende-Versuch, best-effort (§1 Punkt 4): Erfolg/Fehler
wird in `Report.emailSentAt`/`emailError` festgehalten und in der Verwaltungsseite (§10) angezeigt, aber
nicht automatisch wiederholt. Betreff/Text/Anhang wie Brief §8 exakt beschrieben.

## 10. Verwaltung „Berichte"

Neue Karte unter `/admin/heimatfeuerwehr` (gleiche Seite, gleiches Muster wie
„Fahrzeug-Reservierungen"/„Foto Upload Benachrichtigung"): `reportRecipients`-Chip-Liste + People-Picker
(wiederverwendet `PhotoUploadNotificationEmailsForm`s UI-Muster, eigene Server Action
`setReportRecipients`), plus eine Liste der zuletzt abgegebenen Berichte dieser Feuerwehr mit
Versand-Status (gesendet/fehlgeschlagen, aus `emailSentAt`/`emailError`) und Download-Link zum gespeicherten
PDF. Statusliste der drei Berichtsarten (Tätigkeitsbericht Aktiv, Übungs-/Einsatzbericht Nicht aktiv) als
einfache, hartkodierte Anzeige — kein Verwaltungs-Schalter, da die beiden anderen Typen ohnehin noch kein
eigenes Formular haben.

## 11. Berechtigungen

- `canCreateReportFor(user, organizationId)`: jedes Mitglied der eigenen Heimatfeuerwehr
  (`user.homeOrganizationId === organizationId`) — neue, kleine Funktion in `permissions.ts`.
- Entwürfe sichtbar für `createdById`/`filledById` — `canViewReport(user, report)`.
- Abgegebene Berichte zusätzlich sichtbar für `canManageHeimatfeuerwehrFor(user, report.fireDepartmentId)`
  (Admin der Feuerwehr) — reuse der bestehenden Funktion, kein neues Konzept.
- Abgegebene Berichte sind nicht mehr bearbeitbar (`status === 'SUBMITTED'` → jede Schreib-Server-Action
  lehnt ab) — Korrektur durch Admin ist ausdrücklich **nicht** Teil dieses Umfangs (Brief §9).

## 12. Umsetzungsreihenfolge

1. Migration (`Report`/`ReportMember`/`ReportQuantity`/`ReportSequence`/`Organization.reportRecipients`),
   Konstanten (§4), Nummernvergabe-Helfer (§3) — rein additiv, keine bestehenden Daten betroffen.
2. `mailjet.ts` um `replyTo`/`attachments` erweitern (isoliert, keine bestehenden Aufrufer betroffen).
3. `MemberSearchSelect`/`MemberMultiSelect`-Komponenten.
4. Formular-Wizard Schritt 1-3 inkl. Tätigkeitsart-Vollbildauswahl, Entwurf-Autospeichern.
5. Cron-Auslöser bei Reservierungsende + „Neuer Bericht"-Einstieg + Berichtsart-Sheet.
6. Abgabe-Transaktion, Nummernvergabe.
7. PDF-Erzeugung (`@react-pdf/renderer`) + neuer S3-Bucket-Client.
8. E-Mail-Versand best-effort.
9. Verwaltung „Berichte" + Startseite (Aktionsreihe, Zu erledigen, Meine Berichte).

## 13. Abnahme

Wie Brief §11, unverändert übernommen — alle zehn Kriterien gelten weiterhin, keines wird durch die
Korrekturen in §1 berührt.
