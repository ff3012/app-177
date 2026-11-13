# MCP-Connector für Claude und ChatGPT — Umsetzungsplan (Übersicht)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Jede Phase unten ist ein eigener, vollständiger Plan mit Aufgaben, Code und Tests; sie werden **in dieser Reihenfolge** abgearbeitet. Steps verwenden Checkbox-Syntax (`- [ ]`).

**Goal:** Benutzer mit dem Recht "MCP Permissions Read" oder "MCP Permissions Write" können Claude und ChatGPT über einen MCP-Connector mit der App verbinden: Abfragen zu Benutzerverwaltung, Drohnengruppe, Kalender und Atemschutzstatus sowie (Write) das Anlegen neuer Benutzer.

**Spec:** `docs/superpowers/specs/2026-11-12-mcp-connector-design.md` (vom Nutzer freigegeben)

**Architecture (Kurzfassung):** Ein zustandsloser MCP-Endpunkt `/api/mcp` in der bestehenden Next.js-App, davor ein kleiner OAuth-2.1-Server (Code + PKCE, Dynamic Client Registration). Jede Anfrage lädt den Benutzer live, baut das übliche `SessionUser`-Objekt und ruft die **bestehenden** Rechtefunktionen auf; `User.mcpAccess` (`NONE`/`READ`/`WRITE`) schaltet nur den Connector frei. Alles hängt am Funktionsschalter `AppSettings.mcpEnabled`.

## Phasen

| # | Plan | Ergebnis (jeweils einzeln auslieferbar) | Aufgaben |
|---|---|---|---|
| 1 | `2026-11-12-mcp-connector-phase-1-rechte.md` | Migration, `mcpAccess` mit Vergabe und Obergrenze in der Benutzerverwaltung, Funktionsschalter, Prüfprotokoll- und Mengenbegrenzungs-Bausteine. Noch kein Endpunkt. | 6 |
| 2 | `2026-11-12-mcp-connector-phase-2-oauth.md` | OAuth-Server: Metadaten, Registrierung, Anmelde-/Zustimmungsseite, Token, Refresh-Rotation, Widerruf. Noch kein Werkzeug. | 8 |
| 3 | `2026-11-12-mcp-connector-phase-3-endpunkt.md` | `/api/mcp` mit Token-Prüfung und den acht Lesewerkzeugen; echter Client (MCP Inspector) kann abfragen. | 9 |
| 4 | `2026-11-12-mcp-connector-phase-4-create-user.md` | Kernlogik "Benutzer anlegen" herausgelöst (Server Action unverändert), Werkzeug `create_user`. | 3 |
| 5 | `2026-11-12-mcp-connector-phase-5-abschluss.md` | "Verbundene KI-Apps" im Profil, Admin-Sperre, Prüfprotokoll-Ansicht, täglicher Aufräum-Cron, Dokumentation, Einführung. | 5 |

**Reihenfolge und Abhängigkeiten:** 1 → 2 → 3 → 4 → 5, jede Phase setzt die vorherige voraus. Nach jeder Phase laufen `npm test`, `npm run test:db`, `npx tsc --noEmit` und `npm run build` grün; der Connector bleibt standardmäßig ausgeschaltet, bis er in `/admin/mcp` aktiviert wird.

## Wichtige Entscheidungen im Plan (zusätzlich zur Spec)

- **Eine Migration, nicht mehrere:** `20261112090000_mcp_connector` legt in Phase 1 alle Tabellen an (inkl. OAuth und Prüfprotokoll). Sie wird wegen des bekannten Reihenfolgefehlers in `20260819100617_news_modul` über `prisma migrate diff --from-url` erzeugt und mit `migrate deploy` angewendet (siehe Root-`CLAUDE.md`).
- **`mcpAccess` am Formular optional:** Ein fehlendes Feld bedeutet "unverändert", nie `NONE` — sonst würde jede Bearbeitung ohne MCP-Abschnitt das Recht still entziehen.
- **Werkzeuge testen ohne Transport:** Jedes Werkzeug ist eine reine Funktion `(ctx, input) → ToolResult`; `runTool` kapselt Mengenbegrenzung, Fehlerabbildung und Prüfprotokoll. Die Rechtematrix wird direkt gegen die Funktionen getestet.
- **Freitexte in Listen:** Termin-Beschreibungen kommen nur mit `includeDescription: true` (gekürzt auf 1000 Zeichen) — die Umsetzung der Spec-Vorgabe "Freitexte nur auf Wunsch" für den Kalender.
- **Benutzer anlegen ohne halbfertige Zustände:** `createUserCore` prüft das Drohnengruppen-Recht **vor** dem Anlegen (bisher erst danach, wodurch bei fehlendem Recht ein Benutzer ohne Mitgliedschaft zurückblieb). Das ist die einzige beabsichtigte Verhaltensänderung der Benutzerverwaltung.
- **Mengenbegrenzung im Speicher:** 120 Aufrufe/min je Token, OAuth-Endpunkte je IP; `create_user` zusätzlich 20/Stunde über das Prüfprotokoll (überlebt Neustarts).
- **Bekannte Einschränkung:** Die Anmeldung per E-Mail-Token kehrt nicht zu `/oauth/authorize` zurück; der Benutzer startet die Verbindung in Claude/ChatGPT dann neu (die Sitzung besteht bereits).

## Offene Punkte aus der Spec und wo sie geklärt werden

| Punkt | Wo |
|---|---|
| Rücksprungadressen von Claude und ChatGPT | Phase 2 Task 2 Step 5 (Dokumentation prüfen), Phase 3 Task 9 Step 3 (echte Verbindung auf DEV) |
| SDK-Transport im Next.js-15-Route-Handler | Phase 3 Task 4 (Spike; Plan ist auf den Web-Standard-Transport `WebStandardStreamableHTTPServerTransport` des SDK 1.32.2 ausgelegt, im Test belegt) |
| Zusätzliche ChatGPT-Anforderungen an Metadaten | Phase 3 Task 9 Step 3 |

## Risiken

- **`zod`-Update:** Das SDK verlangt `zod` ≥ 3.25, das Projekt hat `^3.24.1`. Phase 3 Task 1 aktualisiert auf `^3.25.0` und prüft sofort `tsc` und `npm test`.
- **Refactoring `createUser`:** Sicherheitsrelevanter Code wird verschoben. Phase 4 Task 1 ist ein reines Verschieben (wortgleich), Task 2 nagelt das Verhalten mit Tests des Kerns fest, bevor die Server Action umgestellt wird.
- **Plattform-Verhalten:** Claude und ChatGPT ändern sich; die Spezifika (Adressen, Metadaten) werden erst mit einer echten Verbindung auf DEV endgültig bestätigt.

## Reihenfolge der Auslieferung

Jede Phase kann einzeln auf DEV deployt werden (die Migration kommt mit Phase 1). **PROD:** erst nach Phase 5 und einem erfolgreichen Test mit Claude **und** ChatGPT auf DEV; der Nutzer deployt selbst (Backup, `migrate status`, siehe Phase 5 Task 5).
