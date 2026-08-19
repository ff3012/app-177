# News-Modul (Issue #17) — Design

GitHub Issue: https://github.com/ff3012/app-177/issues/17
Design-Brief: `News-Brief.md` (Claude Design Projekt `cabb2cb1-85d4-4829-a3a4-eb667d733949`)

## 0. Diagnose und Ausgangslage

Gemeldetes Problem: Beim Tippen auf eine Push-Benachrichtigung öffnet sich die App-177-Startseite,
nicht die Nachricht selbst — bei längeren Texten bleibt der volle Inhalt daher praktisch
unerreichbar, da iOS Push-Benachrichtigungen auf dem Sperrbildschirm nach ~170 Zeichen abschneidet
(nicht behebbar, Plattformgrenze). Der eigentliche Fehler ist ein **fehlendes Sprungziel**: der
Push braucht ein `data.url`, dieses Ziel braucht eine Ablage mit dem vollständigen Text.

**Es existiert bereits ein funktionierendes News-Modul** (`NewsMessage`, `PushSubscription`,
`/news`, `/news/neu`, `dispatchNewsMessage`, der Terminierungs-Cronjob) — dies ist eine Überarbeitung
davon, kein Neubau. Die drei folgenden Entscheidungen wurden mit dem Nutzer in diesem Chat explizit
geklärt, da der Brief an diesen Stellen vom bestehenden Code abweicht:

1. **Kein Produktivdaten-Migrationsbedarf** — `NewsMessage` wurde noch kaum/nie echt genutzt.
   `NewsMessage` wird **komplett durch `NewsPost` ersetzt** (gleiches Muster wie die
   Foto-Uploads-Vereinfachung dieser Session: sauberer Ersatz statt additiver Migration).
2. **Terminierung bleibt erhalten.** Der Brief nennt im Verfassen-Formular nur "Als Entwurf" /
   "Senden" und erwähnt die bestehende Terminierungsfunktion nicht — das ist eine Auslassung des
   Briefs, keine bewusste Streichung. Das neue Modell bekommt **drei** Zustände: Entwurf /
   Terminiert / Gesendet, indem der bestehende `scheduledAt`/`sentAt`-Mechanismus um einen neuen,
   rein abgeleiteten Entwurf-Zustand ergänzt wird (kein drittes Zeitstempel-Feld nötig).
3. **Rechte-Ausweitung wie im Brief**: statt ausschließlich Bezirksadmin dürfen künftig auch
   Feuerwehr-Admins (an die eigene Wehr) und Drohnengruppen-Admins (an die eigene Gruppe) News
   verschicken — Bezirksadmin behält zusätzlich weiterhin das Recht, an jede Zielgruppe zu senden.
4. **Lesestand bleibt privat** — `NewsRead` wird gespeichert und treibt den eigenen
   Ungelesen-Zähler, aber es gibt **keine** admin-sichtbare "X von Y gelesen"-Auswertung (die vom
   Brief selbst als offene Entscheidung markierte Fußzeile in Abschnitt 6 entfällt ersatzlos).

**Architektur:** Prisma-Migration (`NewsMessage`+Enum ersetzen durch `NewsPost`/`NewsRead`), eine
neue Berechtigungsschicht (`src/lib/auth/permissions.ts`), eine erweiterte Push-Payload samt
`notificationclick`-Handler in `public/sw.js`, drei überarbeitete/neue Seiten
(`/news`, `/news/[newsPostId]`, `/news/neu`) und zwei neue Startbildschirm-Elemente (Glocke+Badge,
Karte). Kein neues externes Gerät/API — alles auf bestehender Web-Push-/Prisma-/Next.js-Infrastruktur.

**Tech Stack:** unverändert (Next.js App Router, Prisma, `web-push`, Service Worker). Keine neue
Abhängigkeit nötig.

## Global Constraints

- Titel: hart 65 Zeichen (bisher 100) — Push-Kopfzeile darf nie gekürzt werden, dafür muss der
  Titel selbst kurz genug sein.
- Text: **keine** Zeichengrenze in der App (bisher 500) — nur die Push-Nutzlast wird gekürzt, der
  gespeicherte/angezeigte Text ist immer vollständig.
- Push-Kürzung: serverseitig auf ca. 170 Zeichen an der letzten Wortgrenze vor dem Limit, nie
  serverseitig die volle Nutzlast senden und dem Gerät überlassen (4-KB-Payload-Limit).
- Genau eines von `fireDepartmentId`/`droneGroupId` ist gesetzt, erzwungen in der
  Validierung (Zod), nicht dem Zufall überlassen. `droneGroupId = null` bei `audience =
  DRONE_GROUP` bedeutet weiterhin "alle Gruppen" — exakt die bestehende `audienceDroneGroupId`-
  Konvention aus `NewsMessage`, unverändert übernommen.
- `/news`-Sichtbarkeit: **jedes Mitglied** des Empfängerkreises darf lesen (heute: nur
  Bezirksadmin darf die Seite überhaupt öffnen — diese Sperre entfällt für das Lesen komplett).
  Senden/Bearbeiten/Löschen bleibt admin-gated (siehe Berechtigungstabelle unten).
- `getVisibleNews(userId)` ist die **einzige** Lesequelle für "welche News sieht dieser Nutzer" —
  nie zwei Abfragen in einer Seite zusammenstückeln, sonst driften Liste/Zähler/Detail auseinander.
- News wird **kein vierter Tab** in der mobilen Tab-Bar (nur 3 Slots, siehe root `CLAUDE.md`s
  V2/V3-Abschnitte) — Zugang über Glocke + Startbildschirm-Karte.

## 1. Datenmodell

`prisma/schema.prisma`: `NewsMessage`, `NewsAudienceType` werden vollständig entfernt und durch
Folgendes ersetzt (gleiche Zeile wie bisher, keine zusätzliche Migration on top):

```prisma
enum NewsAudience {
  FIRE_DEPARTMENT
  DRONE_GROUP
}

model NewsPost {
  id               String       @id @default(cuid())
  audience         NewsAudience
  fireDepartmentId String?          // gesetzt genau dann, wenn audience == FIRE_DEPARTMENT
  droneGroupId     String?          // gesetzt bei audience == DRONE_GROUP; null = alle Gruppen
  title            String           // max. 65 Zeichen (Zod, siehe Global Constraints)
  body             String           // unbegrenzt
  eventId          String?          // optional verknüpfter Kalender-Termin
  scheduledAt      DateTime?        // gesetzt + sentAt null = wartet auf den Versand-Cronjob
  sentAt           DateTime?        // gesetzt = bereits gesendet (unabhängig von scheduledAt)
  createdById      String
  createdAt        DateTime @default(now())

  fireDepartment Organization? @relation(fields: [fireDepartmentId], references: [id])
  droneGroup     DroneGroup?   @relation(fields: [droneGroupId], references: [id])
  event          Event?        @relation(fields: [eventId], references: [id])
  createdBy      User          @relation("NewsPostCreatedBy", fields: [createdById], references: [id])
  reads          NewsRead[]

  @@index([scheduledAt])
  @@index([fireDepartmentId])
  @@index([droneGroupId])
}

model NewsRead {
  newsPostId String
  userId     String
  readAt     DateTime @default(now())

  newsPost NewsPost @relation(fields: [newsPostId], references: [id], onDelete: Cascade)
  user     User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([newsPostId, userId])
}
```

**Statusableitung** (kein eigenes Feld, überall identisch berechnet — ein einziger Helfer, nicht an
mehreren Stellen dupliziert):
```ts
function getNewsPostStatus(post: { scheduledAt: Date | null; sentAt: Date | null }): 'DRAFT' | 'SCHEDULED' | 'SENT' {
  if (post.sentAt) return 'SENT';
  if (post.scheduledAt) return 'SCHEDULED';
  return 'DRAFT';
}
```
Ein Entwurf ist damit einfach eine `NewsPost`-Zeile mit `scheduledAt: null, sentAt: null` — kein
Sonderfall in der Datenbank, nur eine dritte mögliche Kombination der zwei bestehenden Felder.

Reverse-Relationen: `Organization.newsPosts NewsPost[]`, `DroneGroup.newsPosts NewsPost[]`,
`Event.newsPosts NewsPost[]`, `User.newsPostsCreated NewsPost[] @relation("NewsPostCreatedBy")`,
`User.newsReads NewsRead[]`. `PushSubscription` bleibt vollständig unverändert.

### Empfängerauflösung

`src/lib/news/audience.ts` (ersetzt das bisherige `src/lib/push/audience.ts`s
`resolveAudienceUserIds`, gleiche Funktionsweise, neue Feldnamen):
```ts
export async function getVisibleNews(userId: string): Promise<NewsPostWithMeta[]>
```
— liefert alle `NewsPost`-Zeilen mit `sentAt` gesetzt, deren Empfängerkreis den Nutzer enthält
(`FIRE_DEPARTMENT`: `fireDepartmentId === user.homeOrganizationId`; `DRONE_GROUP`:
`droneGroupId === user.droneGroupId` **oder** `droneGroupId === null`, exakt wie bei den
Foto-Uploads/Kalender-Drohnengruppen-Events dieser Session), inklusive `isRead` (via `reads`-Relation
gegen `userId`) und `reads`-Anzahl. **Diese Funktion ist die einzige Stelle**, die diese Logik
implementiert — `/news`, die Startbildschirm-Karte und der Glocken-Zähler rufen alle denselben
Helfer auf, nie eigene Prisma-Queries mit paralleler Sichtbarkeitslogik.

Ungesendete Entwürfe/terminierte Posts erscheinen **nicht** in `getVisibleNews` (nur für den
Ersteller/Admin über die separate Verwaltungsliste sichtbar, siehe Abschnitt 5).

## 2. Berechtigungen

`src/lib/auth/permissions.ts`, ersetzt die bisherige einzelne `canManageNews`:

| Aktion | Wer | Funktion |
|---|---|---|
| Senden an eine Feuerwehr | Admin dieser Feuerwehr ODER Bezirksadmin | `canSendNewsToFireDepartment(user, fireDepartmentId)` |
| Senden an eine Drohnengruppe | Admin dieser Gruppe ODER Bezirksadmin | `canSendNewsToDroneGroup(user, droneGroup)` |
| Beitrag bearbeiten/löschen | Ersteller ODER admin des Empfängerkreises (gleiche Funktionen wie oben) | `canManageNewsPost(user, post)` |
| Lesen | jedes Mitglied des Empfängerkreises | über `getVisibleNews`, kein separater Permission-Check nötig |

```ts
export function canSendNewsToFireDepartment(user: SessionUser, fireDepartmentId: string): boolean {
  return isBezirksAdmin(user) || canManageHeimatfeuerwehrFor(user, fireDepartmentId);
}
export function canSendNewsToDroneGroup(user: SessionUser, droneGroup: { organizationId: string; id: string }): boolean {
  return isBezirksAdmin(user) || canManageDroneGroupFor(user, droneGroup);
}
// droneGroup ist ein bereits geladenes DroneGroup-Objekt ({id, organizationId}) - genau das
// gleiche Muster wie canManageEvent(user, event, droneGroup) im Kalender-Modul dieser Codebase,
// da NewsPost selbst nur droneGroupId speichert, nicht die organizationId der Gruppe. Der
// Aufrufer (Server Component/Action) lädt die DroneGroup einmal und reicht sie durch - nie ein
// zweiter impliziter Prisma-Call innerhalb dieser Funktion.
export function canManageNewsPost(
  user: SessionUser,
  post: { createdById: string; audience: NewsAudience; fireDepartmentId: string | null; droneGroupId: string | null },
  droneGroup: { id: string; organizationId: string } | null,
): boolean {
  if (post.createdById === user.id) return true;
  if (post.audience === 'FIRE_DEPARTMENT') return canSendNewsToFireDepartment(user, post.fireDepartmentId!);
  return droneGroup !== null && canSendNewsToDroneGroup(user, droneGroup);
}
/** Irgendein Empfängerkreis, an den dieser Nutzer senden darf - steuert, ob "Verfassen" überhaupt sichtbar ist. */
export function canSendAnyNews(user: SessionUser): boolean {
  return isBezirksAdmin(user) || user.feuerwehrAdminOrgIds.length > 0 || user.droneGroupRole === 'ADMIN';
}
```

Im Verfassen-Formular erscheinen **nur** Empfängerkreise, für die `canSendNewsToFireDepartment`/
`canSendNewsToDroneGroup` `true` liefert — weggelassen, nicht ausgegraut (identisch zur Vorgabe im
Brief). Serverseitige Prüfung sowohl in der Route (`/news/[newsPostId]/bearbeiten`, falls
umgesetzt) als auch in jeder Server Action; ein Direktaufruf durch ein nicht-berechtigtes
Mitglied liefert `notFound()`.

## 3. Push-Infrastruktur — der eigentliche Fix

### 3.1 Payload

`src/lib/push/web-push-client.ts`s `PushPayload`-Typ wird um ein optionales `data`-Feld erweitert:
```ts
export interface PushPayload {
  title: string;
  body: string;
  data?: { url: string };
}
```
`src/lib/news/dispatch-news.ts` (ersetzt `send-news.ts`, gleiche Funktionsweise) kürzt den Text
**serverseitig** an der letzten Wortgrenze vor ca. 170 Zeichen, bevor er in die Payload geht:
```ts
function truncateForPush(body: string, maxLength = 170): string {
  if (body.length <= maxLength) return body;
  const cut = body.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : maxLength)}…`;
}
```
und ruft `sendPushToSubscriptions(subscriptions, { title: post.title, body: truncateForPush(post.body), data: { url: \`/news/${post.id}\` } })` auf.
`sendEventPushNow` (Kalender-Sofortversand, unabhängig vom News-Modul) bleibt unverändert — `data`
ist optional, kein Pflichtfeld für andere Aufrufer.

### 3.2 Service Worker

`public/sw.js`: `push`-Handler übergibt `data: payload.data` an `showNotification` (bisher nicht
weitergereicht); `notificationclick`-Handler liest `event.notification.data?.url` statt hart
`/kalender` zu öffnen:
```js
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload = { title: 'AFKDO Purkersdorf', body: '' };
  try { payload = event.data.json(); } catch { payload.body = event.data.text(); }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: payload.data,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/kalender';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const existing = clientList.find((c) => c.url.includes(self.location.origin));
      if (existing) { existing.focus(); return existing.navigate(url); }
      return self.clients.openWindow(url);
    })
  );
});
```
Fallback bleibt `/kalender` für Pushes ohne `data.url` (z. B. bestehender Kalender-Sofortversand,
falls der je ohne `data` gesendet wird — Rückwärtskompatibilität, kein Absturz bei fehlendem Feld).

### 3.3 Kaltstart

`/news/[newsPostId]` ist eine Server Component (kein Client-seitiges Redirect über die
Startseite). Nicht angemeldete Nutzer: `requireUser()`s bestehender Redirect-zu-`/login`-
Mechanismus greift automatisch mit `?next=/news/842` (bereits bestehendes Verhalten dieser
Funktion im ganzen `(app)`-Bereich, keine News-spezifische Neuimplementierung nötig).

## 4. Startbildschirm „Meine Feuerwehr" und Header-Glocke

**Entscheidung (in diesem Chat getroffen): eine kombinierte Glocke, kein zweites Icon.**
`src/components/layout/profile-menu.tsx` (Zeilen ~76–88) hat bereits eine Glocke, die heute nur
den Push-Abo-Status zeigt (grün = aktiv, rot = inaktiv/nicht unterstützt) und beim Klick dasselbe
Dropdown wie der Name-/Avatar-Button öffnet. Diese Glocke wird umgebaut, statt eine zweite
danebengesetzt:

- **Klickverhalten ändert sich**: die Glocke wird zu einem echten `<Link href="/news">` (nicht
  mehr `onClick={() => setOpen(...)}`) — sie navigiert jetzt direkt zur Nachrichtenliste. Der
  Push-Abo-Toggle bleibt unverändert im Dropdown-Menü erreichbar (dort liegt der eigentliche
  `PushNotificationsToggle` ohnehin schon, Zeile ~143–144) — durch den Klick auf Name/Avatar
  weiterhin erreichbar, verliert also keine Funktion.
- **Farbe bleibt der Push-Abo-Indikator**: grün (`text-green-400`) = Push aktiv, rot
  (`text-red-400`) = inaktiv/nicht unterstützt — exakt wie heute, unverändert übernommen.
- **Neu: Zähler-Badge** (Zahl, nicht nur Punkt) oben rechts am Glocken-Icon, wenn
  `getVisibleNews(user.id)` ungelesene Posts liefert — 19px, `bg-brand`, 2px Rand in der
  Kopfzeilenfarbe (`#1c1c1e`), damit er sich vom dunklen Kopfzeilen-Hintergrund abhebt. Ohne
  Ungelesene kein Badge (nicht „0" anzeigen, das Element entfällt ganz).
- `ProfileMenu` braucht dafür den aktuellen Ungelesen-Zähler als Prop von seinem Server-Component-
  Elternteil (`(app)/layout.tsx`) — ein einziger `getVisibleNews(user.id)`-Aufruf dort, nicht
  zusätzlich nochmal client-seitig abgefragt.

**Karte „Neue Nachrichten" ganz oben** auf `/meine-feuerwehr`, vor „Als Nächstes": bis zu zwei
ungelesene Beiträge mit Absenderzeile, Titel, einzeiliger Vorschau (Ellipsis), Farbstreifen links
(Wehr `#1c1c1e`, Drohnengruppe `#22a06b`), „Alle {n}" oben rechts. Sind alle gelesen, entfällt die
Karte vollständig (kein Platzhalter) — Zugang bleibt über die Glocke.

## 5. Nachrichtenliste `/news`

Ein Posteingang für beide Zielgruppen, kein separates Fenster für Entwürfe/Terminiert vs.
Gesendet auf derselben Seite — stattdessen zwei Tabs/Bereiche in einer Seite:
- **„Nachrichten"** (Standard, für alle Mitglieder sichtbar): `getVisibleNews(user.id)`, Filterchips
  „Alle {n} · {Wehrname} · Drohnen", Zeile mit Farbstreifen/Ungelesen-Punkt/Absenderzeile/Titel/
  zweizeiliger Vorschau/relativer Zeit. Gelesen vs. ungelesen unterscheidet sich in drei Merkmalen
  gleichzeitig (Punkt, Schriftgewicht 600→500, Textfarbe ink→ink-muted). Paginierung ab 30.
  Kopf „Nachrichten" + „{n} ungelesen“, `Alle gelesen`-Aktion oben rechts.
- **„Verfassen"-Zugang** (nur bei `canSendAnyNews`): Button/Link zu `/news/neu`, plus — nur für
  Nutzer mit mindestens einem Senderecht — ein zweiter, eigener Bereich/Tab „Entwürfe & Geplant"
  mit den eigenen bzw. für den eigenen Empfängerkreis verwalteten `DRAFT`/`SCHEDULED`-Posts (diese
  erscheinen nie in `getVisibleNews`, da nicht gesendet).

## 6. Detailansicht `/news/[newsPostId]`

Ziel des Push. Text **immer vollständig**, keine Kürzung, kein „Mehr anzeigen".
- Kopf: Farbmarke + Absender, Titel 25px/700, Metazeile „Datum · Uhrzeit · {Dienstgrad Name}".
- Body als weiße Karte, Absätze mit Abstand, `white-space: pre-wrap` (Zeilenumbrüche des
  Verfassers erhalten).
- Optional Terminkarte des verknüpften Events (Kalender-Icon, Chevron, Link zu `/kalender/{id}`).
- `NewsRead.upsert({ where: { newsPostId_userId: ... }, create: {...}, update: {} })` beim
  Rendern der Seite (Server Component, nicht bei einem Client-seitigen Scroll-Event) — **kein**
  admin-sichtbarer Lesestand/Fußzeile (siehe Entscheidung 4 oben).
- Zugriffsschutz: `notFound()`, wenn der Post nicht gesendet ist ODER der Nutzer nicht im
  Empfängerkreis liegt — derselbe Fehlercode für beide Fälle (kein Hinweis, ob die ID überhaupt
  existiert).

## 7. Verfassen `/news/neu`

Zweispaltig: Formular links, Push-Vorschau rechts (Desktop) / gestapelt (Mobile).

**Formular**
1. **Empfänger** — Kacheln, je mit Mitgliederzahl und Anzahl Push-fähiger Geräte
   („42 Mitglieder · 38 mit Push"). Nur Kreise mit Senderecht des aktuellen Nutzers (siehe
   Abschnitt 2) — weggelassen, nicht ausgegraut.
2. **Titel** — Zähler „32 / 65", harte Grenze.
3. **Nachricht** — Zeichenzähler ohne Grenze, Hinweis „Länge unbegrenzt. Der volle Text steht in
   der App, unabhängig davon, was der Push zeigt."
4. **Termin verknüpfen** (optional) — Select über kommende Termine des gewählten Empfängerkreises.

Fuß: Reichweitenzeile („Wird an 38 Geräte gesendet. Vier Mitglieder haben Push deaktiviert und
sehen die Nachricht beim nächsten Öffnen von `/news`."), drei Aktionen: **Als Entwurf speichern**
(scheduledAt/sentAt beide null) · **Terminieren** (öffnet Datum/Zeit-Auswahl, setzt
`scheduledAt`, `sentAt` bleibt null, Versand über den bestehenden Cronjob) · **Jetzt senden**
(ruft `dispatchNewsMessage`-Nachfolger sofort auf).

**Push-Vorschau** (didaktischer Kern, unverändert zum Brief):
- Nachbildung der Sperrbildschirm-Meldung mit Wappen, App-Name, Absender.
- Text jenseits von ~170 Zeichen **rot hinterlegt**, nicht abgeschnitten dargestellt.
- Balken „Im Push sichtbar: 168 Zeichen", grün/rosa geteilt, mit Legende.
- Grüner Hinweis: „Der Tap auf die Meldung öffnet die vollständige Nachricht."

Vor „Jetzt senden"/„Terminieren" eine `AlertDialog`-Rückfrage mit Empfängerkreis und
Geräteanzahl — ein Push ist nicht zurückholbar. „Als Entwurf speichern" braucht keine Rückfrage.

**Bearbeiten/Löschen**: nur für `DRAFT`/`SCHEDULED`-Posts (ein bereits `SENT`-Post ist historisch
fixiert, kein Editieren nach Zustellung — entspricht dem Prinzip „ein Push ist nicht
zurückholbar" aus dem Brief). Löschen kaskadiert `NewsRead`-Zeilen (ohnehin nur bei
`DRAFT`/`SCHEDULED` relevant, da vor dem Senden nie ein `NewsRead` existiert).

## 8. Migration

Eine Migration `YYYYMMDDHHMMSS_news_modul`: `NewsMessage`-Tabelle und `NewsAudienceType`-Enum
per `DROP`, `NewsPost`/`NewsRead`-Tabellen und `NewsAudience`-Enum per `CREATE` — kein Backfill
nötig (Entscheidung 1). Alle Call-Sites (`actions.ts`, `dispatch-news.ts`/vormals `send-news.ts`,
`audience.ts`, `news/page.tsx`, `news/neu/page.tsx`, `news-form.tsx`, der Cron-Route,
`send-scheduled-news.sh`s Kommentare) werden umbenannt, keine zwei parallelen Implementierungen.

## 9. Testing

Kein automatisierter Testlauf in diesem Repo (etablierte Konvention: `tsc`/`build` plus
manuelle Live-Verifikation gegen die lokale Dev-Postgres). Verifikationsplan:
1. `npx tsc --noEmit` / `npm run build` sauber.
2. Entwurf anlegen → erscheint nicht in `getVisibleNews` eines anderen Mitglieds.
3. Terminieren → `scheduledAt` gesetzt, `sentAt` null, Cronjob-Route dispatcht ihn bei Fälligkeit.
4. Sofort senden → Push mit `data.url` kommt an (soweit im Dev-Setup mit echten VAPID-Keys
   prüfbar), `/news/{id}` zeigt den vollständigen Text.
5. `notificationclick` in `sw.js` öffnet/fokussiert die richtige URL — geprüft sowohl bei bereits
   offener als auch bei geschlossener App (siehe Brief-Abnahmekriterien Abschnitt 9).
6. Ein Mitglied ohne Drohnengruppe sieht keine Drohnen-News, auch nicht per Direktaufruf von
   `/news/{id}` (→ `notFound()`).
7. Ein Feuerwehr-Admin ohne Drohnenrechte sieht die Drohnengruppe im Verfassen-Formular nicht als
   wählbaren Empfänger.
8. Glocken-Zähler stimmt mit der Anzahl ungelesener, für den Nutzer sichtbarer Posts überein;
   „Alle gelesen" setzt ihn auf 0 und lässt die Startbildschirm-Karte verschwinden.
9. Ein bereits gesendeter Post lässt sich nicht mehr bearbeiten/löschen (Button fehlt oder
   Server Action liefert einen Fehler).

## 10. Abnahme (aus dem Brief übernommen, ergänzt um die in diesem Chat getroffenen Entscheidungen)

- [ ] Tap auf den Push öffnet die Meldung, nicht die Startseite — bei geschlossener und bei
      laufender App.
- [ ] Ein 900-Zeichen-Text kommt als Push gekürzt an, steht in der App aber vollständig ohne
      „Mehr anzeigen".
- [ ] Push bei abgemeldeter App: Login, danach direkt die Meldung.
- [ ] Glocken-Zähler stimmt mit der Anzahl ungelesener Beiträge überein; alle gelesen →
      Startkarte und Badge verschwinden vollständig.
- [ ] Ein Mitglied ohne Drohnengruppe sieht keine Drohnen-Nachrichten, auch nicht per
      Direktaufruf.
- [ ] Ein Feuerwehr-Admin ohne Drohnenrechte sieht die Drohnengruppe nicht als Empfänger.
- [ ] Die Push-Vorschau markiert dieselbe Stelle, an der das Gerät tatsächlich kürzt.
- [ ] Zeilenumbrüche des Verfassers erscheinen in der Detailansicht.
- [ ] **Neu**: ein Feuerwehr-Admin (kein Bezirksadmin) kann an die eigene Wehr senden, aber
      nicht an eine andere Wehr oder eine Drohnengruppe.
- [ ] **Neu**: ein Drohnengruppen-Admin kann an die eigene Gruppe senden, aber nicht an eine
      Feuerwehr.
- [ ] **Neu**: „Als Entwurf speichern" erzeugt einen Post, der in keinem Mitglieds-`/news`
      erscheint, bis er terminiert oder gesendet wird.
- [ ] **Neu**: „Terminieren" erzeugt einen Post, der erst beim Cronjob-Lauf nach dem
      Zieldatum verschickt wird, nicht sofort.
- [ ] **Neu**: kein Admin sieht eine „X von Y gelesen"-Auswertung irgendwo in der App.
