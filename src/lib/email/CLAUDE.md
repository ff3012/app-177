# CLAUDE.md — Email

This file loads automatically (in addition to the root CLAUDE.md) when Claude Code works with files under this directory. Moved out of the root CLAUDE.md by a /doctor pass (context-size cleanup) — content is unchanged verbatim.

### Email

`src/lib/email/mailjet.ts` is a thin `fetch` wrapper around Mailjet's v3.1 Send API (no SDK dependency), plus
`checkMailjetConnection()` for the Status-page health check (read-only, sends nothing). `sendEmail()` wraps
every caller's `htmlPart` in one shared `wrapHtmlPart()` div (`font-family: Arial, Helvetica, sans-serif;
font-size: 15px; ...`) before sending — added after a real inconsistency shipped: an early version of the
"bitte nicht antworten" disclaimer line (see below) had its own smaller/grayer inline style, which stood out
visually against the rest of the same email in a real client. Individual templates can still deliberately
override this for one element via their own inline `style` (e.g. the large monospace login short-code box in
`sendLoginTokenEmail`) since a child's inline style wins over the inherited wrapper value — the point is that
plain paragraphs across a whole email can no longer silently drift apart from each other one template edit
at a time.
`src/lib/email/templates.ts` builds the transactional emails (activation, password reset); `AUTH_URL` is the
base for the links it builds. `src/lib/email/escape-html.ts` (`escapeHtml`) is used wherever free-text or
user-controlled values (flight location, feedback message) get interpolated into an email's `htmlPart` —
`templates.ts` itself predates this and still doesn't escape `firstName`, a known minor gap, but new email
code should use it. `MAILJET_FROM_EMAIL` is `noreply@ff-wolfsgraben.at` (GitHub issue #5) rather than a
monitored address, so password reset and login token each end
with a short "bitte nicht antworten, bei Fragen wende dich an florian.krebs@feuerwehr.gv.at" line — the same
contact address already hardcoded (by design, see below) for in-app feedback. Admin-facing operational mails
(drone-flight notification, system-check result) don't need this line; the admin who receives them already
knows who to contact. Password reset and login token's sign-off reads "Abschnittsfeuerwehrkommando
Purkersdorf" — the `Organization` row's actual name for the AFKDO org (`prisma/seed.ts`) — not the informal
"Feuerwehr Abschnitt Purkersdorf" phrase a couple of templates used until this was flagged as inconsistent.

**Willkommens-Mail (`sendActivationEmail`) — Sonderfall, nicht mehr `wrapHtmlPart`-Standard**: nach
mehreren Feinschliff-Runden auf ausdrücklichen Wunsch des App-Betreibers weicht dieses eine Template
inzwischen bewusst vom obigen Muster ab. Betreff und Fließtext wurden im Rahmen der Bezirk-Erweiterung
von "AFKDO Purkersdorf" auf "BFKDO St. Pölten" umbenannt ("Kalender für alle Termine im Bezirk,
Abschnitt und Feuerwehr" statt "im Abschnitt Purkersdorf"), die Grußzeile aber in einer Folgerunde
wieder auf schlicht **"AFKDO Purkersdorf"** zurückgesetzt (ohne "Dein", explizit vom App-Betreiber so
gewünscht — Text von ihm wörtlich vorgegeben, nicht selbst formuliert). Die alte "bitte nicht
antworten..."-Zeile ist in dieser einen Mail **ersatzlos entfernt**, ersetzt durch eine eigene
Fußzeile: "Diese App wird vom Abschnittsfeuerwehrkommando Purkersdorf zur Verfügung gestellt. Fragen
an Florian Krebs florian.krebs@feuerwehr.gv.at" — auf explizite Nachfrage bestätigt, dass das so
gewollt ist, trotz `noreply@ff-wolfsgraben.at` als technischem Absender. Password Reset und Login
Token behalten die alte "bitte nicht antworten"-Zeile unverändert; nur die Willkommens-Mail ist
davon abgewichen. Beide Mails (Willkommen + Passwort-Reset) verlinken zusätzlich `/how-to.html` (die
öffentliche FAQ-Seite, siehe unten) über einen neuen `faqLink = ${baseUrl()}/how-to.html`.

**FAQ-Seite (`public/how-to.html`, GitHub-Repo-URL für Vorab-Fassung s. `gh-pages`-Branch)**: eine
statische, selbstständige HTML-Seite (kein Build-Schritt, keine App-Abhängigkeiten) unter
`/how-to.html` — Next.js liefert alles unter `public/` unverändert am Wurzelpfad aus. Beantwortet:
was die App für die Drohnengruppe kann, wie man sie am Handy zum Home-Bildschirm hinzufügt, und wie
man das Passwort zurücksetzt. **Muss** in `middleware.ts`'s `PUBLIC_PATH_PREFIXES` stehen (`/how-to.
html`) — ohne den Eintrag hätte die Middleware jeden nicht angemeldeten Aufruf zu `/login`
umgeleitet, was den eigentlichen Zweck der Seite (u. a. Hilfe bei "Passwort vergessen", also für
genau die Leute, die sich noch nicht anmelden können) unterlaufen hätte. Vor der Wahl von `public/`
wurde eine Variante als GitHub Pages (eigener Orphan-Branch `gh-pages` desselben Repos, getrennt von
`main`, damit die internen Planungsdokumente unter `docs/superpowers/` nicht mitveröffentlicht
werden) probiert und ist dort weiterhin als Fallback-Kopie erreichbar — die App selbst liefert die
Seite aber direkt unter der eigenen Domain aus, sodass die E-Mail-Links immer auf `AUTH_URL` zeigen,
nicht auf eine zweite, separat zu pflegende URL.
`/admin/email` has a manual "send test email" action for verifying the Mailjet API
key/sender config without triggering a real activation or reset flow, plus the `droneFlightNotificationEmail`
and `systemCheckNotificationEmail` settings (`AppSettings`) editable via `DroneFlightEmailForm` and
`SystemCheckEmailForm` respectively — two near-identical forms/actions kept separate rather than
parameterized into one generic "settings email" component, matching this codebase's general preference for
duplication over a premature shared abstraction for two call sites.

An admin can also trigger the password-reset email directly for a given user from `/admin/benutzer/[userId]`
(`sendPasswordResetEmailToUser`, reuses the same `createToken`/`sendPasswordResetEmail` as the self-service
"Passwort vergessen" flow) — this exists *alongside*, not instead of, the manual "Neues Passwort (optional)"
override already on that form; keep both.

The "Feedback geben" panel in the profile menu (`components/layout/feedback-form.tsx` +
`app/(app)/profile/actions.ts`'s `sendFeedback`) is a 5-star-rating + free-text form that emails a hardcoded
recipient (`florian.krebs@feuerwehr.gv.at`) via the same `sendEmail()` — not admin-configurable like the
drone-flight notification address, by design (it's feedback about the app itself, not an operational setting).

