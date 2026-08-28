# Formular-Vorschläge (Login-E-Mail, Ort-Felder) — Design

## Ziel

Drei Formularfelder sollen frühere Eingaben vorschlagen, statt jedes Mal leer zu starten:
Login-E-Mail und die "Ort"-Felder im Drohnenflug- und im Kalender-Termin-Formular.

## Scope

**In Scope:**
- Login-E-Mail (Passwort-Modus + die beiden E-Mail-Token-Modi, alle drei teilen sich bereits einen
  gemeinsamen `tokenEmail`-State bzw. bekommen jetzt einen) — merkt **genau einen** Wert.
- `location` in `src/components/drone/flight-form.tsx` — merkt bis zu **8** zuletzt verwendete,
  unterschiedliche Orte, eigener Verlauf.
- `location` in `src/components/calendar/event-form.tsx` — ebenfalls bis zu **8**, aber ein
  **eigener, getrennter** Verlauf (Drohnenflugplätze und allgemeine Termin-Orte unterscheiden sich
  typischerweise).

**Explizit außerhalb des Umfangs:**
- Passwort-Autofill — bleibt Sache von Androids eigenem Passwort-Manager, wird hier nicht
  nachgebaut (Sicherheitsrisiko, eigene Passwort-Speicherung zu bauen).
- Weitere Formulare/Freitextfelder (z. B. "Anmerkungen") — kann bei Bedarf später ergänzt werden,
  gleiche Infrastruktur.

## Mechanismus

Eine neue, kleine, wiederverwendbare Utility `src/lib/remembered-values.ts`:
- `getRememberedValues(key: string): string[]` — liest die gespeicherte Liste (neuester Wert
  zuerst), leeres Array bei fehlendem/kaputtem Eintrag.
- `rememberValue(key: string, value: string, max = 8): void` — trimmt, verwirft leere Werte,
  entfernt Duplikate (exakter Match), setzt den Wert an die erste Stelle, kappt auf `max`.

Reines `localStorage`, geräte-lokal (kein Server-Roundtrip, keine DB-Spalte), `try/catch`-geschützt
wie die bestehenden `NATIVE_PUSH_ENABLED_KEY`-Flags in dieser App — ein Fehler (privater Modus o. ä.)
darf nie die eigentliche Formular-Aktion blockieren.

Anzeige über natives HTML5 `<datalist>` (Browser-eigene Vorschlagsliste beim Tippen, filtert
automatisch, kein eigenes Dropdown-Component nötig).

## Login (`src/app/(auth)/login/login-form.tsx`)

Aktuell: das Passwort-Modus-E-Mail-Feld ist unkontrolliert (`name="email"` ohne `value`), die beiden
Token-Modus-Felder teilen sich bereits einen `tokenEmail`/`setTokenEmail`-State. Wird zu **einem**
gemeinsamen `email`/`setEmail`-State für alle drei Felder (Umbenennung von `tokenEmail`, da der Name
sonst irreführend wäre, sobald er auch das Passwort-Feld treibt) — Passwort-Modus-Feld wird dadurch
kontrolliert.

- Beim Mount (`useEffect`): `getRememberedValues(LOGIN_EMAIL_KEY)[0]` lädt den einzigen gemerkten
  Wert (falls vorhanden) in den `email`-State.
- Jedes der drei `<form>`-Elemente bekommt zusätzlich zu seinem bestehenden `action` ein
  `onSubmit={() => rememberValue(LOGIN_EMAIL_KEY, email, 1)}` — reine Nebenwirkung, blockiert/
  verändert die eigentliche Server-Action-Übermittlung nicht. Wird bei jedem Absenden geschrieben,
  nicht erst bei Erfolg — bei nur einem gemerkten Wert unkritisch, ein Tippfehler wird beim nächsten
  echten Login-Versuch ohnehin überschrieben.
- **Passwort bleibt komplett unberührt** — kein neuer State, kein Speichern, keine Änderung an
  `autoComplete="current-password"`.

## Ort-Felder (`flight-form.tsx`, `event-form.tsx`)

Identisches Muster an beiden Stellen, mit je eigenem Storage-Key:

- Neuer `locations`-State (`useState<string[]>([])`), beim Mount aus
  `getRememberedValues(<KEY>)` befüllt.
- Das bestehende `<input {...register('location')} />` bekommt zusätzlich
  `list="<datalist-id>"`; ein neues `<datalist id="<datalist-id>">{locations.map(...)}</datalist>`
  wird irgendwo im Formular gerendert (unsichtbares Element, Position egal).
- Im bestehenden `onSubmit(values)`-Handler: **nach** erfolgreichem `action(...)`-Aufruf (also wenn
  `!result?.error`) wird `rememberValue(<KEY>, values.location, 8)` aufgerufen — anders als beim
  Login wird hier nur bei tatsächlichem Erfolg gemerkt, damit Tippfehler nicht dauerhaft in der
  (mit bis zu 8 Werten deutlich sichtbareren) Vorschlagsliste landen.

## Fehlerbehandlung

Jeder `localStorage`-Zugriff einzeln `try/catch`-geschützt (Lesen wie Schreiben) — ein Fehler wird
nie nach oben durchgereicht, die Formulare funktionieren identisch weiter, nur ohne
Vorschlag/Merken für diese eine Sitzung.

## Testing

Kein automatisierter Test-Suite im Projekt (projektweite Konvention). Verifikation: `npx tsc --noEmit`,
`npm run build`, plus manuelle Prüfung im Browser (Login-Formular zweimal absenden, prüfen dass die
E-Mail beim zweiten Laden vorausgefüllt ist; Drohnenflug/Termin zweimal mit unterschiedlichem Ort
anlegen, prüfen dass beide als Datalist-Vorschlag erscheinen).
