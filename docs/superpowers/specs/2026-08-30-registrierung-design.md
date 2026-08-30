# Registrierung (Selbst-Registrierung neuer Mitglieder) — Design

GitHub Issue: https://github.com/ff3012/app-177/issues/22

## Ziel

Ein neues Mitglied soll sich selbst über ein öffentliches Formular auf der Login-Seite für seine
Feuerwehr anmelden können, statt dass ausschließlich ein Admin das Konto manuell anlegt. Die Anfrage
landet in einer Warteschlange, die Admins der gewählten Feuerwehr werden per E-Mail benachrichtigt und
genehmigen/lehnen die Anfrage in der bestehenden Benutzerverwaltung ab. Bei Genehmigung entsteht ein
echtes Benutzerkonto über denselben Aktivierungs-Mail-Weg, den heute schon ein von einem Admin
angelegter Nutzer durchläuft.

## Scope

**In Scope:**
- Öffentliche Seite `/registrieren` (verlinkt von `/login`) mit Feuerwehr, Vorname, Nachname,
  Stammnummer, Dienstgrad, E-Mail, Bestätigungs-Checkbox.
- Neue `PendingRegistration`-Tabelle für offene Anfragen.
- IP-basierte Sperre nach 5 Einreichungen (15 Minuten Fenster, 15 Minuten Sperre).
- Benachrichtigungs-Mail an alle Admins der gewählten Feuerwehr (Fallback: alle Bezirksadmins, falls
  die Feuerwehr aktuell keinen eigenen Admin hat) + Bestätigungs-Mail an den Antragsteller.
- Neuer Abschnitt "Offene Registrierungen" in der Benutzerverwaltung mit Genehmigen/Ablehnen.
- Genehmigen erzeugt einen echten `User` über den bestehenden Admin-Invite-Codepfad (inkl.
  Aktivierungs-Mail); Ablehnen löscht die Anfrage kommentarlos.

**Explizit außerhalb des Umfangs:**
- E-Mail-Verifizierung der eingegebenen Adresse vor der Admin-Prüfung (der Admin prüft die Angaben
  ohnehin manuell).
- Automatischer Duplikat-Check auf Stammnummer (dafür existiert heute auch keine DB-Constraint) - der
  Admin erkennt Dubletten beim manuellen Prüfen.
- Historie abgelehnter/genehmigter Anfragen - eine `PendingRegistration`-Zeile existiert nur, solange
  sie offen ist.
- Ein Ein-Klick-Genehmigen-Link direkt in der E-Mail (wie bei Fahrzeug-Reservierungen) - die
  Genehmigung erzeugt ein echtes, zugriffsfähiges Benutzerkonto und soll daher nur im eingeloggten
  Adminbereich passieren, nicht über einen öffentlichen Capability-Link.

## Datenmodell

Zwei neue, additive Tabellen.

```prisma
model PendingRegistration {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  firstName      String
  lastName       String
  stbNr          String
  dienstgradId   String?
  dienstgrad     Dienstgrad?  @relation(fields: [dienstgradId], references: [id], onDelete: SetNull)
  email          String
  createdAt      DateTime     @default(now())

  @@index([organizationId])
}

model RegistrationAttempt {
  id             String    @id @default(cuid())
  ipAddress      String    @unique
  attemptCount   Int       @default(1)
  firstAttemptAt DateTime  @default(now())
  lockedUntil    DateTime?
  updatedAt      DateTime  @updatedAt
}
```

`PendingRegistration` ist bewusst eine eigene Tabelle statt einer Erweiterung von `User`: das
bestehende `isActive`/`passwordChangedAt`-Zwei-Felder-System (`src/lib/auth/user-status.ts`) bedeutet
heute schon etwas anderes ("von einem Admin eingeladen, noch nicht aktiviert" = `INAKTIV`) - eine
ungenehmigte Fremdanfrage dort einzuhängen würde `NOT_DEACTIVATED_WHERE` (und damit z. B. die
Atemschutz-Übersicht, die Piloten-Auswahl, jede Mitgliederliste) verunreinigen. Kein `status`-Feld auf
`PendingRegistration`, da eine Zeile nur existiert, solange sie offen ist - Genehmigen und Ablehnen
löschen sie beide (siehe unten).

`RegistrationAttempt` spiegelt `LoginAttempt`/`login-throttle.ts`'s Muster (atomarer `increment`,
5 Versuche, 15-Minuten-Fenster, 15-Minuten-Sperre), ist aber nach **IP-Adresse** statt E-Mail
geschlüsselt - eine echte, im Code bisher nicht existierende Neuerung, explizit vom Issue gefordert.

## Öffentliches Formular (`/registrieren`)

Neue Route, strukturell wie `/passwort-vergessen`: öffentliche Server-Component-Seite +
`'use server'`-Actions-Datei, kein Login nötig. Neuer Eintrag in `middleware.ts`'s
`PUBLIC_PATH_PREFIXES`.

- **Feuerwehr**: `OrgSearchSelect` (die bestehende Such-Combobox aus der Benutzerverwaltung, siehe
  GitHub Issue #13) statt eines flachen `<select>` mit den 124 Feuerwehren des Bezirks - die Seite lädt
  serverseitig alle aktiven `FEUERWEHR`-Organisationen und reicht sie als Prop durch, exakt wie die
  bestehende Admin-Seite es schon tut.
- **Dienstgrad**: `<select>` aus den 46 Zeilen der `Dienstgrad`-Tabelle, gruppiert nach `kategorie` -
  gleiche Datenquelle wie `UserFormSheet`s Dienstgrad-Auswahl.
- Vorname, Nachname, Stammnummer, E-Mail (alle Pflichtfelder), Checkbox "Ich bestätige, dass diese
  Angaben korrekt sind und ich Mitglied dieser Feuerwehr bin."
- `/login`'s `LoginForm` bekommt einen einfachen "Neu hier? Jetzt registrieren"-Link zu `/registrieren`.

## Server-Logik: Registrierung einreichen

`submitRegistration()` (`src/app/(auth)/registrieren/actions.ts`):

1. Client-IP lesen (`getClientIp()`, neuer Helper, liest den von Caddy weitergereichten
   `x-forwarded-for`-Header) und `checkRegistrationThrottle(ip)` prüfen - bei Sperre eine generische
   Fehlermeldung ("Zu viele Anfragen, bitte später erneut versuchen"), kein Unterschied zu anderen
   Fehlern in der UI.
2. Zod-Validierung aller Felder (neues `registrationSchema`, angelehnt an das bestehende
   `userSchema`).
3. Prüfen, ob die E-Mail bereits einem bestehenden `User` **oder** einer bereits offenen
   `PendingRegistration` gehört. In beiden Fällen wird **trotzdem** dieselbe generische
   Erfolgsmeldung angezeigt ("Anfrage eingegangen, wird geprüft") und nichts angelegt - kein
   Enumeration-Leak, gleiches Prinzip wie beim bestehenden Passwort-vergessen-Flow.
4. `PendingRegistration` anlegen, `recordRegistrationAttempt(ip)` erhöhen.
5. Zwei E-Mails, beide best-effort (try/catch, nie blockierend - gleiches Prinzip wie jeder andere
   E-Mail-Versand in dieser Codebase):
   - **An den Antragsteller**: Bestätigung, dass die Anfrage bei der gewählten Feuerwehr zur Prüfung
     eingegangen ist.
   - **An die Admins der gewählten Feuerwehr**: `prisma.membership.findMany({ where: {
     organizationId, role: 'ADMIN' }, include: { user: { select: { email: true, firstName: true } }
     } })` - eine E-Mail pro Empfänger (nie gemeinsames To/Cc, gleiches Prinzip wie
     `sendVehicleBookingApprovalRequest`). Liefert diese Abfrage keine Treffer, geht dieselbe Mail
     stattdessen an alle Nutzer mit `isBezirksAdmin: true`. Die Mail verlinkt auf `/admin/benutzer`
     (kein Ein-Klick-Token-Link) - der Admin muss eingeloggt sein, um zu genehmigen.

## Admin-Genehmigung (Benutzerverwaltung)

Neuer Abschnitt "Offene Registrierungen" in `/admin/benutzer`, sichtbar für jeden, der die
betreffende Organisation laut der dortigen bestehenden Scoping-Logik verwalten darf. Jede Zeile zeigt
Name/Stammnummer/Dienstgrad/E-Mail/Feuerwehr und zwei Aktionen:

- **Genehmigen** (`approveRegistration`): legt einen echten `User` an - **kein neuer Code-Pfad**,
  sondern dieselbe Logik wie die bestehende `createUser()` (Zufalls-Passwort, `isActive: false`,
  `ACTIVATION`-Token, Aktivierungs-Mail), gespeist aus den Werten der `PendingRegistration`-Zeile.
  Löscht die Zeile danach. Schlägt fehl (Fehlermeldung, Zeile bleibt bestehen), falls die E-Mail
  zwischenzeitlich durch eine andere Genehmigung/Registrierung vergeben wurde.
- **Ablehnen** (`rejectRegistration`): löscht die Zeile sofort, ohne Benachrichtigung an den
  Antragsteller.

## Fehlerbehandlung

- IP gesperrt → generische Meldung, kein Unterschied zu anderen Fehlerfällen in der UI.
- E-Mail bereits vergeben (bestehender `User` oder offene `PendingRegistration`) → gleiche
  Erfolgsmeldung wie bei echtem Erfolg, nichts wird angelegt.
- E-Mail-Versand (Bestätigung oder Admin-Benachrichtigung) schlägt fehl → geloggt, blockiert nie die
  Anfrage selbst.
- Genehmigen einer Anfrage, deren E-Mail zwischenzeitlich vergeben wurde → Fehler, Zeile bleibt
  bestehen statt eines stillen Duplikats.

## Testing

Kein automatisierter Test-Suite im Projekt. Verifikation: `npx tsc --noEmit`, `npm run build`, plus
manuelle Prüfung gegen die lokale Dev-Datenbank - Registrierung einreichen, Admin-Mail-Trigger prüfen
(inkl. Bezirksadmin-Fallback bei einer Feuerwehr ohne eigenen Admin), Genehmigen erzeugt einen echten
`User` inkl. funktionierendem Aktivierungs-Link, Ablehnen löscht sauber, und die IP-Sperre greift nach
5 Versuchen und läuft nach 15 Minuten automatisch wieder ab.
