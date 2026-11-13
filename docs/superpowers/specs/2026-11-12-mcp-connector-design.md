# MCP-Connector für Claude und ChatGPT — Design

## Ziel

Benutzer mit dem Recht "MCP Permissions Read" oder "MCP Permissions Write" können die App über einen
MCP-Connector (Model Context Protocol) in Claude (claude.ai, Desktop, Code) und ChatGPT verwenden. Der
Connector beantwortet Abfragen zu Benutzerverwaltung, Drohnengruppe, Kalender und Atemschutzstatus und kann
(mit "Write") neue Benutzer anlegen.

## Entscheidungen (mit dem App-Betreiber geklärt)

1. **Datenumfang wie in der App.** Das MCP-Recht ist nur der Schalter für den Connector. Welche Daten ein
   Benutzer über MCP sieht, bestimmen ausschließlich die bestehenden Rechtefunktionen
   (`lib/auth/permissions.ts`). Es gibt kein zweites Rechtesystem.
2. **Rechtevergabe auch durch Abschnitts- und Feuerwehr-Admins** (nicht nur Bezirksadmin), mit
   Obergrenze, siehe "Rechtemodell".
3. **`create_user` mit Rollen**, nicht nur Stammdaten. Bewusst ausgeschlossen (Vorschlag des Entwurfs,
   bestätigt): `isBezirksAdmin`, `isBezirksDrohnenAdmin` und `mcpAccess` lassen sich über MCP nie setzen.

## Nicht-Ziele

- Kein Ändern oder Löschen bestehender Benutzer, keine Termine, Flüge, Berichte oder Nachrichten über MCP.
- Keine Kalender-, Flug- oder Atemschutz-Schreibaktionen.
- Keine eigene Kontoverwaltung für Connector-Benutzer: Anmeldung läuft über die normalen App-Konten.
- Kein statisches Bearer-Token als Anmeldeweg (Claude und ChatGPT nutzen OAuth).

## Architektur

- **Ein Endpunkt in der bestehenden Next.js-App:** `POST/GET /api/mcp` (MCP über Streamable HTTP,
  zustandslos) mit dem offiziellen `@modelcontextprotocol/sdk`. Kein zweiter Dienst, kein neuer Container,
  dieselbe Domain (`AUTH_URL`) und derselbe Caddy.
- **OAuth-Server in der App** (Authorization Code + PKCE S256), weil Auth.js selbst kein OAuth-Server ist.
  Claude-Connectoren und ChatGPT Developer Mode verwenden OAuth; ein statisches Bearer-Token ist in der
  ChatGPT-Oberfläche nicht vorgesehen.
- **Ablauf pro MCP-Anfrage:**
  1. `Authorization: Bearer <token>` lesen, SHA-256 bilden, `OauthToken` suchen (nicht abgelaufen, nicht
     widerrufen).
  2. Benutzer **live aus der Datenbank** laden (`findUserWithRelationsById`) und mit `buildSessionUser`
     das übliche `SessionUser`-Objekt bauen — derselbe Weg wie der `jwt()`-Callback in `auth.config.ts`.
     Deaktivierte oder gelöschte Benutzer werden abgelehnt.
  3. `mcpAccess` prüfen (`NONE` → 403, Lesewerkzeug braucht `READ`, Schreibwerkzeug `WRITE`).
  4. Werkzeug ausführen; es ruft die bestehenden Rechtefunktionen mit diesem `SessionUser` auf.
- Entzogene Rechte, geänderte Zuständigkeiten und Deaktivierung wirken dadurch sofort, auch bei noch
  gültigem Token.
- **Middleware (`src/middleware.ts`):** öffentlich werden `/api/mcp`, `/oauth/token`, `/oauth/register`
  und `/.well-known/`. `/oauth/authorize` bleibt geschützt und leitet über den normalen Login um
  (`callbackUrl`).

## Rechtemodell

- Neues Feld `User.mcpAccess` (Enum `McpAccess`: `NONE` Standard, `READ`, `WRITE`). `WRITE` schließt `READ`
  ein. Ein Feld statt zwei Schaltern verhindert den ungültigen Zustand "Write ohne Read".
- Neue Funktion `canGrantMcpAccess(currentUser, viewerAccess, target, newLevel)` in `permissions.ts` (`viewerAccess` ist die eigene MCP-Stufe des Aufrufers, aus der Datenbank gelesen):
  - Bezirksadmin darf jede Stufe an jeden vergeben.
  - Abschnitts-/Feuerwehr-Admin nur, wenn `canManageUsersFor(user, target.homeOrganizationId)` gilt **und**
    sowohl die neue Stufe als auch die bisherige Stufe des Ziels **nicht höher** sind als die eigene.
    Ein Admin ohne `WRITE` kann so weder `WRITE` vergeben noch einem `WRITE`-Benutzer die Stufe senken.
- Die Vergabe erscheint im Benutzer-Sheet der Benutzerverwaltung (`UserFormSheet`) als Auswahl. Die
  Server Actions `createUser`/`updateUser` prüfen `canGrantMcpAccess` selbst (nie dem Formular vertrauen).
  Excel-Import und -Export lassen `mcpAccess` unberührt.

## Werkzeuge

Namen auf Englisch (snake_case), Beschreibungen und Rückgaben auf Deutsch. Alle Listen sind begrenzt
(höchstens 50 Einträge pro Aufruf, `cursor` für die nächste Seite). Rückgaben enthalten nie
Passwort-Hashes, Token oder Aktivierungslinks.

**Lesen (`READ`):**

| Werkzeug | Eingabe | Rückgabe | Rechtegrundlage |
|---|---|---|---|
| `list_users` | `query?`, `organizationId?`, `abschnittId?`, `status?` (aktiv/inaktiv/deaktiviert), `limit?`, `cursor?` | Name, Dienstgrad, Heimatfeuerwehr, E-Mail, Standesbuchnummer, Telefon, Status, Rollen, zuletzt aktiv | `canAccessUserManagementAdmin`; nur Benutzer der Organisationen, für die `canManageUsersFor` gilt |
| `get_user` | `userId` | wie oben, zusätzlich Ausbildungsstufen, Drohnengruppe, Admin-für | wie `list_users` |
| `get_atemschutz_status` | `organizationId?`, `status?` | je Träger: Untersuchung, Gültig bis, Finnentest, Status (aktiv / läuft bald ab / abgelaufen / keine Angabe) | eigener Status immer; Liste nur über `canManageHeimatfeuerwehrFor`; Status aus `atemschutz-status.ts` |
| `list_drone_flights` | `droneGroupId?`, `from`, `to`, `pilotId?`, `limit?`, `cursor?` | Datum, Ort, Pilot, Drohne, Zweck | `canViewDroneModule`; Mitglieder nur eigene Flüge, `canViewAllFlights` alle der Gruppe |
| `get_drone_readiness` | `droneGroupId?` | 90-Tage-Status des Aufrufers; für Gruppenadmins je Pilot die Ampel (`getGruppenEinsatzbereitschaft`) | wie Flugbuch |
| `list_calendar_events` | `from`, `to`, `organizationId?`, `sondergruppeId?` | Titel, Zeit, Ort, Organisation, Kategorie, Sondergruppe, bezirksweit | `canViewEvent` (inkl. Drohnengruppen-Termine und bezirksweit) |
| `list_organizations` | `query?` | ID, Name, Abschnitt | nur Organisationen im eigenen Verwaltungsbereich |
| `list_dienstgrade` | – | ID, Kurzform | öffentlich bekannte Referenzdaten |

**Schreiben (`WRITE`):**

`create_user` — Eingabe: `firstName`, `lastName`, `email`, `stbNr`, `phone?`, `homeOrganizationId`,
`dienstgradId?`, `istAtemschutzgeraeteTraeger?`, `adminOrgIds?`, `droneGroupId?` + `droneRole?`,
`ausbildung?` (die fünf Stufen als Datum). Ausgeschlossen: Bezirksadmin, Bezirks-Drohnenadmin, `mcpAccess`,
zweite Heimatfeuerwehr.
- Dieselbe Kernlogik wie `createUser` in der Benutzerverwaltung: `userSchema` (inkl. Standesbuchnummer),
  `canManageUsersFor`, `canGrantAdminFor`, Gruppen-Prüfung (`canManageDroneGroupFor`),
  Ausbildungs-Reihenfolge. Die Kernlogik wird aus der Server Action in eine Service-Schicht herausgelöst
  (Vorbild: `lib/drone/checklist/service.ts`, Rückgabe als `ServiceResult`), die Server Action und das
  Werkzeug gemeinsam nutzen.
- Die Willkommens-Mail mit Aktivierungslink geht **immer** an den neuen Benutzer. Der Link erscheint nie in
  der Antwort. Schlägt der Mailversand fehl, ist der Benutzer trotzdem angelegt, `emailSent: false` steht in
  der Antwort, und der Admin nutzt in der Benutzerverwaltung "Passwort-Reset-E-Mail".
- Rückgabe: neue `userId`, Name, Organisation, `emailSent`.

## OAuth-Server

- **Endpunkte:** `/.well-known/oauth-protected-resource` (Protected Resource Metadata),
  `/.well-known/oauth-authorization-server`, `/oauth/register` (Dynamic Client Registration),
  `/oauth/authorize` (Anmeldung + Zustimmung), `/oauth/token` (Code gegen Token tauschen, Refresh),
  `/oauth/revoke`. Der `/api/mcp`-Endpunkt antwortet ohne gültiges Token mit `401` und
  `WWW-Authenticate: Bearer resource_metadata="…"`.
- **Issuer und Resource** leiten sich aus `AUTH_URL` ab (`${AUTH_URL}/api/mcp`). Die alte PROD-Domain
  leitet nur per 301 weiter und wird nie als Issuer verwendet.
- **Registrierung:** Nur Rücksprungadressen von `claude.ai`, `chatgpt.com` und `localhost` werden akzeptiert;
  die genauen Adressen werden beim Bauen in der aktuellen Dokumentation von Claude und OpenAI nachgeprüft.
  Pro Client und IP gibt es eine Mengenbegrenzung (Muster von `login-throttle.ts`).
- **Zustimmungsseite:** zeigt Clientname und gewünschten Umfang. Es wird nur gewährt, was `mcpAccess` des
  angemeldeten Benutzers erlaubt (`mcp:read` bzw. `mcp:write`). Benutzer mit `NONE` sehen eine Meldung statt
  der Zustimmung.
- **Lebensdauern:** Autorisierungscode 60 Sekunden und einmalig, Access-Token 1 Stunde, Refresh-Token
  30 Tage mit Rotation (bei jeder Nutzung ersetzt; eine Wiederverwendung eines alten Refresh-Tokens widerruft
  die ganze Kette).
- **Speicherung:** Codes und Token nur als SHA-256-Hash (wie `PasswordToken`), nie im Klartext.

## Datenmodell (additive Migration)

- `User.mcpAccess McpAccess @default(NONE)`.
- `AppSettings.mcpEnabled Boolean @default(false)` (Funktionsschalter, siehe Einführung).
- `OauthClient` (`id`, `clientId` @unique, `name`, `redirectUris String[]`, `createdAt`).
- `OauthAuthorizationCode` (`codeHash` @unique, `clientId`, `userId`, `redirectUri`, `codeChallenge`,
  `scope`, `expiresAt`, `usedAt`).
- `OauthToken` (`id`, `accessTokenHash` @unique, `refreshTokenHash` @unique, `clientId`, `userId`, `scope`,
  `expiresAt`, `refreshExpiresAt`, `revokedAt`, `lastUsedAt`, `createdAt`).
- `McpAuditLog` (`id`, `userId`, `clientId`, `tool`, `outcome` (OK/DENIED/ERROR), `targetUserId?`,
  `summary` (kurzer Text ohne Freitexte wie Telefonnummer), `createdAt`). Protokolliert alle
  Schreibaktionen und alle abgelehnten Zugriffe; Aufbewahrung 180 Tage über einen täglichen Cron-Endpunkt
  nach dem Muster von `report-retention`.

## Sicherheit

- **Eingeschleuster Text:** Namen, Termin-Beschreibungen und Anmerkungen stammen von Benutzern und könnten
  Anweisungen an die KI enthalten. Gegenmaßnahmen: Listen liefern nur nötige Felder (Freitexte nur in
  Detailabfragen); das Schreibwerkzeug ist als verändernd markiert, damit Claude und ChatGPT vor dem
  Ausführen nachfragen; jede Schreibaktion wird protokolliert; die gefährlichsten Rechte
  (Bezirksadmin, `mcpAccess`) sind nie über MCP setzbar.
- **Mengenbegrenzung:** Lesen höchstens 120 Anfragen pro Minute und Token; `create_user` höchstens
  20 pro Stunde und Benutzer; `/oauth/token` und `/oauth/register` pro IP.
- **Verwaltung:** Im Profil sieht jeder seine Verbindungen ("Verbundene KI-Apps") und kann sie widerrufen.
  Admins mit `canManageUsersFor` können alle Token eines Benutzers sperren. Löschen oder Deaktivieren eines
  Benutzers macht seine Token sofort unwirksam (Live-Prüfung pro Anfrage).
- **Geheimnisse:** keine neuen Umgebungsvariablen nötig; Token entstehen zufällig. Keine Secrets in Logs.

## Fehlerbehandlung

- Kein/ungültiges/abgelaufenes Token: `401` mit `WWW-Authenticate`.
- `mcpAccess` zu niedrig oder Schalter aus: `403` (Schalter aus: wie "nicht vorhanden", `404`).
- Werkzeugfehler (ungültige Eingabe, fehlendes Recht, Mengenbegrenzung) kommen als MCP-Werkzeugfehler
  (`isError: true`) mit deutscher, für die KI verständlicher Meldung zurück; nie Stacktraces.

## Tests (vitest)

- Rechtematrix je Werkzeug: Mitglied, Feuerwehr-Admin, Abschnittsadmin, Bezirksadmin, Drohnengruppen-Admin ×
  `mcpAccess` `NONE`/`READ`/`WRITE`, deaktivierter Benutzer, Benutzer ohne Verwaltungsbereich.
- `canGrantMcpAccess`: alle Kombinationen (Bereich, Obergrenze, Absenkung eines höheren Ziels).
- OAuth: PKCE-Pflicht, falsche oder fremde Rücksprungadresse, Code zweimal eingelöst, abgelaufener Code,
  Refresh-Rotation und Wiederverwendungserkennung, Widerruf, Token nach Entzug von `mcpAccess`.
- `create_user`: Gleichwertigkeit mit der Benutzerverwaltung (gleiche Kernfunktion), Ablehnung
  ausgeschlossener Felder, fremde Organisation, nicht erlaubte `adminOrgIds`, Mailfehler.
- Datenbanktests nach dem bestehenden Muster (`*.db.test.ts`, nur gegen die lokale Datenbank).

## Einführung

- Migration rein additiv; `mcpAccess` ist überall `NONE`, für bestehende Benutzer ändert sich nichts.
- Funktionsschalter `AppSettings.mcpEnabled` (nur Bezirksadmin schaltet ihn um, Standard aus). Ohne
  Schalter antworten `/api/mcp` und `/oauth/*` wie "nicht vorhanden".
- Dev zuerst: Connector gegen die Dev-Domain registrieren und testen, danach PROD. Vor PROD die Migration
  nach `docker/README.md` prüfen (rein additiv, kein Backfill).

## Phasen (jede für sich auslieferbar und testbar)

1. **Rechtefeld und Verwaltung:** `mcpAccess`, `canGrantMcpAccess`, Auswahl im Benutzer-Sheet,
   `McpAuditLog`, Schalter `mcpEnabled`.
2. **OAuth-Server:** Tabellen, Discovery, Registrierung, Anmelde- und Zustimmungsseite, Token, Widerruf.
3. **MCP-Endpunkt und Lesewerkzeuge:** `/api/mcp`, Token-Prüfung, die sieben Lesewerkzeuge.
4. **`create_user`:** Service-Schicht aus `createUser` herauslösen, Server Action darauf umstellen
   (Verhalten unverändert, mit Tests abgesichert), dann das Werkzeug.
5. **Abschluss:** "Verbundene KI-Apps" im Profil, Admin-Sperre, Mengenbegrenzung, Audit-Aufräumung,
   Dokumentation (`CLAUDE.md`, `docker/README.md`).

## Offene Punkte (beim Bauen zu klären, ändern den Entwurf nicht)

- Genaue Rücksprungadressen und Registrierungsverhalten von Claude und ChatGPT zum Zeitpunkt der
  Umsetzung gegen deren aktuelle Dokumentation prüfen.
- Ob der Streamable-HTTP-Transport des SDK in einem Next.js-15-Route-Handler direkt mit Web-Standard-
  `Request`/`Response` läuft oder einen kleinen Adapter braucht (Phase 3, Spike am Anfang).
- Ob ChatGPT neben OAuth weitere Anforderungen an die Metadaten stellt (Phase 2/3, gegen eine echte
  ChatGPT-Verbindung auf DEV testen).
