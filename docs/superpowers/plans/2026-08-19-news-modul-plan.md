# News-Modul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing `NewsMessage`-based News module with a `NewsPost`/`NewsRead`-based one
that (a) actually fixes the reported bug — tapping a push notification opens the specific message,
not the home screen — and (b) opens sending rights to Feuerwehr-/Drohnengruppen-Admins, gives every
member a real inbox to read full, untruncated messages, and tracks per-user read state.

**Architecture:** One Prisma migration (drop `NewsMessage`/`NewsAudienceType`, add `NewsPost`/
`NewsRead`/`NewsAudience`), a new permission tier, an extended push payload + rewritten service-worker
`notificationclick` handler, three reworked/new pages (`/news`, `/news/[newsPostId]`, `/news/neu`),
edit support for unsent posts, and new header-bell + home-screen-card UI.

**Tech Stack:** Unchanged — Next.js App Router, Prisma, `web-push`, `zod` + `react-hook-form`, shadcn
`AlertDialog` (already used elsewhere in this codebase, e.g. `admin/heimatfeuerwehr/feature-toggle-row.tsx`).

## Global Constraints

- Title: hard 65-character limit (was 100). Body: no length limit in the app (was 500) — only the
  push payload is truncated.
- Push truncation: ~170 characters, cut at the last word boundary before the limit, never mid-word.
- Exactly one of `fireDepartmentId`/`droneGroupId` is set per `NewsPost`, enforced by Zod, not left
  to chance. `droneGroupId = null` under `audience = DRONE_GROUP` means "all groups" (preserves the
  existing `NewsMessage.audienceDroneGroupId` convention exactly).
- `/news` and `/news/[newsPostId]` are readable by every member of the recipient circle (not just
  Bezirksadmin, as today) — sending/editing/deleting stays admin-gated.
- `getVisibleNews`/`getUnreadNewsCount` share one exported `buildVisibilityWhere` fragment — never two
  independently-written visibility conditions that could drift.
- **Prisma `undefined` field gotcha** (this codebase has been bitten by this before — see
  `src/lib/push/audience.ts`'s existing comments): a **nested relation** filter like
  `droneMembership: { is: { droneGroupId: x ?? undefined } }` is safe (`is:` still requires the
  relation to exist; only the inner field becomes unfiltered). A **bare top-level scalar** filter like
  `{ droneGroupId: x ?? undefined }` is NOT safe — `undefined` removes that field from the query
  entirely, matching every row regardless of `droneGroupId`, not just null ones. Every place in this
  plan that needs "match null OR a specific value" on `NewsPost.droneGroupId` (a plain column, not a
  relation) builds the `OR` array conditionally in JS instead of relying on `?? undefined`.
- News is not a 4th mobile tab (only 3 slots exist, see root `CLAUDE.md`) — reached via the header bell
  and the home-screen card.
- Bezirksweite Drohnengruppen-News (audience `DRONE_GROUP`, `droneGroupId` empty/"all groups") may only
  be sent by a Bezirksadmin or Bezirks-Drohnenadmin — mirrors the existing, identical rule for
  bezirksweite Kalender-Drohnengruppen-Termine (`canManageBezirksWideDroneEvent`), since it crosses a
  single group's boundary the same way.
- This repo has no automated test suite. Verify via `npx tsc --noEmit`, `npm run build`, and live
  manual verification against the local dev Postgres (`einsatz-foto-upload-postgres-1`, matching this
  worktree's `.env` `DATABASE_URL`).

---

### Task 1: Migration, permissions, visibility helpers

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/lib/news/audience.ts`
- Modify: `src/lib/auth/permissions.ts`

**Interfaces:**
- Produces: `NewsAudience` enum (`FIRE_DEPARTMENT`/`DRONE_GROUP`), `NewsPost`/`NewsRead` Prisma models.
- Produces (`src/lib/auth/permissions.ts`): `canSendNewsToFireDepartment(user, fireDepartmentId): boolean`,
  `canSendNewsToDroneGroup(user, droneGroup: {id: string; organizationId: string}): boolean`,
  `canSendBezirksWideDroneNews(user): boolean`, `canManageNewsPost(user, post: {createdById, audience,
  fireDepartmentId, droneGroupId}, droneGroup: {id, organizationId} | null): boolean`,
  `canSendAnyNews(user): boolean`.
- Produces (`src/lib/news/audience.ts`): `getNewsPostStatus(post: {scheduledAt: Date | null; sentAt:
  Date | null}): 'DRAFT' | 'SCHEDULED' | 'SENT'`, `buildVisibilityWhere(user: {homeOrganizationId:
  string; droneGroupId: string | null}): Prisma.NewsPostWhereInput`, `getVisibleNews(userId: string):
  Promise<VisibleNewsPost[]>`, `getUnreadNewsCount(userId: string): Promise<number>`,
  `resolveNewsAudienceUserIds(post: {audience, fireDepartmentId, droneGroupId}): Promise<string[]>`.

- [ ] **Step 1: Edit `prisma/schema.prisma`**

Remove the `NewsMessage` model and `NewsAudienceType` enum entirely, and their three reverse
relations: `Organization.newsMessages`, `DroneGroup.newsMessages`,
`User.newsMessagesCreated NewsMessage[] @relation("NewsCreatedBy")`.

Add this in their place (same general location in the file):

```prisma
enum NewsAudience {
  FIRE_DEPARTMENT
  DRONE_GROUP
}

model NewsPost {
  id               String       @id @default(cuid())
  audience         NewsAudience
  fireDepartmentId String?
  droneGroupId     String?
  title            String
  body             String
  eventId          String?
  scheduledAt      DateTime?
  sentAt           DateTime?
  createdById      String
  createdAt        DateTime     @default(now())

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

Add the new reverse relations on the three related models — find each model and add the listed line
inside its body (alongside its other relation fields, exact position doesn't matter):

- `Organization`: add `newsPosts NewsPost[]`
- `DroneGroup`: add `newsPosts NewsPost[]`
- `Event`: add `newsPosts NewsPost[]`
- `User`: add `newsPostsCreated NewsPost[] @relation("NewsPostCreatedBy")` and `newsReads NewsRead[]`

- [ ] **Step 2: Generate the migration**

```bash
npx prisma migrate dev --name news_modul
```

This is a normal schema migration (drop one table, add two), not a full database reset — it should
not trigger Prisma's AI-safety consent gate (that only applies to `migrate reset --force`, a full
wipe). If it does prompt for anything unexpected, or asks for `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`,
stop and report BLOCKED with the exact prompt text rather than proceeding.

- [ ] **Step 3: Add the permission functions to `src/lib/auth/permissions.ts`**

Remove the existing `canManageNews` function (it's being replaced). Add these in its place:

```ts
/**
 * News-Modul: Senderecht für eine konkrete Feuerwehr - Admin dieser Feuerwehr (canManageHeimatfeuerwehrFor,
 * das bereits Bezirksadmin miteinschließt) statt der bisherigen, ausschließlich auf Bezirksadmin
 * beschränkten Regel (siehe git-history dieser Datei für den alten Kommentar dazu) - explizit mit dem
 * App-Betreiber als gewünschte Rechte-Ausweitung bestätigt.
 */
export function canSendNewsToFireDepartment(user: SessionUser, fireDepartmentId: string): boolean {
  return canManageHeimatfeuerwehrFor(user, fireDepartmentId);
}

/** News-Modul: Senderecht für eine konkrete Drohnengruppe - identische Regel wie canManageDroneGroupFor
 * (Bezirksadmin, Bezirks-Drohnenadmin, Abschnittsadmin des verankerten Abschnitts, oder Admin dieser
 * Gruppe). */
export function canSendNewsToDroneGroup(user: SessionUser, droneGroup: { id: string; organizationId: string }): boolean {
  return canManageDroneGroupFor(user, droneGroup);
}

/** News-Modul: Senderecht für eine bezirksweite Drohnengruppen-News (droneGroupId leer = alle Gruppen) -
 * bewusst enger als canSendNewsToDroneGroup für eine einzelne Gruppe, exakt dieselbe Einschränkung wie
 * canManageBezirksWideDroneEvent im Kalender-Modul: ein einzelner Gruppen-Admin soll nicht über die
 * Grenzen seiner eigenen Gruppe hinaus an alle vier Gruppen senden dürfen. */
export function canSendBezirksWideDroneNews(user: SessionUser): boolean {
  return isBezirksAdmin(user) || user.isBezirksDrohnenAdmin;
}

/** News-Modul: Beitrag bearbeiten/löschen - Ersteller ODER Admin des Empfängerkreises. droneGroup ist
 * ein bereits geladenes Objekt ({id, organizationId}), NIE ein impliziter zweiter Prisma-Aufruf hier
 * drinnen - exakt dasselbe Muster wie canManageEvent(user, event, droneGroup) im Kalender-Modul. */
export function canManageNewsPost(
  user: SessionUser,
  post: { createdById: string; audience: NewsAudience; fireDepartmentId: string | null; droneGroupId: string | null },
  droneGroup: { id: string; organizationId: string } | null,
): boolean {
  if (post.createdById === user.id) return true;
  if (post.audience === 'FIRE_DEPARTMENT') return canSendNewsToFireDepartment(user, post.fireDepartmentId!);
  if (post.droneGroupId === null) return canSendBezirksWideDroneNews(user);
  return droneGroup !== null && canSendNewsToDroneGroup(user, droneGroup);
}

/** News-Modul: darf IRGENDEINEN Empfängerkreis ansprechen - steuert nur, ob "Verfassen"/die
 * Entwürfe-Verwaltung überhaupt sichtbar sind, keine Autorisierung für eine konkrete Aktion. */
export function canSendAnyNews(user: SessionUser): boolean {
  return isBezirksAdmin(user) || user.isBezirksDrohnenAdmin || user.feuerwehrAdminOrgIds.length > 0 || user.droneGroupRole === 'ADMIN';
}
```

Add `import type { NewsAudience } from '@prisma/client';` to this file's existing import block if
`@prisma/client` types aren't already imported there (check the top of the file first — several enums
from that package, e.g. `RsvpStatusOption`-adjacent types, may already be imported and this can be
added to the same line).

- [ ] **Step 4: Create `src/lib/news/audience.ts`**

```ts
import type { NewsAudience, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

export function getNewsPostStatus(post: { scheduledAt: Date | null; sentAt: Date | null }): 'DRAFT' | 'SCHEDULED' | 'SENT' {
  if (post.sentAt) return 'SENT';
  if (post.scheduledAt) return 'SCHEDULED';
  return 'DRAFT';
}

/** Einzige Quelle der Sichtbarkeitsregel - siehe Global Constraints zur Prisma-undefined-Falle:
 * droneGroupId ist eine reine Skalarspalte auf NewsPost (keine Relation), daher wird der
 * "null ODER meine Gruppe"-OR-Zweig in JS bedingt aufgebaut statt `droneGroupId: x ?? undefined` zu
 * schreiben - Letzteres würde bei x === null das Feld für Prisma komplett aus der Abfrage entfernen und
 * damit JEDE Gruppe matchen, nicht nur "alle Gruppen"-Beiträge. */
export function buildVisibilityWhere(user: { homeOrganizationId: string; droneGroupId: string | null }): Prisma.NewsPostWhereInput {
  return {
    sentAt: { not: null },
    OR: [
      { audience: 'FIRE_DEPARTMENT', fireDepartmentId: user.homeOrganizationId },
      {
        audience: 'DRONE_GROUP',
        OR: user.droneGroupId ? [{ droneGroupId: null }, { droneGroupId: user.droneGroupId }] : [{ droneGroupId: null }],
      },
    ],
  };
}

export interface VisibleNewsPost {
  id: string;
  audience: NewsAudience;
  fireDepartmentId: string | null;
  droneGroupId: string | null;
  title: string;
  body: string;
  eventId: string | null;
  sentAt: Date;
  createdAt: Date;
  createdByName: string;
  isRead: boolean;
}

/** Einzige Lesequelle für "welche News sieht dieser Nutzer" - /news, die Startbildschirm-Karte und der
 * Glocken-Zähler rufen alle diese (bzw. getUnreadNewsCount, das denselben buildVisibilityWhere-Ausschnitt
 * teilt) auf, nie eigene Prisma-Queries mit paralleler Sichtbarkeitslogik. */
export async function getVisibleNews(userId: string): Promise<VisibleNewsPost[]> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { homeOrganizationId: true, droneGroupId: true },
  });

  const posts = await prisma.newsPost.findMany({
    where: buildVisibilityWhere(user),
    include: {
      createdBy: { select: { firstName: true, lastName: true } },
      reads: { where: { userId }, select: { userId: true } },
    },
    orderBy: { sentAt: 'desc' },
  });

  return posts.map((post) => ({
    id: post.id,
    audience: post.audience,
    fireDepartmentId: post.fireDepartmentId,
    droneGroupId: post.droneGroupId,
    title: post.title,
    body: post.body,
    eventId: post.eventId,
    sentAt: post.sentAt!,
    createdAt: post.createdAt,
    createdByName: `${post.createdBy.firstName} ${post.createdBy.lastName}`,
    isRead: post.reads.length > 0,
  }));
}

/** Reine COUNT-Abfrage für den Glocken-Badge - teilt buildVisibilityWhere mit getVisibleNews statt einer
 * eigenen, potenziell abweichenden Sichtbarkeitsbedingung, holt aber keine vollen Beitragskörper. */
export async function getUnreadNewsCount(userId: string): Promise<number> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { homeOrganizationId: true, droneGroupId: true },
  });
  return prisma.newsPost.count({
    where: { ...buildVisibilityWhere(user), reads: { none: { userId } } },
  });
}

/** Zielgruppe für den tatsächlichen Push-Versand (dispatch-news.ts) - beantwortet "welche Nutzer sollen
 * DIESEN Beitrag benachrichtigt bekommen", nicht "was kann DIESER Nutzer sehen" (das ist getVisibleNews). */
export async function resolveNewsAudienceUserIds(post: {
  audience: NewsAudience;
  fireDepartmentId: string | null;
  droneGroupId: string | null;
}): Promise<string[]> {
  if (post.audience === 'DRONE_GROUP') {
    // droneGroupId null bedeutet "alle Gruppen". Das explizite `is: {...}` (statt eines nackten
    // droneGroupId-Felds) verlangt weiterhin, dass die droneMembership-Relation existiert - ein auf
    // undefined gesetztes Feld ließe Prisma dieses Feld bei einem VERSCHACHTELTEN Relations-Filter gar
    // nicht filtern (anders als bei einer nackten Skalarspalte, siehe buildVisibilityWhere oben) - live
    // bereits einmal bestätigter Bug, siehe src/lib/push/audience.ts's resolveEventAudienceUserIds.
    const members = await prisma.user.findMany({
      where: { isActive: true, droneMembership: { is: { droneGroupId: post.droneGroupId ?? undefined } } },
      select: { id: true },
    });
    return members.map((m) => m.id);
  }
  if (!post.fireDepartmentId) return [];
  const members = await prisma.user.findMany({
    where: { homeOrganizationId: post.fireDepartmentId, isActive: true },
    select: { id: true },
  });
  return members.map((m) => m.id);
}
```

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: errors in `src/app/(app)/news/**`, `src/lib/news/send-news.ts`, `src/lib/push/audience.ts`,
`src/components/news/news-form.tsx`, `src/lib/validation/news.schema.ts`, `src/app/api/cron/send-scheduled-news/route.ts`
(all still reference the now-deleted `NewsMessage`/`canManageNews` — these are fixed in later tasks, not
this one). **Zero errors** should come from `src/lib/auth/permissions.ts` or `src/lib/news/audience.ts`
themselves — if either of those two files has an error, fix it before continuing.

- [ ] **Step 6: Live-verify against the local dev Postgres**

Seed one `NewsPost` row directly via SQL (`docker exec -i einsatz-foto-upload-postgres-1 psql -U ffapp
-d ffapp` — adjust user/db if `.env`'s `DATABASE_URL` differs) and confirm `getVisibleNews`/
`getUnreadNewsCount` behave correctly via a throwaway `npx tsx` script:

```bash
docker exec -i einsatz-foto-upload-postgres-1 psql -U ffapp -d ffapp -c '
SELECT id FROM "Organization" WHERE type = '"'"'FEUERWEHR'"'"' LIMIT 1;
'
docker exec -i einsatz-foto-upload-postgres-1 psql -U ffapp -d ffapp -c '
SELECT id, email, "homeOrganizationId" FROM "User" LIMIT 1;
'
```

Using the returned IDs, insert one sent `NewsPost` for that Feuerwehr:

```bash
docker exec -i einsatz-foto-upload-postgres-1 psql -U ffapp -d ffapp -c "
INSERT INTO \"NewsPost\" (id, audience, \"fireDepartmentId\", title, body, \"createdById\", \"sentAt\")
VALUES ('test-news-1', 'FIRE_DEPARTMENT', '<org-id>', 'Testtitel', 'Testtext', '<user-id>', now());
"
```

Then run (with `DATABASE_URL` exported from `.env`, since a plain `node`/`tsx` script doesn't
auto-load it the way Next.js does):

```bash
export DATABASE_URL=$(grep '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"')
npx tsx -e "
import { getVisibleNews, getUnreadNewsCount } from './src/lib/news/audience';
(async () => {
  console.log('visible:', await getVisibleNews('<user-id>'));
  console.log('unread:', await getUnreadNewsCount('<user-id>'));
})();
"
```

Expected: `visible` contains the seeded post with `isRead: false`; `unread` is `1`. Then insert a
`NewsRead` row for that (post, user) pair and re-run — expect `unread: 0` and the post's `isRead: true`
in the `visible` array.

Clean up afterward:

```bash
docker exec -i einsatz-foto-upload-postgres-1 psql -U ffapp -d ffapp -c "
DELETE FROM \"NewsRead\" WHERE \"newsPostId\" = 'test-news-1';
DELETE FROM \"NewsPost\" WHERE id = 'test-news-1';
"
```

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/auth/permissions.ts src/lib/news/audience.ts
git commit -m "feat: replace NewsMessage with NewsPost/NewsRead, add News permission tier"
```

---

### Task 2: Push payload, dispatch logic, service worker fix

**Files:**
- Modify: `src/lib/push/web-push-client.ts`
- Create: `src/lib/news/dispatch-news.ts`
- Delete: `src/lib/news/send-news.ts`
- Modify: `src/lib/push/audience.ts` (remove `resolveAudienceUserIds` only — `resolveEventAudienceUserIds` stays, it's unrelated to News, used by the Kalender module's own immediate-push feature)
- Modify: `public/sw.js`
- Modify: `src/app/api/cron/send-scheduled-news/route.ts`

**Interfaces:**
- Consumes: `resolveNewsAudienceUserIds` from Task 1's `src/lib/news/audience.ts`.
- Produces: `truncateForPush(body: string, maxLength?: number): string` and `dispatchNewsPost(newsPostId:
  string): Promise<DispatchResult>` from `src/lib/news/dispatch-news.ts`, both exported and consumed by
  Task 6 (compose action) and this task's own cron route update.

- [ ] **Step 1: Extend `PushPayload` in `src/lib/push/web-push-client.ts`**

Find:
```ts
export interface PushPayload {
  title: string;
  body: string;
}
```
Replace with:
```ts
export interface PushPayload {
  title: string;
  body: string;
  data?: { url: string };
}
```
No other change to this file — `JSON.stringify(payload)` already serializes the new optional field
automatically; `sendEventPushNow`'s existing calls (which never set `data`) are unaffected since the
field is optional.

- [ ] **Step 2: Remove `resolveAudienceUserIds` from `src/lib/push/audience.ts`**

Delete only the `resolveAudienceUserIds` function (the first function in the file) and its
`NewsAudienceType` import if nothing else in the file needs it — **keep** `resolveEventAudienceUserIds`
and its own imports/comments completely untouched, it's the Kalender module's own function, unrelated
to News.

- [ ] **Step 3: Create `src/lib/news/dispatch-news.ts`**

```ts
import { prisma } from '@/lib/db/prisma';
import { resolveNewsAudienceUserIds } from '@/lib/news/audience';
import { sendPushToSubscriptions } from '@/lib/push/web-push-client';

export interface DispatchResult {
  sent: number;
  recipients: number;
}

const PUSH_TRUNCATE_LENGTH = 170;

/** Kürzt an der letzten Wortgrenze vor maxLength (nie mitten im Wort) und hängt eine Ellipse an - die
 * volle Nutzlast würde bei langen Texten das 4-KB-Payload-Limit von Web Push riskieren, und ein
 * Abschneiden mitten im Wort sähe auf dem Sperrbildschirm kaputt aus. */
export function truncateForPush(body: string, maxLength = PUSH_TRUNCATE_LENGTH): string {
  if (body.length <= maxLength) return body;
  const cut = body.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : maxLength)}…`;
}

/** Löst die Zielgruppe auf, versendet per Web-Push an alle registrierten Geräte (mit data.url für das
 * Sprungziel des Push-Klicks) und markiert den Beitrag als gesendet. Idempotent: bereits gesendete
 * Beiträge werden übersprungen. */
export async function dispatchNewsPost(newsPostId: string): Promise<DispatchResult> {
  const post = await prisma.newsPost.findUnique({ where: { id: newsPostId } });
  if (!post) {
    throw new Error('News-Beitrag wurde nicht gefunden.');
  }
  if (post.sentAt) {
    return { sent: 0, recipients: 0 };
  }

  const userIds = await resolveNewsAudienceUserIds(post);
  const subscriptions = userIds.length > 0 ? await prisma.pushSubscription.findMany({ where: { userId: { in: userIds } } }) : [];

  const { sent, staleIds } = await sendPushToSubscriptions(subscriptions, {
    title: post.title,
    body: truncateForPush(post.body),
    data: { url: `/news/${post.id}` },
  });

  if (staleIds.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: staleIds } } });
  }

  await prisma.newsPost.update({ where: { id: post.id }, data: { sentAt: new Date() } });

  return { sent, recipients: subscriptions.length };
}
```

- [ ] **Step 4: Delete `src/lib/news/send-news.ts`**

- [ ] **Step 5: Rewrite `public/sw.js`'s `push` and `notificationclick` handlers**

Find:
```js
// News-Modul: eingehende Web-Push-Nachricht als Benachrichtigung anzeigen.
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = { title: 'AFKDO Purkersdorf', body: '' };
  try {
    payload = event.data.json();
  } catch {
    payload.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
    })
  );
});

// Klick auf die Benachrichtigung: bereits offenes Fenster fokussieren statt ein neues zu öffnen.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow('/kalender');
    })
  );
});
```

Replace with:

```js
// News-Modul: eingehende Web-Push-Nachricht als Benachrichtigung anzeigen. data.url (falls vorhanden)
// wird an showNotification durchgereicht, damit notificationclick unten weiß, wohin ein Tap führen soll.
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = { title: 'AFKDO Purkersdorf', body: '' };
  try {
    payload = event.data.json();
  } catch {
    payload.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: payload.data,
    })
  );
});

// Klick auf die Benachrichtigung: öffnet/fokussiert data.url (die konkrete News-Meldung), fällt auf
// /kalender zurück, falls keine data.url mitgeschickt wurde (z. B. der ältere, News-unabhängige
// Kalender-Sofortversand). Ein bereits offenes Fenster wird fokussiert UND zur Ziel-URL navigiert -
// focus() allein würde die zuvor geöffnete Seite unverändert lassen.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/kalender';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const existing = clientList.find((c) => c.url.includes(self.location.origin));
      if (existing) {
        existing.focus();
        return existing.navigate(url);
      }
      return self.clients.openWindow(url);
    })
  );
});
```

- [ ] **Step 6: Update the cron route**

File: `src/app/api/cron/send-scheduled-news/route.ts`. Replace:
```ts
import { dispatchNewsMessage } from '@/lib/news/send-news';
```
with:
```ts
import { dispatchNewsPost } from '@/lib/news/dispatch-news';
```
Replace `prisma.newsMessage.findMany` with `prisma.newsPost.findMany` (same `where`/`select` shape,
field names unchanged: `sentAt`/`scheduledAt`), and `dispatchNewsMessage(news.id)` with
`dispatchNewsPost(news.id)` in the `Promise.allSettled(due.map(...))` line. No other change to this
file — `recordNewsCronRun()`, the secret-gating, and the response shape are untouched.

- [ ] **Step 7: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: same remaining errors as Task 1's Step 5 minus anything in `send-news.ts` (deleted),
`web-push-client.ts`, `dispatch-news.ts`, `public/sw.js` (not type-checked), or the cron route — those
four are now clean. Remaining errors are in `src/app/(app)/news/**`, `src/components/news/news-form.tsx`,
`src/lib/validation/news.schema.ts` (fixed in later tasks).

- [ ] **Step 8: Live-verify the dispatch + truncation**

```bash
export DATABASE_URL=$(grep '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"')
npx tsx -e "
import { truncateForPush } from './src/lib/news/dispatch-news';
const long = 'A'.repeat(160) + ' word ' + 'B'.repeat(20);
console.log(truncateForPush(long));
console.log('length:', truncateForPush(long).length, '(should be <= 171, i.e. <= 170 + the ellipsis char)');
console.log(truncateForPush('short text'));
"
```
Expected: the long case cuts before `'B'.repeat(20)` (at the last space before 170 chars) and ends
with `…`; the short case is returned unchanged.

Re-seed the same test `NewsPost` from Task 1 Step 6 (fresh row, `sentAt` left `NULL` this time so
`dispatchNewsPost` actually has something to do):

```bash
docker exec -i einsatz-foto-upload-postgres-1 psql -U ffapp -d ffapp -c "
INSERT INTO \"NewsPost\" (id, audience, \"fireDepartmentId\", title, body, \"createdById\")
VALUES ('test-news-2', 'FIRE_DEPARTMENT', '<org-id>', 'Testtitel', 'Testtext', '<user-id>');
"
export DATABASE_URL=$(grep '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"')
npx tsx -e "
import { dispatchNewsPost } from './src/lib/news/dispatch-news';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
(async () => {
  const result = await dispatchNewsPost('test-news-2');
  console.log('dispatch result:', result);
  const row = await prisma.newsPost.findUnique({ where: { id: 'test-news-2' } });
  console.log('sentAt now set:', row.sentAt !== null);
  await prisma.\$disconnect();
})();
"
```
Expected: `result.recipients` matches the seeded org's active member count (likely 0 real
`PushSubscription` rows in this dev environment, so `sent: 0` is fine — the point is confirming
`sentAt` gets set and no error is thrown, since real VAPID push delivery can't be verified without a
real subscribed device). Note in your report if `S3`/VAPID env vars are placeholder-only in this
environment — that's expected, not a bug.

Clean up:
```bash
docker exec -i einsatz-foto-upload-postgres-1 psql -U ffapp -d ffapp -c "DELETE FROM \"NewsPost\" WHERE id = 'test-news-2';"
```

- [ ] **Step 9: Commit**

```bash
git add src/lib/push/web-push-client.ts src/lib/news/dispatch-news.ts src/lib/push/audience.ts public/sw.js src/app/api/cron/send-scheduled-news/route.ts
git rm src/lib/news/send-news.ts
git commit -m "fix: deep-link push notifications to the specific News post (issue #17)"
```

---

### Task 3: `/news/[newsPostId]` detail page

**Files:**
- Create: `src/app/(app)/news/[newsPostId]/page.tsx`

**Interfaces:**
- Consumes: `buildVisibilityWhere` from Task 1's `src/lib/news/audience.ts`.

- [ ] **Step 1: Create the detail page**

```tsx
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { buildVisibilityWhere } from '@/lib/news/audience';

const AUDIENCE_STRIPE_COLOR: Record<'FIRE_DEPARTMENT' | 'DRONE_GROUP', string> = {
  FIRE_DEPARTMENT: '#1c1c1e',
  DRONE_GROUP: '#22a06b',
};

export default async function NewsPostDetailPage({ params }: { params: Promise<{ newsPostId: string }> }) {
  const user = await requireUser();
  const { newsPostId } = await params;

  const post = await prisma.newsPost.findFirst({
    where: {
      id: newsPostId,
      ...buildVisibilityWhere({ homeOrganizationId: user.homeOrganizationId, droneGroupId: user.droneGroupId }),
    },
    include: {
      createdBy: { select: { firstName: true, lastName: true } },
      fireDepartment: { select: { shortName: true, name: true } },
      droneGroup: { select: { name: true } },
      event: { select: { id: true, title: true, startsAt: true } },
    },
  });
  if (!post) notFound();

  // Beim Rendern setzen, nicht bei einem Client-seitigen Scroll-Event (Design-Spec §6) - derselbe
  // "Mutation direkt aus einer Server-Component-Render-Phase" Ansatz wie decideVehicleBooking im
  // Fahrzeug-Reservierungs-Modul (siehe dessen Kommentar zu revalidatePath für die eine Ausnahme, die
  // hier nicht zutrifft - wir rufen hier keine revalidatePath auf).
  await prisma.newsRead.upsert({
    where: { newsPostId_userId: { newsPostId: post.id, userId: user.id } },
    create: { newsPostId: post.id, userId: user.id },
    update: {},
  });

  const senderLabel =
    post.audience === 'FIRE_DEPARTMENT'
      ? (post.fireDepartment?.shortName ?? post.fireDepartment?.name ?? '–')
      : (post.droneGroup?.name ?? 'Drohnengruppe (alle Gruppen)');

  return (
    <div className="flex flex-col gap-4">
      <Link href="/news" className="text-sm text-neutral-600 hover:underline">
        ← Zurück zu Nachrichten
      </Link>
      <div className="overflow-hidden rounded-lg bg-white shadow-sm">
        <div className="h-1.5" style={{ backgroundColor: AUDIENCE_STRIPE_COLOR[post.audience] }} />
        <div className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{senderLabel}</p>
          <h1 className="mt-1 text-[25px] font-bold leading-tight text-neutral-900">{post.title}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {post.sentAt!.toLocaleDateString('de-AT')} ·{' '}
            {post.sentAt!.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })} ·{' '}
            {post.createdBy.firstName} {post.createdBy.lastName}
          </p>
          <div className="mt-4 whitespace-pre-wrap text-[16px] leading-[1.55] text-neutral-800">{post.body}</div>
          {post.event && (
            <Link
              href={`/kalender/${post.event.id}`}
              className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-neutral-50 p-3 text-sm"
            >
              <span className="flex items-center gap-2 text-neutral-800">
                <span aria-hidden>📅</span>
                <span>
                  {post.event.title} · {post.event.startsAt.toLocaleDateString('de-AT')}
                </span>
              </span>
              <span aria-hidden className="text-neutral-400">
                ›
              </span>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors from this file.

- [ ] **Step 3: Live-verify**

Seed one sent `NewsPost` for a real Feuerwehr and one for a different Feuerwehr (reuse the seeding
pattern from Task 1 Step 6). Start the dev server (`npm run dev` — this page needs no client-side
interactivity to verify, only server-rendered text, so this repo's usual CSP/hydration limitation
doesn't block this check) and, logged in as a user of the first Feuerwehr:
1. Load `/news/<own-post-id>` — confirm the full body text renders untruncated, sender/date line is
   correct.
2. Load `/news/<other-feuerwehr-post-id>` — confirm a real 404 (Next.js's `notFound()` page), not an
   error or a redirect.
3. Query the DB directly to confirm a `NewsRead` row now exists for (own-post-id, this user) after
   step 1's page load, and does NOT exist for (other-feuerwehr-post-id, this user) since that request
   never reached the upsert (blocked by `notFound()` first).

Clean up all seeded test data afterward.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/news/[newsPostId]/page.tsx"
git commit -m "feat: add News detail page (issue #17)"
```

---

### Task 4: `/news` list page rework

**Files:**
- Modify: `src/app/(app)/news/page.tsx`

**Interfaces:**
- Consumes: `getVisibleNews`, `getNewsPostStatus` from Task 1; `canSendAnyNews`, `canManageNewsPost`
  from Task 1.

- [ ] **Step 1: Rewrite `src/app/(app)/news/page.tsx`**

```tsx
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canSendAnyNews, canManageNewsPost } from '@/lib/auth/permissions';
import { getVisibleNews, getNewsPostStatus } from '@/lib/news/audience';

const PAGE_SIZE = 30;

const AUDIENCE_STRIPE_CLASS: Record<'FIRE_DEPARTMENT' | 'DRONE_GROUP', string> = {
  FIRE_DEPARTMENT: 'bg-[#1c1c1e]',
  DRONE_GROUP: 'bg-[#22a06b]',
};

type FilterValue = 'ALLE' | 'FIRE_DEPARTMENT' | 'DRONE_GROUP';

export default async function NewsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string }>;
}) {
  const user = await requireUser();
  const { filter: rawFilter, page: rawPage } = await searchParams;
  const filter: FilterValue = rawFilter === 'FIRE_DEPARTMENT' || rawFilter === 'DRONE_GROUP' ? rawFilter : 'ALLE';
  const page = Math.max(1, Number.parseInt(rawPage ?? '1', 10) || 1);

  const allVisible = await getVisibleNews(user.id);
  const filtered = filter === 'ALLE' ? allVisible : allVisible.filter((post) => post.audience === filter);
  const unreadCount = allVisible.filter((post) => !post.isRead).length;
  const pageStart = (page - 1) * PAGE_SIZE;
  const pagePosts = filtered.slice(pageStart, pageStart + PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const fireDepartmentCount = allVisible.filter((post) => post.audience === 'FIRE_DEPARTMENT').length;
  const droneGroupCount = allVisible.filter((post) => post.audience === 'DRONE_GROUP').length;

  const canCompose = canSendAnyNews(user);
  let draftsAndScheduled: Awaited<ReturnType<typeof loadDraftsAndScheduled>> = [];
  if (canCompose) {
    draftsAndScheduled = await loadDraftsAndScheduled(user);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">Nachrichten</h1>
          {unreadCount > 0 && <p className="text-sm text-neutral-500">{unreadCount} ungelesen</p>}
        </div>
        {canCompose && (
          <Link href="/news/neu" className="rounded bg-brand px-3 py-1.5 font-medium text-white hover:bg-brand-dark">
            Verfassen
          </Link>
        )}
      </div>

      <div className="flex gap-2 text-sm">
        {(
          [
            ['ALLE', `Alle ${allVisible.length}`],
            ['FIRE_DEPARTMENT', `Feuerwehr ${fireDepartmentCount}`],
            ['DRONE_GROUP', `Drohnen ${droneGroupCount}`],
          ] as const
        ).map(([value, label]) => (
          <Link
            key={value}
            href={value === 'ALLE' ? '/news' : `/news?filter=${value}`}
            className={`rounded-full px-3 py-1 ${filter === value ? 'bg-brand text-white' : 'bg-neutral-100 text-neutral-700'}`}
          >
            {label}
          </Link>
        ))}
      </div>

      {pagePosts.length === 0 ? (
        <div className="rounded-lg bg-white p-6 text-center text-sm text-neutral-500 shadow-sm">Noch keine Nachrichten.</div>
      ) : (
        <ul className="flex flex-col overflow-hidden rounded-lg bg-white shadow-sm">
          {pagePosts.map((post) => (
            <li key={post.id} className="flex border-b border-neutral-100 last:border-0">
              <span className={`w-1.5 flex-none ${post.isRead ? 'bg-neutral-200' : AUDIENCE_STRIPE_CLASS[post.audience]}`} />
              <Link href={`/news/${post.id}`} className="flex flex-1 items-start gap-2 px-4 py-3">
                {!post.isRead && <span aria-hidden className="mt-1.5 h-2 w-2 flex-none rounded-full bg-brand" />}
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{post.createdByName}</p>
                  <p className={`truncate ${post.isRead ? 'font-medium text-neutral-600' : 'font-semibold text-neutral-900'}`}>
                    {post.title}
                  </p>
                  <p className="line-clamp-2 text-sm text-neutral-500">{post.body}</p>
                </div>
                <span className="flex-none whitespace-nowrap text-xs text-neutral-400">{post.sentAt.toLocaleDateString('de-AT')}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          {page > 1 && (
            <Link href={`/news?filter=${filter}&page=${page - 1}`} className="text-brand hover:underline">
              ← Zurück
            </Link>
          )}
          <span className="text-neutral-500">
            Seite {page} von {totalPages}
          </span>
          {page < totalPages && (
            <Link href={`/news?filter=${filter}&page=${page + 1}`} className="text-brand hover:underline">
              Weiter →
            </Link>
          )}
        </div>
      )}

      {canCompose && draftsAndScheduled.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-neutral-900">Entwürfe &amp; Geplant</h2>
          <ul className="flex flex-col overflow-hidden rounded-lg bg-white shadow-sm">
            {draftsAndScheduled.map((post) => (
              <li key={post.id} className="flex items-center justify-between gap-2 border-b border-neutral-100 px-4 py-3 last:border-0">
                <div className="min-w-0">
                  <p className="truncate font-medium text-neutral-900">{post.title}</p>
                  <p className="text-xs text-neutral-500">
                    {getNewsPostStatus(post) === 'DRAFT' ? 'Entwurf' : `Geplant für ${post.scheduledAt!.toLocaleString('de-AT')}`}
                  </p>
                </div>
                <Link href={`/news/${post.id}/bearbeiten`} className="flex-none text-sm text-brand hover:underline">
                  Bearbeiten
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

async function loadDraftsAndScheduled(user: Awaited<ReturnType<typeof requireUser>>) {
  const posts = await prisma.newsPost.findMany({
    where: { sentAt: null },
    include: { droneGroup: { select: { id: true, organizationId: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return posts.filter((post) => canManageNewsPost(user, post, post.droneGroup));
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors from this file (other files' pre-existing errors from `news-form.tsx`/
`news.schema.ts` remain until Task 6).

- [ ] **Step 3: Live-verify**

Seed a mix: 2 sent `NewsPost` rows for the test user's own Feuerwehr (one read, one unread — insert a
matching `NewsRead` row for the "read" one), 1 sent for a different Feuerwehr (should never appear), 1
`DRAFT` (both `scheduledAt`/`sentAt` null) created by the test user's own Feuerwehr. Load `/news` as
that user and confirm: the unread count matches, the two own-Feuerwehr posts appear (correct
read/unread visual distinction — dot + weight + color together, not just one), the other Feuerwehr's
post does not appear, and (if the user has send rights) the draft appears in "Entwürfe & Geplant" with
a "Bearbeiten" link. Clean up all seeded rows afterward.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/news/page.tsx"
git commit -m "feat: rework /news into a reader-facing inbox for all members (issue #17)"
```

---

### Task 5: Header bell + badge, home-screen card

**Files:**
- Modify: `src/components/layout/profile-menu.tsx`
- Modify: `src/app/(app)/layout.tsx`
- Modify: `src/app/(app)/meine-feuerwehr/page.tsx`

**Interfaces:**
- Consumes: `getVisibleNews`, `getUnreadNewsCount` from Task 1.

- [ ] **Step 1: Add `unreadNewsCount` to `ProfileMenuProps` and change the bell to a `<Link>`**

In `src/components/layout/profile-menu.tsx`, add `unreadNewsCount: number;` to the `ProfileMenuProps`
interface (alongside `canManageNews: boolean;` — **do not remove `canManageNews` from this file's props
yet**, Task 6 will replace it with `canSendAnyNews` at the same time it reworks the compose form; for
this task, keep the existing prop name and value flowing through unchanged so this task's diff stays
scoped to the bell/badge).

Find:
```tsx
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={pushEnabled ? 'Push-Benachrichtigungen aktiv' : 'Push-Benachrichtigungen inaktiv'}
        title={pushEnabled ? 'Push-Benachrichtigungen aktiv' : 'Push-Benachrichtigungen inaktiv'}
        className={`rounded p-1.5 hover:bg-white/10 ${pushEnabled ? 'text-green-400' : 'text-red-400'}`}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M10 21a2 2 0 0 0 4 0" strokeLinecap="round" />
        </svg>
      </button>
```

Replace with (note: `Link` is already imported at the top of this file for the mobile News link further
down — no new import needed):

```tsx
      <Link
        href="/news"
        aria-label={
          unreadNewsCount > 0
            ? `${unreadNewsCount} ungelesene Nachrichten - Push-Benachrichtigungen ${pushEnabled ? 'aktiv' : 'inaktiv'}`
            : `Push-Benachrichtigungen ${pushEnabled ? 'aktiv' : 'inaktiv'}`
        }
        title={pushEnabled ? 'Push-Benachrichtigungen aktiv' : 'Push-Benachrichtigungen inaktiv'}
        className={`relative rounded p-1.5 hover:bg-white/10 ${pushEnabled ? 'text-green-400' : 'text-red-400'}`}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M10 21a2 2 0 0 0 4 0" strokeLinecap="round" />
        </svg>
        {unreadNewsCount > 0 && (
          <span
            aria-hidden
            className="absolute -right-1 -top-1 flex h-[19px] min-w-[19px] items-center justify-center rounded-full border-2 border-[#1c1c1e] bg-brand px-1 text-[10px] font-bold leading-none text-white"
          >
            {unreadNewsCount > 99 ? '99+' : unreadNewsCount}
          </span>
        )}
      </Link>
```

Add `unreadNewsCount` to the function's destructured props list (alongside `canManageNews`, etc.).

Note the badge's border color `border-[#1c1c1e]` is hardcoded to match the header's normal (non-dev-stage)
background — this pre-existing bell was already colored assuming the standard header, unaffected by the
dev-stage orange header variant (`(app)/layout.tsx`'s `isDevStage` conditional), same as today.

- [ ] **Step 2: Wire the count through `(app)/layout.tsx`**

In `src/app/(app)/layout.tsx`, add the import:
```ts
import { getUnreadNewsCount } from '@/lib/news/audience';
```

Find the `Promise.all` that loads `homeOrganization`/`adminOrganizations` and add a third parallel call:
```ts
  const [homeOrganization, adminOrganizations, unreadNewsCount] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: user.homeOrganizationId },
      select: { id: true, name: true, shortName: true, type: true, wappenImageMimeType: true },
    }),
    user.feuerwehrAdminOrgIds.length > 0
      ? prisma.organization.findMany({ where: { id: { in: user.feuerwehrAdminOrgIds } } })
      : Promise.resolve([]),
    getUnreadNewsCount(user.id),
  ]);
```

Pass it to `<ProfileMenu>`:
```tsx
              <ProfileMenu
                name={user.name}
                email={user.email}
                homeOrganizationName={homeOrganization?.shortName ?? homeOrganization?.name ?? '–'}
                isSiteAdmin={isBezirksAdmin(user)}
                adminOrganizationNames={adminOrganizations.map((org) => org.shortName ?? org.name)}
                isDrohnengruppeMember={user.isDrohnengruppeMember}
                canManageNews={canManageNews(user)}
                unreadNewsCount={unreadNewsCount}
                vapidPublicKey={process.env.VAPID_PUBLIC_KEY ?? null}
                logoutAction={logoutAction}
              />
```

(`canManageNews` here still refers to the not-yet-removed import from `permissions.ts` — Task 6 replaces
this specific line with `canSendAnyNews(user)` in the same pass it removes `canManageNews` entirely; for
this task, leave that one line and its import untouched so this diff stays scoped to the new count.)

- [ ] **Step 3: Add the "Neue Nachrichten" card to `/meine-feuerwehr`**

In `src/app/(app)/meine-feuerwehr/page.tsx`, add the import:
```ts
import { getVisibleNews } from '@/lib/news/audience';
```

Add a call to `getVisibleNews(user.id)` inside the existing top-level `Promise.all` (it already
destructures `[me, candidateEventsRaw, vehicles, myBookings, orgFeatures, recentPhotoUploads]` — extend
both the array and the destructuring to include a sixth/new entry, e.g. append
`getVisibleNews(user.id)` as a new promise and `visibleNews` as its destructured name), then compute:

```ts
  const unreadNews = visibleNews.filter((post) => !post.isRead).slice(0, 2);
```

Render the card directly above the existing `<HomeTodoList .../>` line (i.e. as the very first content
element inside the outer `<div className="flex flex-col gap-5">`, before `<div><h1>Servus, ...</h1>...`
— re-read the "Goal" of Design Spec §4: this card sits "ganz oben, vor Als Nächstes", and `HomeTodoList`
is what renders "Als Nächstes" further down, so the card must land before the greeting block too, at the
very top of the returned JSX):

```tsx
      {unreadNews.length > 0 && (
        <div className="flex flex-col overflow-hidden rounded-xl bg-white shadow-sm">
          <div className="flex items-center justify-between px-4 pt-3">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[#8e8e93]">Neue Nachrichten</span>
            <Link href="/news" className="text-xs font-medium text-brand hover:underline">
              Alle {visibleNews.filter((post) => !post.isRead).length}
            </Link>
          </div>
          <ul className="flex flex-col">
            {unreadNews.map((post) => (
              <li key={post.id} className="flex border-t border-neutral-100 first:border-t-0">
                <span className={`w-1 flex-none ${post.audience === 'FIRE_DEPARTMENT' ? 'bg-[#1c1c1e]' : 'bg-[#22a06b]'}`} />
                <Link href={`/news/${post.id}`} className="min-w-0 flex-1 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{post.createdByName}</p>
                  <p className="truncate font-semibold text-neutral-900">{post.title}</p>
                  <p className="truncate text-sm text-neutral-500">{post.body}</p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors from these three files.

- [ ] **Step 5: Live-verify**

Seed 3 unread, sent `NewsPost` rows for the test user's own Feuerwehr. Load `/meine-feuerwehr` as that
user: confirm the "Neue Nachrichten" card shows exactly 2 of them (not 3) with a "Alle 3" link, and that
the header bell shows a badge with `3`. Mark all 3 as read (insert `NewsRead` rows, or click through
each detail page) and reload: confirm the card disappears entirely (no placeholder) and the badge is
gone. Clean up seeded data afterward.

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/profile-menu.tsx "src/app/(app)/layout.tsx" "src/app/(app)/meine-feuerwehr/page.tsx"
git commit -m "feat: add unread-News bell badge and home-screen card (issue #17)"
```

---

### Task 6: `/news/neu` compose page rework

**Files:**
- Modify: `src/lib/validation/news.schema.ts`
- Modify: `src/app/(app)/news/actions.ts`
- Modify: `src/app/(app)/news/neu/page.tsx`
- Modify: `src/components/news/news-form.tsx` (renamed in place — file path unchanged, content fully replaced)
- Modify: `src/components/layout/profile-menu.tsx` (rename the `canManageNews` prop)
- Modify: `src/app/(app)/layout.tsx` (rename the `canManageNews` call to `canSendAnyNews`)

**Interfaces:**
- Consumes: `canSendAnyNews`, `canSendNewsToFireDepartment`, `canSendNewsToDroneGroup`,
  `canSendBezirksWideDroneNews` from Task 1; `dispatchNewsPost` from Task 2; `truncateForPush` from
  Task 2 (used by the client-side live preview, imported into a client component — it's a pure function
  with no server-only imports, safe to bundle client-side).

- [ ] **Step 1: Rewrite `src/lib/validation/news.schema.ts`**

```ts
import { z } from 'zod';

export const NEWS_AUDIENCES = ['FIRE_DEPARTMENT', 'DRONE_GROUP'] as const;
export type NewsAudienceOption = (typeof NEWS_AUDIENCES)[number];

export const NEWS_SEND_MODES = ['DRAFT', 'SCHEDULED', 'NOW'] as const;
export type NewsSendMode = (typeof NEWS_SEND_MODES)[number];

export const newsSchema = z
  .object({
    title: z.string().trim().min(1, 'Titel ist erforderlich.').max(65),
    body: z.string().trim().min(1, 'Text ist erforderlich.'),
    audience: z.enum(NEWS_AUDIENCES),
    fireDepartmentId: z.string().optional().or(z.literal('')),
    // Leer bedeutet "Alle Gruppen" (mappt serverseitig auf null) - eine bewusst weiterhin gültige
    // Auswahl, kein Kompatibilitäts-Notbehelf (siehe NewsPost.droneGroupId im Schema).
    droneGroupId: z.string().nullable().optional().or(z.literal('')),
    eventId: z.string().optional().or(z.literal('')),
    sendMode: z.enum(NEWS_SEND_MODES),
    scheduledAt: z.string().optional().or(z.literal('')),
  })
  .refine((data) => data.audience !== 'FIRE_DEPARTMENT' || Boolean(data.fireDepartmentId), {
    message: 'Feuerwehr ist erforderlich.',
    path: ['fireDepartmentId'],
  })
  .refine((data) => data.sendMode !== 'SCHEDULED' || Boolean(data.scheduledAt), {
    message: 'Datum/Uhrzeit ist erforderlich.',
    path: ['scheduledAt'],
  });

export type NewsInput = z.infer<typeof newsSchema>;

export function parseNewsFormData(formData: FormData) {
  return {
    title: String(formData.get('title') ?? ''),
    body: String(formData.get('body') ?? ''),
    audience: String(formData.get('audience') ?? 'FIRE_DEPARTMENT'),
    fireDepartmentId: String(formData.get('fireDepartmentId') ?? ''),
    droneGroupId: String(formData.get('droneGroupId') ?? ''),
    eventId: String(formData.get('eventId') ?? ''),
    sendMode: String(formData.get('sendMode') ?? 'DRAFT'),
    scheduledAt: String(formData.get('scheduledAt') ?? ''),
  };
}
```

- [ ] **Step 2: Rewrite `src/app/(app)/news/actions.ts`**

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import {
  assertPermission,
  canSendAnyNews,
  canSendBezirksWideDroneNews,
  canSendNewsToDroneGroup,
  canSendNewsToFireDepartment,
} from '@/lib/auth/permissions';
import { newsSchema, parseNewsFormData } from '@/lib/validation/news.schema';
import { dispatchNewsPost } from '@/lib/news/dispatch-news';

export interface NewsFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

export async function createNewsPost(_prevState: NewsFormState, formData: FormData): Promise<NewsFormState> {
  const user = await requireUser();
  assertPermission(canSendAnyNews(user));

  const parsed = newsSchema.safeParse(parseNewsFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  if (data.audience === 'FIRE_DEPARTMENT') {
    if (!canSendNewsToFireDepartment(user, data.fireDepartmentId!)) {
      return { error: 'Kein Senderecht für diese Feuerwehr.' };
    }
  } else {
    const droneGroupId = data.droneGroupId || null;
    if (droneGroupId === null) {
      if (!canSendBezirksWideDroneNews(user)) {
        return { error: 'Kein Senderecht für eine bezirksweite Drohnengruppen-Nachricht.' };
      }
    } else {
      const droneGroup = await prisma.droneGroup.findUnique({ where: { id: droneGroupId }, select: { id: true, organizationId: true } });
      if (!droneGroup || !canSendNewsToDroneGroup(user, droneGroup)) {
        return { error: 'Kein Senderecht für diese Drohnengruppe.' };
      }
    }
  }

  const post = await prisma.newsPost.create({
    data: {
      title: data.title,
      body: data.body,
      audience: data.audience,
      fireDepartmentId: data.audience === 'FIRE_DEPARTMENT' ? data.fireDepartmentId || null : null,
      droneGroupId: data.audience === 'DRONE_GROUP' ? data.droneGroupId || null : null,
      eventId: data.eventId || null,
      scheduledAt: data.sendMode === 'SCHEDULED' && data.scheduledAt ? new Date(data.scheduledAt) : null,
      createdById: user.id,
    },
  });

  if (data.sendMode === 'NOW') {
    try {
      await dispatchNewsPost(post.id);
    } catch (error) {
      console.error('News-Versand fehlgeschlagen:', error);
      return { error: 'News wurde gespeichert, aber der Versand ist fehlgeschlagen. Bitte Push-Konfiguration prüfen.' };
    }
  }

  revalidatePath('/news');
  revalidatePath('/meine-feuerwehr');
  redirect('/news');
}
```

- [ ] **Step 3: Rewrite `src/app/(app)/news/neu/page.tsx`**

```tsx
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canSendAnyNews, canSendNewsToFireDepartment, canSendNewsToDroneGroup, canSendBezirksWideDroneNews } from '@/lib/auth/permissions';
import { NewsForm } from '@/components/news/news-form';
import { createNewsPost } from '../actions';

async function getFireDepartmentStats(organizationId: string) {
  const memberCount = await prisma.user.count({ where: { homeOrganizationId: organizationId, isActive: true } });
  const pushCount = await prisma.user.count({
    where: { homeOrganizationId: organizationId, isActive: true, pushSubscriptions: { some: {} } },
  });
  return { memberCount, pushCount };
}

async function getDroneGroupStats(droneGroupId: string | null) {
  const where = droneGroupId
    ? { isActive: true, droneMembership: { is: { droneGroupId } } }
    : { isActive: true, droneMembership: { is: {} } };
  const memberCount = await prisma.user.count({ where });
  const pushCount = await prisma.user.count({ where: { ...where, pushSubscriptions: { some: {} } } });
  return { memberCount, pushCount };
}

export default async function NeueNewsPage() {
  const user = await requireUser();
  if (!canSendAnyNews(user)) notFound();

  const [allFireDepartments, allDroneGroups] = await Promise.all([
    prisma.organization.findMany({ where: { isActive: true, type: 'FEUERWEHR' }, orderBy: { name: 'asc' } }),
    prisma.droneGroup.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
  ]);

  const allowedFireDepartments = allFireDepartments.filter((org) => canSendNewsToFireDepartment(user, org.id));
  const allowedDroneGroups = allDroneGroups.filter((group) => canSendNewsToDroneGroup(user, { id: group.id, organizationId: group.organizationId }));
  const canSendBezirksweit = canSendBezirksWideDroneNews(user);

  const fireDepartments = await Promise.all(
    allowedFireDepartments.map(async (org) => ({ id: org.id, name: org.name, ...(await getFireDepartmentStats(org.id)) })),
  );
  const droneGroups = await Promise.all(
    allowedDroneGroups.map(async (group) => ({ id: group.id, name: group.name, ...(await getDroneGroupStats(group.id)) })),
  );
  const bezirksweitStats = canSendBezirksweit ? await getDroneGroupStats(null) : null;

  const upcomingEvents = await prisma.event.findMany({
    where: { startsAt: { gte: new Date() } },
    orderBy: { startsAt: 'asc' },
    take: 50,
    select: { id: true, title: true, startsAt: true, organizationId: true, droneGroupId: true, category: true },
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-neutral-900">Neue News</h1>
      <NewsForm
        fireDepartments={fireDepartments}
        droneGroups={droneGroups}
        bezirksweitStats={bezirksweitStats}
        events={upcomingEvents.map((event) => ({
          id: event.id,
          label: `${event.title} · ${event.startsAt.toLocaleDateString('de-AT')}`,
          organizationId: event.organizationId,
          droneGroupId: event.droneGroupId,
          isDroneEvent: event.category === 'DROHNENGRUPPE',
        }))}
        action={createNewsPost}
      />
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `src/components/news/news-form.tsx`**

```tsx
'use client';

import { useMemo, useState, useTransition } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { newsSchema, type NewsInput } from '@/lib/validation/news.schema';
import { DateTime15MinInput } from '@/components/ui/datetime-15min-input';
import { truncateForPush } from '@/lib/news/dispatch-news';
import type { NewsFormState } from '@/app/(app)/news/actions';

interface RecipientStats {
  id: string;
  name: string;
  memberCount: number;
  pushCount: number;
}

interface EventOption {
  id: string;
  label: string;
  organizationId: string;
  droneGroupId: string | null;
  isDroneEvent: boolean;
}

/** Vorbelegung für den Bearbeiten-Fall (Task 7) - alle Felder optional, da die Erstellen-Seite (Task 6)
 * diesen Prop schlicht wegLässt statt einen leeren Platzhalter durchzureichen. */
interface ExistingNewsPost {
  title: string;
  body: string;
  audience: NewsInput['audience'];
  fireDepartmentId: string | null;
  droneGroupId: string | null;
  eventId: string | null;
  scheduledAt: Date | null;
}

interface NewsFormProps {
  fireDepartments: RecipientStats[];
  droneGroups: RecipientStats[];
  bezirksweitStats: { memberCount: number; pushCount: number } | null;
  events: EventOption[];
  existingPost?: ExistingNewsPost;
  action: (prevState: NewsFormState, formData: FormData) => Promise<NewsFormState>;
}

/** Formatiert ein Date als Wert für DateTime15MinInput (datetime-local-artig, lokale Zeit) - identisch
 * zu toDatetimeLocalValue in src/lib/format.ts, hier nicht importiert um diese reine UI-Komponente
 * nicht von einer weiteren Datei abhängig zu machen für eine einzige Zeile. */
function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function NewsForm({ fireDepartments, droneGroups, bezirksweitStats, events, existingPost, action }: NewsFormProps) {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | undefined>();
  const [confirmMode, setConfirmMode] = useState<'SCHEDULED' | 'NOW' | null>(null);

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<NewsInput>({
    resolver: zodResolver(newsSchema),
    defaultValues: {
      title: existingPost?.title ?? '',
      body: existingPost?.body ?? '',
      audience: existingPost?.audience ?? 'FIRE_DEPARTMENT',
      fireDepartmentId: existingPost?.fireDepartmentId ?? fireDepartments[0]?.id ?? '',
      droneGroupId: existingPost?.droneGroupId ?? '',
      eventId: existingPost?.eventId ?? '',
      // 'DRAFT' bleibt der Default auch beim Bearbeiten - ein Entwurf/terminierter Beitrag wird nach dem
      // Öffnen des Formulars nicht automatisch erneut "Jetzt gesendet", nur weil er bearbeitet wird; der
      // Nutzer wählt beim Speichern erneut explizit einen der drei Buttons.
      sendMode: 'DRAFT',
      scheduledAt: existingPost?.scheduledAt ? toLocalInputValue(existingPost.scheduledAt) : '',
    },
  });

  const audience = watch('audience');
  const fireDepartmentId = watch('fireDepartmentId');
  const droneGroupId = watch('droneGroupId');
  const title = watch('title');
  const body = watch('body');

  const selectedStats =
    audience === 'FIRE_DEPARTMENT'
      ? fireDepartments.find((org) => org.id === fireDepartmentId)
      : droneGroupId
        ? droneGroups.find((group) => group.id === droneGroupId)
        : bezirksweitStats;

  const relevantEvents = useMemo(
    () =>
      events.filter((event) =>
        audience === 'FIRE_DEPARTMENT' ? !event.isDroneEvent && event.organizationId === fireDepartmentId : event.isDroneEvent,
      ),
    [events, audience, fireDepartmentId],
  );

  const previewCut = truncateForPush(body || '');
  const previewVisibleLength = previewCut.endsWith('…') ? previewCut.length - 1 : previewCut.length;
  const previewHiddenPart = (body || '').slice(previewVisibleLength);

  function buildFormData(values: NewsInput): FormData {
    const formData = new FormData();
    formData.set('title', values.title);
    formData.set('body', values.body);
    formData.set('audience', values.audience);
    formData.set('fireDepartmentId', values.fireDepartmentId ?? '');
    formData.set('droneGroupId', values.droneGroupId ?? '');
    formData.set('eventId', values.eventId ?? '');
    formData.set('sendMode', values.sendMode);
    formData.set('scheduledAt', values.scheduledAt ?? '');
    return formData;
  }

  function submitWithMode(values: NewsInput, sendMode: NewsInput['sendMode']) {
    startTransition(async () => {
      const result = await action({}, buildFormData({ ...values, sendMode }));
      setServerError(result?.error);
    });
  }

  function onSubmitDraft(values: NewsInput) {
    submitWithMode(values, 'DRAFT');
  }

  function onRequestScheduled(values: NewsInput) {
    if (!values.scheduledAt) {
      setValue('sendMode', 'SCHEDULED', { shouldValidate: true });
      return;
    }
    setConfirmMode('SCHEDULED');
  }

  function onRequestNow() {
    setConfirmMode('NOW');
  }

  function confirmSend() {
    if (!confirmMode) return;
    const values = { ...watch(), sendMode: confirmMode };
    setConfirmMode(null);
    submitWithMode(values, confirmMode);
  }

  const recipientLabel = audience === 'FIRE_DEPARTMENT' ? selectedStats?.name : (selectedStats ? droneGroups.find((g) => g.id === droneGroupId)?.name ?? 'Alle Drohnengruppen' : 'Alle Drohnengruppen');

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <form onSubmit={handleSubmit(onSubmitDraft)} className="flex max-w-lg flex-1 flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-neutral-700">Empfänger</label>
          <div className="grid grid-cols-2 gap-2">
            {fireDepartments.map((org) => (
              <label
                key={org.id}
                className={`cursor-pointer rounded-lg border p-3 text-sm ${
                  audience === 'FIRE_DEPARTMENT' && fireDepartmentId === org.id ? 'border-brand bg-brand/5' : 'border-neutral-200'
                }`}
              >
                <input
                  type="radio"
                  className="sr-only"
                  checked={audience === 'FIRE_DEPARTMENT' && fireDepartmentId === org.id}
                  onChange={() => {
                    setValue('audience', 'FIRE_DEPARTMENT');
                    setValue('fireDepartmentId', org.id);
                  }}
                />
                <span className="block font-medium text-neutral-900">{org.name}</span>
                <span className="text-xs text-neutral-500">
                  {org.memberCount} Mitglieder · {org.pushCount} mit Push
                </span>
              </label>
            ))}
            {droneGroups.map((group) => (
              <label
                key={group.id}
                className={`cursor-pointer rounded-lg border p-3 text-sm ${
                  audience === 'DRONE_GROUP' && droneGroupId === group.id ? 'border-brand bg-brand/5' : 'border-neutral-200'
                }`}
              >
                <input
                  type="radio"
                  className="sr-only"
                  checked={audience === 'DRONE_GROUP' && droneGroupId === group.id}
                  onChange={() => {
                    setValue('audience', 'DRONE_GROUP');
                    setValue('droneGroupId', group.id);
                  }}
                />
                <span className="block font-medium text-neutral-900">{group.name}</span>
                <span className="text-xs text-neutral-500">
                  {group.memberCount} Mitglieder · {group.pushCount} mit Push
                </span>
              </label>
            ))}
            {bezirksweitStats && (
              <label
                className={`cursor-pointer rounded-lg border p-3 text-sm ${
                  audience === 'DRONE_GROUP' && !droneGroupId ? 'border-brand bg-brand/5' : 'border-neutral-200'
                }`}
              >
                <input
                  type="radio"
                  className="sr-only"
                  checked={audience === 'DRONE_GROUP' && !droneGroupId}
                  onChange={() => {
                    setValue('audience', 'DRONE_GROUP');
                    setValue('droneGroupId', '');
                  }}
                />
                <span className="block font-medium text-neutral-900">Alle Drohnengruppen</span>
                <span className="text-xs text-neutral-500">
                  {bezirksweitStats.memberCount} Mitglieder · {bezirksweitStats.pushCount} mit Push
                </span>
              </label>
            )}
          </div>
          {errors.fireDepartmentId && <p className="text-sm text-red-700">{errors.fireDepartmentId.message}</p>}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700">Titel</label>
          <input {...register('title')} className="rounded border border-neutral-300 px-3 py-2" />
          <p className="text-xs text-neutral-400">{title?.length ?? 0} / 65 — der Push-Kopf wird nie gekürzt.</p>
          {errors.title && <p className="text-sm text-red-700">{errors.title.message}</p>}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700">Nachricht</label>
          <textarea {...register('body')} rows={6} className="rounded border border-neutral-300 px-3 py-2" />
          <p className="text-xs text-neutral-400">
            {body?.length ?? 0} Zeichen · Länge unbegrenzt. Der volle Text steht in der App, unabhängig davon, was der Push zeigt.
          </p>
          {errors.body && <p className="text-sm text-red-700">{errors.body.message}</p>}
        </div>

        {relevantEvents.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-neutral-700">Termin verknüpfen (optional)</label>
            <select {...register('eventId')} className="rounded border border-neutral-300 px-3 py-2">
              <option value="">Kein Termin</option>
              {relevantEvents.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <Controller
          control={control}
          name="scheduledAt"
          render={({ field }) => (
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-neutral-700">Terminieren für (optional)</label>
              <DateTime15MinInput value={field.value ?? ''} onChange={field.onChange} onBlur={field.onBlur} />
              {errors.scheduledAt && <p className="text-sm text-red-700">{errors.scheduledAt.message}</p>}
            </div>
          )}
        />

        {selectedStats && (
          <p className="text-sm text-neutral-600">
            Wird an {selectedStats.pushCount} Geräte gesendet. {selectedStats.memberCount - selectedStats.pushCount} Mitglieder haben
            Push deaktiviert und sehen die Nachricht beim nächsten Öffnen von /news.
          </p>
        )}

        {serverError && <p className="text-sm text-red-700">{serverError}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending} className="rounded border border-neutral-300 px-4 py-2 font-medium text-neutral-700 disabled:opacity-60">
            Als Entwurf speichern
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={handleSubmit(onRequestScheduled)}
            className="rounded border border-brand px-4 py-2 font-medium text-brand disabled:opacity-60"
          >
            Terminieren
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={handleSubmit(onRequestNow)}
            className="rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
          >
            Jetzt senden
          </button>
          <Link href="/news" className="text-sm text-neutral-600 hover:underline">
            Abbrechen
          </Link>
        </div>
      </form>

      <div className="flex-1 rounded-lg bg-neutral-50 p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Push-Vorschau</p>
        <div className="rounded-xl bg-white p-3 shadow">
          <p className="text-xs font-medium text-neutral-500">AFKDO Purkersdorf</p>
          <p className="text-sm font-semibold text-neutral-900">{title || 'Titel'}</p>
          <p className="text-sm text-neutral-700">
            {previewCut.endsWith('…') ? previewCut.slice(0, -1) : previewCut}
            {previewHiddenPart && <span className="bg-red-100 text-red-700">{previewHiddenPart}</span>}
            {previewCut.endsWith('…') && '…'}
          </p>
        </div>
        <p className="mt-2 text-xs text-neutral-500">Im Push sichtbar: {previewVisibleLength} Zeichen</p>
        <p className="mt-2 rounded bg-green-50 p-2 text-xs text-green-800">
          Der Tap auf die Meldung öffnet die vollständige Nachricht.
        </p>
      </div>

      <AlertDialog open={confirmMode !== null} onOpenChange={(open) => !open && setConfirmMode(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmMode === 'NOW' ? 'Jetzt senden?' : 'Terminieren?'}</AlertDialogTitle>
            <AlertDialogDescription>
              Wird an {recipientLabel} gesendet{selectedStats ? ` (${selectedStats.pushCount} Geräte)` : ''}. Ein Push ist nicht
              zurückholbar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={confirmSend}>
              {confirmMode === 'NOW' ? 'Jetzt senden' : 'Terminieren'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

- [ ] **Step 5: Rename the `canManageNews` prop/usage to `canSendAnyNews`**

In `src/components/layout/profile-menu.tsx`: rename the `canManageNews: boolean;` prop to
`canSendAnyNews: boolean;` in the interface and the destructured parameters, and rename its one usage
(`{canManageNews && (...)}` around the mobile-only News link) to `{canSendAnyNews && (...)}`.

In `src/app/(app)/layout.tsx`: replace the import `canManageNews, isBezirksAdmin` with
`canSendAnyNews, isBezirksAdmin` (from `@/lib/auth/permissions`), and change the `<ProfileMenu>` prop
from `canManageNews={canManageNews(user)}` to `canSendAnyNews={canSendAnyNews(user)}`.

- [ ] **Step 6: Verify it compiles**

Run: `npx tsc --noEmit` and `npm run build`
Expected: **zero errors anywhere** — this is the task that clears every remaining reference to the old
`NewsMessage`/`canManageNews`/`NewsAudienceType` names.

- [ ] **Step 7: Live-verify**

Log in as a Feuerwehr-Admin (not a Bezirksadmin) and load `/news/neu`: confirm only their own Feuerwehr
appears as a recipient tile (not every Feuerwehr, not any Drohnengruppe unless they also administer
one). Fill in a title >65 characters and confirm the client-side counter/validation blocks submission;
fill in a body >170 characters and confirm the push preview shows the correct red-highlighted cut
portion matching `truncateForPush`'s actual output. Click "Als Entwurf speichern" — confirm no
`AlertDialog` appears and it redirects to `/news` with the draft visible only in "Entwürfe & Geplant".
Click "Jetzt senden" on a second draft — confirm the `AlertDialog` appears with the correct recipient/
device count, and confirm-clicking actually sends (post appears in `/news`'s main inbox afterward, with
`sentAt` set). Clean up all test data afterward.

- [ ] **Step 8: Commit**

```bash
git add src/lib/validation/news.schema.ts "src/app/(app)/news/actions.ts" "src/app/(app)/news/neu/page.tsx" src/components/news/news-form.tsx src/components/layout/profile-menu.tsx "src/app/(app)/layout.tsx"
git commit -m "feat: rework /news/neu compose page with recipient tiles and push preview (issue #17)"
```

---

### Task 7: Editing drafts/scheduled posts

**Files:**
- Create: `src/app/(app)/news/[newsPostId]/bearbeiten/page.tsx`
- Modify: `src/app/(app)/news/actions.ts`

**Interfaces:**
- Consumes: `canManageNewsPost` from Task 1, `NewsForm` from Task 6 (reused as-is for editing, given a
  new optional `existingPost` prop to prefill from).

- [ ] **Step 1: Add `updateNewsPost` and `deleteNewsPost` to `src/app/(app)/news/actions.ts`**

Add these two functions to the existing file (alongside `createNewsPost`, same imports already present):

```ts
export async function updateNewsPost(newsPostId: string, _prevState: NewsFormState, formData: FormData): Promise<NewsFormState> {
  const user = await requireUser();
  const existing = await prisma.newsPost.findUnique({
    where: { id: newsPostId },
    include: { droneGroup: { select: { id: true, organizationId: true } } },
  });
  if (!existing) return { error: 'Beitrag wurde nicht gefunden.' };
  if (existing.sentAt) return { error: 'Ein bereits gesendeter Beitrag kann nicht mehr bearbeitet werden.' };
  if (!canManageNewsPost(user, existing, existing.droneGroup)) return { error: 'Kein Zugriff.' };

  const parsed = newsSchema.safeParse(parseNewsFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  if (data.audience === 'FIRE_DEPARTMENT') {
    if (!canSendNewsToFireDepartment(user, data.fireDepartmentId!)) return { error: 'Kein Senderecht für diese Feuerwehr.' };
  } else {
    const droneGroupId = data.droneGroupId || null;
    if (droneGroupId === null) {
      if (!canSendBezirksWideDroneNews(user)) return { error: 'Kein Senderecht für eine bezirksweite Drohnengruppen-Nachricht.' };
    } else {
      const droneGroup = await prisma.droneGroup.findUnique({ where: { id: droneGroupId }, select: { id: true, organizationId: true } });
      if (!droneGroup || !canSendNewsToDroneGroup(user, droneGroup)) return { error: 'Kein Senderecht für diese Drohnengruppe.' };
    }
  }

  await prisma.newsPost.update({
    where: { id: newsPostId },
    data: {
      title: data.title,
      body: data.body,
      audience: data.audience,
      fireDepartmentId: data.audience === 'FIRE_DEPARTMENT' ? data.fireDepartmentId || null : null,
      droneGroupId: data.audience === 'DRONE_GROUP' ? data.droneGroupId || null : null,
      eventId: data.eventId || null,
      scheduledAt: data.sendMode === 'SCHEDULED' && data.scheduledAt ? new Date(data.scheduledAt) : null,
    },
  });

  if (data.sendMode === 'NOW') {
    try {
      await dispatchNewsPost(newsPostId);
    } catch (error) {
      console.error('News-Versand fehlgeschlagen:', error);
      return { error: 'News wurde gespeichert, aber der Versand ist fehlgeschlagen. Bitte Push-Konfiguration prüfen.' };
    }
  }

  revalidatePath('/news');
  revalidatePath('/meine-feuerwehr');
  redirect('/news');
}

export async function deleteNewsPost(newsPostId: string): Promise<void> {
  const user = await requireUser();
  const existing = await prisma.newsPost.findUnique({
    where: { id: newsPostId },
    include: { droneGroup: { select: { id: true, organizationId: true } } },
  });
  if (!existing) throw new Error('Beitrag wurde nicht gefunden.');
  if (existing.sentAt) throw new Error('Ein bereits gesendeter Beitrag kann nicht gelöscht werden.');
  if (!canManageNewsPost(user, existing, existing.droneGroup)) throw new Error('Kein Zugriff.');

  await prisma.newsPost.delete({ where: { id: newsPostId } });

  revalidatePath('/news');
  redirect('/news');
}
```

Add `canManageNewsPost` to this file's existing `import { ... } from '@/lib/auth/permissions'` line.

- [ ] **Step 2: Create `src/app/(app)/news/[newsPostId]/bearbeiten/page.tsx`**

```tsx
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManageNewsPost, canSendNewsToFireDepartment, canSendNewsToDroneGroup } from '@/lib/auth/permissions';
import { NewsForm } from '@/components/news/news-form';
import { updateNewsPost, deleteNewsPost } from '../../actions';

export default async function BearbeitenNewsPage({ params }: { params: Promise<{ newsPostId: string }> }) {
  const user = await requireUser();
  const { newsPostId } = await params;

  const post = await prisma.newsPost.findUnique({
    where: { id: newsPostId },
    include: { droneGroup: { select: { id: true, organizationId: true } } },
  });
  if (!post) notFound();
  if (post.sentAt) notFound();
  if (!canManageNewsPost(user, post, post.droneGroup)) notFound();

  const [allFireDepartments, allDroneGroups] = await Promise.all([
    prisma.organization.findMany({ where: { isActive: true, type: 'FEUERWEHR' }, orderBy: { name: 'asc' } }),
    prisma.droneGroup.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
  ]);
  const fireDepartments = allFireDepartments
    .filter((org) => canSendNewsToFireDepartment(user, org.id))
    .map((org) => ({ id: org.id, name: org.name, memberCount: 0, pushCount: 0 }));
  const droneGroups = allDroneGroups
    .filter((group) => canSendNewsToDroneGroup(user, { id: group.id, organizationId: group.organizationId }))
    .map((group) => ({ id: group.id, name: group.name, memberCount: 0, pushCount: 0 }));

  const boundUpdate = updateNewsPost.bind(null, post.id);
  const boundDelete = deleteNewsPost.bind(null, post.id);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900">News bearbeiten</h1>
        <form action={boundDelete}>
          <button type="submit" className="text-sm text-red-700 hover:underline">
            Löschen
          </button>
        </form>
      </div>
      <NewsForm
        fireDepartments={fireDepartments}
        droneGroups={droneGroups}
        bezirksweitStats={null}
        events={[]}
        existingPost={{
          title: post.title,
          body: post.body,
          audience: post.audience,
          fireDepartmentId: post.fireDepartmentId,
          droneGroupId: post.droneGroupId,
          eventId: post.eventId,
          scheduledAt: post.scheduledAt,
        }}
        action={boundUpdate}
      />
    </div>
  );
}
```

Note: member/push counts are shown as `0` on the edit form (unlike the create form) — computing them
here would duplicate Task 6's `getFireDepartmentStats`/`getDroneGroupStats` helpers for a cosmetic-only
number on a page whose actual purpose is editing existing text, not choosing a fresh audience. This is
an accepted, minor simplification; if a reviewer flags it as worth fixing, extracting those two helpers
into a shared file both pages import is the correct fix — not a blocking issue for this task.

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit` and `npm run build`
Expected: zero errors.

- [ ] **Step 4: Live-verify**

Create one draft via the real `/news/neu` UI, then navigate to `/news/<id>/bearbeiten`: confirm the
form is genuinely pre-filled — title, body, and the correct recipient tile selected (via the
`existingPost` prop wired in Step 2, using `NewsForm`'s `defaultValues`, which read `existingPost`
once at mount; since each navigation to `/bearbeiten/[id]` mounts a fresh page/component tree, this is
safe and does not hit the "same instance reused across different targets" staleness bug documented
elsewhere in this codebase for `UserFormSheet`, which was reused as a single always-mounted instance —
this page is not). Confirm: editing and saving as `DRAFT` again works;
editing and clicking "Jetzt senden" actually sends and the post disappears from "Entwürfe & Geplant"
and appears as sent in `/news`; a `SENT` post's `/bearbeiten` URL returns a real 404 (not an error);
"Löschen" removes a still-unsent draft and redirects to `/news`. Clean up any leftover test data.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/news/[newsPostId]/bearbeiten/page.tsx" "src/app/(app)/news/actions.ts"
git commit -m "feat: allow editing/deleting unsent News posts (issue #17)"
```

---

### Task 8: Cron script and docs

**Files:**
- Modify: `docker/README.md` (if it documents the News cron — check first)

**Interfaces:** None — this task only touches documentation/comments, no code interfaces change.

- [ ] **Step 1: Check whether `docker/README.md` documents the News module by its old names**

```bash
grep -n "NewsMessage\|send-scheduled-news\|Cron Job (News)" docker/README.md
```

If any match references `NewsMessage` specifically (as opposed to just the unchanged script/route
names `send-scheduled-news.sh`/`/api/cron/send-scheduled-news`, which are NOT renamed by this plan and
need no doc update), update that prose to say `NewsPost` instead. If no match mentions `NewsMessage`
by name, no doc change is needed for this step — say so in your report rather than editing something
that doesn't need it.

- [ ] **Step 2: Confirm `docker/send-scheduled-news.sh` needs no change**

This script was already fixed earlier (commit `ba21c29`, this same worktree's git history) to parse
`.env` safely instead of sourcing it as shell code — that fix is unrelated to the `NewsMessage`→
`NewsPost` rename and must not be reverted or touched. Run:

```bash
grep -n "while IFS=" docker/send-scheduled-news.sh
```

Expected: the safe parsing loop is still present. If it's somehow missing, stop and report BLOCKED —
do not "fix" this by reintroducing the old `. ./.env` sourcing pattern.

- [ ] **Step 3: Final whole-module sanity check**

```bash
grep -rn "NewsMessage\|NewsAudienceType\|canManageNews\b" src/ docker/ 2>/dev/null
```

Expected: **zero matches anywhere** — every reference to the old model/enum/permission name should
have been replaced by Tasks 1–7. If anything remains, fix it now (this is the final task, nothing else
will catch a straggler afterward).

- [ ] **Step 4: Final verification**

Run: `npx tsc --noEmit` and `npm run build`
Expected: zero errors, and the build's route list includes `/news`, `/news/[newsPostId]`,
`/news/[newsPostId]/bearbeiten`, `/news/neu`.

- [ ] **Step 5: Commit** (only if Step 1 found something to change; otherwise report that this task
      found nothing to commit and skip this step)

```bash
git add docker/README.md
git commit -m "docs: update News cron documentation for NewsPost rename"
```
