# Natives Android-Push über FCM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real push notifications to the native Android app (Play Store build) via Firebase Cloud Messaging (FCM), running alongside the existing Web Push (VAPID) system without replacing it.

**Architecture:** A new `FcmToken` table (separate from `PushSubscription`) stores one row per registered Android device. A new `firebase-admin`-based send function joins the two existing push call sites (News, Kalender event push) as a second, parallel delivery path. On the client, `@capacitor/push-notifications` handles permission/registration on Android; the existing profile-menu toggle and bell icon are extended to drive it, and a new native-only listener component handles foreground receipt and notification-tap navigation.

**Tech Stack:** `firebase-admin` (server-side FCM send), `@capacitor/push-notifications` (native client), Prisma/PostgreSQL, Next.js Server Actions.

## Global Constraints

- Android only — iOS stays on the existing "Push-Benachrichtigungen sind in dieser App-Version nicht verfügbar" message, no new code path for it.
- New `FcmToken` Prisma model, NOT an extension of `PushSubscription`: `id`, `userId`, `token` (`@unique`), `createdAt`, `userId` indexed, `onDelete: Cascade` from `User`.
- Server-side FCM sending uses the `firebase-admin` npm package — an explicit choice made in brainstorming, not the codebase's usual "thin SDK" default. Do not substitute a raw `google-auth-library`+fetch approach.
- Both existing push call sites (`src/lib/news/dispatch-news.ts`'s `dispatchNewsPost`, `src/lib/push/send-event-push.ts`'s `sendEventPushNow`) must call the new FCM send path IN ADDITION to the existing `sendPushToSubscriptions` call — never instead of it. Audience resolution (which `userId`s) is unchanged in both files; only the final "reach this user's devices" step gains a second, parallel path.
- New env var `FIREBASE_SERVICE_ACCOUNT_JSON` (the full service-account JSON as a single-line string) must be added to all four places: `.env.example`, `.env.staging.example`, and the `environment:` blocks of both `docker/docker-compose.yml` and `docker/docker-compose.staging.yml`. This repo has shipped a broken feature twice before by forgetting the docker-compose `environment:` block specifically (see root `CLAUDE.md`) — do not skip any of the four.
- `android/app/google-services.json` is a manual, non-code artifact the user places locally per the design spec's Firebase-Setup section — no task creates or assumes its presence beyond the pre-existing conditional Gradle plugin application already in `android/app/build.gradle:46-53`, which needs no change.
- This feature changes the native shell (new Capacitor plugin + the `google-services` Gradle plugin now actually activating) and therefore requires a new signed Android build before the next store upload — this is the user's own manual step (covered earlier in this project, not a task here).
- The existing push payload shape already includes `data.url` for News/Kalender push (read today by `public/sw.js`'s `notificationclick` handler). The new native Android tap-handler reads the same field — no server-side payload-building changes are needed anywhere.
- No automated test suite exists in this repo. Verification is `npx tsc --noEmit` + `npm run build` for every task, plus a throwaway DB script or live Browser-pane check where the task allows it. Device-level behavior (permission prompts, actual push delivery, notification tap) is inherently untestable in this environment — flag it as requiring a real-device manual pass, never fake it as verified.
- **Dependency on manual Firebase setup**: Tasks 1–3 (schema, server-side send capability, wiring into the two call sites) can be fully verified without any Firebase project existing yet (schema/`tsc`/`build`/unit-level DB checks). Task 4's real end-to-end device test (does a push notification actually arrive and does tapping it navigate correctly) **cannot happen until the user has completed the manual Firebase project setup** described in the design spec (`docs/superpowers/specs/2026-08-27-android-native-push-fcm-design.md`, "Firebase-Setup" section): creating the Firebase project, placing `android/app/google-services.json`, and generating the service-account JSON for `FIREBASE_SERVICE_ACCOUNT_JSON`. Do not assume this is already done — ask before attempting device verification in Task 4 if it's unclear.

---

### Task 1: `FcmToken` schema + migration

**Files:**
- Modify: `prisma/schema.prisma` (the `User` model, plus a new `FcmToken` model)
- Create: `prisma/migrations/20260827010000_fcm_tokens/migration.sql`

**Interfaces:**
- Produces: `User.fcmTokens: FcmToken[]`, `FcmToken { id, userId, token, createdAt }` — consumed by Task 2 (Server Actions) and Task 3 (the two send call sites).

- [ ] **Step 1: Add the `FcmToken` model and the `User.fcmTokens` relation to `prisma/schema.prisma`**

Find the `User` model's existing `pushSubscriptions` relation line:

```prisma
  pushSubscriptions      PushSubscription[]
```

Replace it with (adds the new relation directly below):

```prisma
  pushSubscriptions      PushSubscription[]
  fcmTokens              FcmToken[]
```

Find the `PushSubscription` model in the schema (it ends right before the `Dienstgrad`/next model). Add the new `FcmToken` model directly after it:

```prisma
// Ein registriertes Android-Gerät für natives Push über Firebase Cloud Messaging (FCM) - siehe
// docs/superpowers/specs/2026-08-27-android-native-push-fcm-design.md. Bewusst eine eigene Tabelle,
// keine Erweiterung von PushSubscription: ein FCM-Token ist ein einzelner String, keine
// endpoint/p256dh/auth-Kombination wie bei Web Push, und beide Mechanismen laufen dauerhaft parallel
// (ein User kann beides gleichzeitig haben - Browser-Session + Android-App).
model FcmToken {
  id        String   @id @default(cuid())
  userId    String
  token     String   @unique
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}
```

- [ ] **Step 2: Validate and generate the Prisma client**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

Run: `npx prisma generate`
Expected: exits 0. If it fails with a Windows file-lock (`EPERM`), stop any running dev server first and re-run.

- [ ] **Step 3: Write the migration SQL by hand**

Create `prisma/migrations/20260827010000_fcm_tokens/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "FcmToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FcmToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FcmToken_token_key" ON "FcmToken"("token");

-- CreateIndex
CREATE INDEX "FcmToken_userId_idx" ON "FcmToken"("userId");

-- AddForeignKey
ALTER TABLE "FcmToken" ADD CONSTRAINT "FcmToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

This mirrors the exact style of `prisma/migrations/20260827000000_zweite_heimatfeuerwehr/migration.sql` and the existing `PushSubscription` table's own migration (`onDelete: Cascade` → `ON DELETE CASCADE`).

- [ ] **Step 4: Apply the migration to the local dev database and mark it resolved**

This repo has a documented, deliberately-unfixed Prisma shadow-DB replay bug — never run `prisma migrate dev`/`prisma migrate deploy` locally.

```bash
npx prisma db execute --file prisma/migrations/20260827010000_fcm_tokens/migration.sql --schema prisma/schema.prisma
npx prisma migrate resolve --applied 20260827010000_fcm_tokens
```

Expected: both commands exit 0.

- [ ] **Step 5: Verify the table exists and is queryable**

Create a throwaway script (delete it after running — never commit it), e.g. `scratch-verify-fcm-token.ts` in the repo root:

```ts
import { prisma } from './src/lib/db/prisma';

async function main() {
  const user = await prisma.user.findFirst({ select: { id: true } });
  if (!user) {
    console.log('No user found - skipping write check.');
    return;
  }
  const token = await prisma.fcmToken.create({
    data: { userId: user.id, token: `test-token-${Date.now()}` },
  });
  console.log('Created:', token);
  const found = await prisma.user.findUnique({
    where: { id: user.id },
    select: { fcmTokens: { select: { id: true, token: true } } },
  });
  console.log('Via relation:', found?.fcmTokens);
  await prisma.fcmToken.delete({ where: { id: token.id } });
  console.log('Cleaned up.');
}

main().finally(() => prisma.$disconnect());
```

Run: `npx tsx scratch-verify-fcm-token.ts`
Expected: prints the created row, confirms it's reachable via `user.fcmTokens`, then confirms cleanup. Delete the script afterward.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260827010000_fcm_tokens/migration.sql
git commit -m "feat: add FcmToken model for native Android push"
```

---

### Task 2: Server-side FCM send capability + token Server Actions

**Files:**
- Create: `src/lib/push/fcm-client.ts`
- Modify: `src/app/(app)/profile/push-actions.ts`
- Modify: `.env.example`
- Modify: `.env.staging.example`
- Modify: `docker/docker-compose.yml`
- Modify: `docker/docker-compose.staging.yml`
- Modify: `package.json` (add `firebase-admin`)

**Interfaces:**
- Consumes: `FcmToken` model (Task 1).
- Produces: `sendPushToFcmTokens(tokens: FcmTokenRecord[], payload: PushPayload): Promise<{ sent: number; staleIds: string[] }>` (same shape as `sendPushToSubscriptions`, reusing its `PushPayload` type) — consumed by Task 3. `saveFcmToken(token: string): Promise<void>` / `deleteFcmToken(token: string): Promise<void>` — consumed by Task 4.

- [ ] **Step 1: Install `firebase-admin`**

Run: `npm install firebase-admin`
Expected: adds `firebase-admin` to `package.json`'s `dependencies`.

- [ ] **Step 2: Create `src/lib/push/fcm-client.ts`**

```ts
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import type { PushPayload } from './web-push-client';

let app: App | undefined;

/** Configured on first use, same as web-push-client.ts's ensureConfigured() (there for VAPID
 * details via webpush.setVapidDetails, here for the Firebase Admin app instance) - not at module
 * load, so a missing FIREBASE_SERVICE_ACCOUNT_JSON only breaks native push sends, never anything
 * that merely imports this file. */
function ensureConfigured(): App {
  if (app) return app;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('Push ist nicht konfiguriert (FIREBASE_SERVICE_ACCOUNT_JSON fehlt).');
  }

  const existing = getApps();
  if (existing.length > 0) {
    app = existing[0];
    return app;
  }

  const serviceAccount = JSON.parse(raw);
  app = initializeApp({ credential: cert(serviceAccount) });
  return app;
}

interface FcmTokenRecord {
  id: string;
  token: string;
}

/**
 * Sendet an alle übergebenen FCM-Tokens parallel - dieselbe Struktur wie
 * web-push-client.ts's sendPushToSubscriptions, damit beide Sendewege von den Aufrufern (News,
 * Kalender-Push) identisch behandelt werden können. Ungültige/nicht mehr registrierte Tokens
 * (FCM antwortet mit dem Fehlercode 'messaging/registration-token-not-registered') werden als
 * staleIds zurückgegeben, andere Fehler werden nur geloggt.
 */
export async function sendPushToFcmTokens(
  tokens: FcmTokenRecord[],
  payload: PushPayload,
): Promise<{ sent: number; staleIds: string[] }> {
  if (tokens.length === 0) {
    return { sent: 0, staleIds: [] };
  }

  const messaging = getMessaging(ensureConfigured());

  const results = await Promise.allSettled(
    tokens.map((t) =>
      messaging.send({
        token: t.token,
        notification: { title: payload.title, body: payload.body },
        data: payload.data ? { url: payload.data.url } : undefined,
      }),
    ),
  );

  let sent = 0;
  const staleIds: string[] = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      sent += 1;
      return;
    }
    const error = result.reason as { errorInfo?: { code?: string } };
    if (error?.errorInfo?.code === 'messaging/registration-token-not-registered') {
      staleIds.push(tokens[index].id);
    } else {
      console.error('FCM-Push-Versand an ein Token fehlgeschlagen:', error);
    }
  });

  return { sent, staleIds };
}
```

Note for the implementer: `firebase-admin`'s FCM `data` payload values must all be strings (already true here — `payload.data.url` is a string) — the Admin SDK throws at send time if a `data` value isn't a string, so don't widen this without checking that constraint.

- [ ] **Step 3: Add `saveFcmToken`/`deleteFcmToken` to `src/app/(app)/profile/push-actions.ts`**

Find the end of the existing file (after `deletePushSubscription`). Add:

```ts
export async function saveFcmToken(token: string): Promise<void> {
  const user = await requireUser();
  const existing = await prisma.fcmToken.findUnique({ where: { token } });
  if (existing && existing.userId !== user.id) {
    throw new Error('Dieses FCM-Token gehört bereits einem anderen Benutzer.');
  }
  await prisma.fcmToken.upsert({
    where: { token },
    create: { userId: user.id, token },
    update: {},
  });
}

export async function deleteFcmToken(token: string): Promise<void> {
  const user = await requireUser();
  await prisma.fcmToken.deleteMany({ where: { token, userId: user.id } });
}
```

This mirrors `savePushSubscription`/`deletePushSubscription` in the same file exactly (same ownership check, same upsert-on-save/deleteMany-on-remove shape).

- [ ] **Step 4: Add `FIREBASE_SERVICE_ACCOUNT_JSON` to all four env locations**

In `.env.example`, find:

```
# Geteiltes Secret für den Cronjob, der terminierte News versendet (docker/send-scheduled-news.sh).
# Generieren mit: openssl rand -hex 16
CRON_SECRET=change-me-to-a-random-string
```

Replace with (adds the new var above it):

```
# Firebase Cloud Messaging (natives Android-Push, docker/README.md/Design-Spec). Der volle
# Service-Account-JSON-Inhalt als einzeiliger String - erzeugen über die Firebase-Konsole
# (Projekteinstellungen -> Dienstkonten -> neuer privater Schlüssel).
FIREBASE_SERVICE_ACCOUNT_JSON=change-me

# Geteiltes Secret für den Cronjob, der terminierte News versendet (docker/send-scheduled-news.sh).
# Generieren mit: openssl rand -hex 16
CRON_SECRET=change-me-to-a-random-string
```

In `.env.staging.example`, find:

```
# Eigenes Secret für diesen Stack - nur relevant, falls du terminierte News/Cron-Features hier testest.
# Generieren mit: openssl rand -hex 16
CRON_SECRET=change-me-neu-generieren
```

Replace with:

```
# Firebase Cloud Messaging - eigener Service Account für diesen Stack ist NICHT zwingend nötig
# (FCM-Tokens sind ohnehin geräte-/installationsspezifisch, ähnlich wie bei Web-Push), aber falls du
# natives Android-Push hier separat testen willst, eigenes Firebase-Projekt/Service-Account verwenden.
FIREBASE_SERVICE_ACCOUNT_JSON=change-me

# Eigenes Secret für diesen Stack - nur relevant, falls du terminierte News/Cron-Features hier testest.
# Generieren mit: openssl rand -hex 16
CRON_SECRET=change-me-neu-generieren
```

In `docker/docker-compose.yml`, find:

```
      VAPID_PUBLIC_KEY: ${VAPID_PUBLIC_KEY}
      VAPID_PRIVATE_KEY: ${VAPID_PRIVATE_KEY}
      VAPID_SUBJECT: ${VAPID_SUBJECT}
      CRON_SECRET: ${CRON_SECRET}
```

Replace with:

```
      VAPID_PUBLIC_KEY: ${VAPID_PUBLIC_KEY}
      VAPID_PRIVATE_KEY: ${VAPID_PRIVATE_KEY}
      VAPID_SUBJECT: ${VAPID_SUBJECT}
      FIREBASE_SERVICE_ACCOUNT_JSON: ${FIREBASE_SERVICE_ACCOUNT_JSON}
      CRON_SECRET: ${CRON_SECRET}
```

In `docker/docker-compose.staging.yml`, find the identical block (same four lines, staging file) and apply the same insertion.

- [ ] **Step 5: Type-check and build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: succeeds. (This step does NOT require a real `FIREBASE_SERVICE_ACCOUNT_JSON` value — `ensureConfigured()` only throws at call time, not at module-load/build time.)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/push/fcm-client.ts "src/app/(app)/profile/push-actions.ts" .env.example .env.staging.example docker/docker-compose.yml docker/docker-compose.staging.yml
git commit -m "feat: add FCM send capability and token Server Actions"
```

---

### Task 3: Wire FCM sending into the two existing push call sites

**Files:**
- Modify: `src/lib/news/dispatch-news.ts`
- Modify: `src/lib/push/send-event-push.ts`

**Interfaces:**
- Consumes: `sendPushToFcmTokens` from `src/lib/push/fcm-client.ts` (Task 2), `prisma.fcmToken` (Task 1).

- [ ] **Step 1: Update `dispatch-news.ts`**

Find the import block:

```ts
import { prisma } from '@/lib/db/prisma';
import { resolveNewsAudienceUserIds } from '@/lib/news/audience';
import { sendPushToSubscriptions } from '@/lib/push/web-push-client';
import { truncateForPush } from '@/lib/news/truncate-for-push';
```

Replace with:

```ts
import { prisma } from '@/lib/db/prisma';
import { resolveNewsAudienceUserIds } from '@/lib/news/audience';
import { sendPushToSubscriptions } from '@/lib/push/web-push-client';
import { sendPushToFcmTokens } from '@/lib/push/fcm-client';
import { truncateForPush } from '@/lib/news/truncate-for-push';
```

Find the body of `dispatchNewsPost`:

```ts
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
```

Replace with:

```ts
  const userIds = await resolveNewsAudienceUserIds(post);
  const [subscriptions, fcmTokens] =
    userIds.length > 0
      ? await Promise.all([
          prisma.pushSubscription.findMany({ where: { userId: { in: userIds } } }),
          prisma.fcmToken.findMany({ where: { userId: { in: userIds } } }),
        ])
      : [[], []];

  const pushPayload = {
    title: post.title,
    body: truncateForPush(post.body),
    data: { url: `/news/${post.id}` },
  };

  const [webResult, fcmResult] = await Promise.all([
    sendPushToSubscriptions(subscriptions, pushPayload),
    sendPushToFcmTokens(fcmTokens, pushPayload),
  ]);

  if (webResult.staleIds.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: webResult.staleIds } } });
  }
  if (fcmResult.staleIds.length > 0) {
    await prisma.fcmToken.deleteMany({ where: { id: { in: fcmResult.staleIds } } });
  }

  await prisma.newsPost.update({ where: { id: post.id }, data: { sentAt: new Date() } });

  return { sent: webResult.sent + fcmResult.sent, recipients: subscriptions.length + fcmTokens.length };
```

- [ ] **Step 2: Update `send-event-push.ts`**

Find the import block:

```ts
import { prisma } from '@/lib/db/prisma';
import { resolveEventAudienceUserIds } from '@/lib/push/audience';
import { sendPushToSubscriptions } from '@/lib/push/web-push-client';
```

Replace with:

```ts
import { prisma } from '@/lib/db/prisma';
import { resolveEventAudienceUserIds } from '@/lib/push/audience';
import { sendPushToSubscriptions } from '@/lib/push/web-push-client';
import { sendPushToFcmTokens } from '@/lib/push/fcm-client';
```

Find the body of `sendEventPushNow`:

```ts
  const userIds = await resolveEventAudienceUserIds(event);
  const subscriptions =
    userIds.length > 0 ? await prisma.pushSubscription.findMany({ where: { userId: { in: userIds } } }) : [];

  const dateLabel = event.startsAt.toLocaleString('de-AT', { dateStyle: 'medium', timeStyle: 'short' });
  const body = event.location ? `${dateLabel} · ${event.location}` : dateLabel;

  const { sent, staleIds } = await sendPushToSubscriptions(subscriptions, {
    title: event.title,
    body,
    data: { url: `/kalender/${event.id}` },
  });

  if (staleIds.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: staleIds } } });
  }

  return { sent, recipients: subscriptions.length };
```

Replace with:

```ts
  const userIds = await resolveEventAudienceUserIds(event);
  const [subscriptions, fcmTokens] =
    userIds.length > 0
      ? await Promise.all([
          prisma.pushSubscription.findMany({ where: { userId: { in: userIds } } }),
          prisma.fcmToken.findMany({ where: { userId: { in: userIds } } }),
        ])
      : [[], []];

  const dateLabel = event.startsAt.toLocaleString('de-AT', { dateStyle: 'medium', timeStyle: 'short' });
  const body = event.location ? `${dateLabel} · ${event.location}` : dateLabel;
  const pushPayload = { title: event.title, body, data: { url: `/kalender/${event.id}` } };

  const [webResult, fcmResult] = await Promise.all([
    sendPushToSubscriptions(subscriptions, pushPayload),
    sendPushToFcmTokens(fcmTokens, pushPayload),
  ]);

  if (webResult.staleIds.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: webResult.staleIds } } });
  }
  if (fcmResult.staleIds.length > 0) {
    await prisma.fcmToken.deleteMany({ where: { id: { in: fcmResult.staleIds } } });
  }

  return { sent: webResult.sent + fcmResult.sent, recipients: subscriptions.length + fcmTokens.length };
```

- [ ] **Step 3: Type-check and build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Verify via a throwaway script against the local dev DB**

Since there's no real Firebase project yet, this step verifies the *wiring* (both tables are queried, both send functions are called, stale-cleanup logic runs for both) without a real FCM send succeeding — `sendPushToFcmTokens` will throw inside `ensureConfigured()` if `FIREBASE_SERVICE_ACCOUNT_JSON` isn't set locally, which is fine and expected; catch it to confirm it's reached, don't treat the throw itself as a failure of this step.

Create a throwaway script (delete after running):

```ts
import { sendPushToFcmTokens } from './src/lib/push/fcm-client';

async function main() {
  try {
    await sendPushToFcmTokens([{ id: 'x', token: 'fake-token' }], { title: 'Test', body: 'Test' });
    console.log('Unexpected: send succeeded without FIREBASE_SERVICE_ACCOUNT_JSON configured.');
  } catch (err) {
    console.log('Expected throw (not configured locally):', (err as Error).message);
  }
}

main();
```

Run: `npx tsx scratch-verify-fcm-wiring.ts`
Expected: prints the expected "not configured" error message, confirming the function is reachable and its guard clause fires correctly. Delete the script afterward.

- [ ] **Step 5: Commit**

```bash
git add src/lib/news/dispatch-news.ts src/lib/push/send-event-push.ts
git commit -m "feat: send native Android push alongside existing Web Push"
```

---

### Task 4: Android native client — registration, foreground receipt, tap navigation

**Files:**
- Modify: `package.json` (add `@capacitor/push-notifications`)
- Modify: `src/components/layout/push-notifications-toggle.tsx`
- Modify: `src/components/layout/profile-menu.tsx`
- Create: `src/components/capacitor/native-push-listener.tsx`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: `saveFcmToken`/`deleteFcmToken` from `src/app/(app)/profile/push-actions.ts` (Task 2).

- [ ] **Step 1: Install the plugin and sync**

Run: `npm install @capacitor/push-notifications`
Run: `npx cap sync android`
Expected: both exit 0. `npx cap sync android` updates `android/capacitor.settings.gradle`/`android/app/capacitor.build.gradle` to register the new plugin — these files are already tracked in git (confirmed earlier in this project), so this is an expected, real diff to commit, not IDE noise.

- [ ] **Step 2: Update `ProfileMenu`'s support/enabled detection for native Android**

Read the current file first — `src/components/layout/profile-menu.tsx` — to confirm the exact current `useEffect` body before editing (it was last touched in this project's Task 4 of the Capacitor rollout; confirm line numbers haven't drifted).

Find:

```ts
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      return;
    }
    if (Capacitor.isNativePlatform()) {
      return;
    }
    setPushSupported(true);
    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setPushEnabled(Boolean(subscription)))
      .catch(() => {});
  }, []);
```

Replace with:

```ts
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      // iOS native push is explicitly out of scope (see the design spec) - only Android gets the
      // real FCM flow, iOS keeps showing PushNotificationsToggle's existing "nicht verfügbar" text.
      if (Capacitor.getPlatform() !== 'android') return;
      setPushSupported(true);
      import('@capacitor/push-notifications').then(({ PushNotifications }) => {
        PushNotifications.checkPermissions()
          .then((status) => setPushEnabled(status.receive === 'granted'))
          .catch(() => {});
      });
      return;
    }

    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      return;
    }
    setPushSupported(true);
    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setPushEnabled(Boolean(subscription)))
      .catch(() => {});
  }, []);
```

- [ ] **Step 3: Update `PushNotificationsToggle`'s `handleToggle` for native Android**

Read `src/components/layout/push-notifications-toggle.tsx` first to confirm the current exact body (imports, `handleToggle`, the `!supported` early-return block) before editing.

Find the existing import from the same module:

```ts
import { savePushSubscription, deletePushSubscription } from '@/app/(app)/profile/push-actions';
```

Replace with (adds the two new actions to the same import statement rather than a second, separate one from the same path):

```ts
import { savePushSubscription, deletePushSubscription, saveFcmToken, deleteFcmToken } from '@/app/(app)/profile/push-actions';
```

Find the start of `handleToggle`:

```ts
  async function handleToggle(next: boolean) {
    setError(undefined);
    if (!vapidPublicKey) {
      setError('Push-Benachrichtigungen sind serverseitig noch nicht konfiguriert.');
      return;
    }

    setPending(true);
    try {
      const registration = await navigator.serviceWorker.ready;
```

Replace with (adds a native branch before the existing web-push `vapidPublicKey` guard, since that guard is web-push-specific and must not block the native path):

```ts
  async function handleToggle(next: boolean) {
    setError(undefined);
    setPending(true);

    if (Capacitor.isNativePlatform()) {
      try {
        const { PushNotifications } = await import('@capacitor/push-notifications');
        if (next) {
          const permission = await PushNotifications.requestPermissions();
          if (permission.receive !== 'granted') {
            setError('Berechtigung für Benachrichtigungen wurde nicht erteilt.');
            return;
          }
        }
        const token = await new Promise<string>((resolve, reject) => {
          PushNotifications.addListener('registration', (t) => resolve(t.value));
          PushNotifications.addListener('registrationError', (err) => reject(err));
          PushNotifications.register();
        });
        if (next) {
          await saveFcmToken(token);
        } else {
          await deleteFcmToken(token);
        }
        onEnabledChange(next);
      } catch (err) {
        console.error('Native Push-Registrierung fehlgeschlagen:', err);
        setError('Push-Benachrichtigungen konnten nicht geändert werden.');
      } finally {
        setPending(false);
      }
      return;
    }

    if (!vapidPublicKey) {
      setError('Push-Benachrichtigungen sind serverseitig noch nicht konfiguriert.');
      setPending(false);
      return;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
```

The rest of the function (the existing web-push `if (next) { ... } else { ... }` body and its `catch`/`finally`) stays exactly as-is below this point — only the function's opening lines change, and the existing `finally { setPending(false); }` at the end of the original try block still correctly covers the (now-unchanged) web-push path.

Note for the implementer: there is no `PushNotifications.unregister()` method in this plugin's public API (confirmed against its documented surface) — "disabling" native push only ever removes the server-side `FcmToken` row via `deleteFcmToken`; it does not and cannot revoke the OS-level notification permission from inside the app. Do not add a call to a nonexistent `unregister()` method.

- [ ] **Step 4: Create `src/components/capacitor/native-push-listener.tsx`**

```tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Capacitor } from '@capacitor/core';
import { toast } from 'sonner';

/**
 * Empfängt native Android-Push-Benachrichtigungen: im Vordergrund als Toast (die App zeigt sonst
 * keine System-Benachrichtigung, während sie bereits offen ist), und navigiert bei einem Tap auf
 * eine (aus dem Hintergrund/geschlossen empfangene) Benachrichtigung per Next-Router zu data.url -
 * dieselbe data.url, die News/Kalender-Push serverseitig schon für den Web-Push-Fall setzen (siehe
 * public/sw.js's notificationclick). No-op auf iOS/Web.
 */
export function NativePushListener() {
  const router = useRouter();

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;

    let cancelled = false;
    let receivedHandle: { remove: () => void } | undefined;
    let actionHandle: { remove: () => void } | undefined;

    import('@capacitor/push-notifications').then(({ PushNotifications }) => {
      PushNotifications.addListener('pushNotificationReceived', (notification) => {
        toast(notification.title ?? 'Neue Benachrichtigung', {
          description: notification.body,
        });
      }).then((handle) => {
        if (cancelled) {
          handle.remove();
          return;
        }
        receivedHandle = handle;
      });

      PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const url = action.notification.data?.url;
        if (typeof url === 'string' && url.length > 0) {
          router.push(url);
        }
      }).then((handle) => {
        if (cancelled) {
          handle.remove();
          return;
        }
        actionHandle = handle;
      });
    });

    return () => {
      cancelled = true;
      receivedHandle?.remove();
      actionHandle?.remove();
    };
  }, [router]);

  return null;
}
```

- [ ] **Step 5: Mount `NativePushListener` in `src/app/layout.tsx`**

Find:

```tsx
import { PwaRegister } from '@/components/pwa-register';
import { NativeShellInit } from '@/components/capacitor/native-shell-init';
import { AndroidBackButton } from '@/components/capacitor/android-back-button';
```

Replace with:

```tsx
import { PwaRegister } from '@/components/pwa-register';
import { NativeShellInit } from '@/components/capacitor/native-shell-init';
import { AndroidBackButton } from '@/components/capacitor/android-back-button';
import { NativePushListener } from '@/components/capacitor/native-push-listener';
```

Find:

```tsx
        <PwaRegister />
        <NativeShellInit />
        <AndroidBackButton />
        {children}
```

Replace with:

```tsx
        <PwaRegister />
        <NativeShellInit />
        <AndroidBackButton />
        <NativePushListener />
        {children}
```

- [ ] **Step 6: Type-check and build**

Run: `npx tsc --noEmit`
Expected: no errors. If the `@capacitor/push-notifications` package's actual shipped types differ from what's used above (e.g. the exact listener event payload field names), fix the usage to match the installed version's types rather than casting/suppressing — these are well-established, stable Capacitor plugin APIs, so a mismatch most likely means a naming detail to correct, not a deeper design problem.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 7: Non-interactive verification (web/browser side only)**

This browser-automation environment cannot exercise `Capacitor.isNativePlatform()`-gated code paths (they no-op entirely outside a native shell) or native permission prompts. Confirm instead, in the Browser pane against a normal (non-native) session:
1. The web push toggle in the profile dropdown still works exactly as before (existing behavior unchanged) — this confirms the new native branch's early-return didn't regress the pre-existing web path.
2. `npx tsc --noEmit` and `npm run build` (already run in Step 6) are the only checks available for the native branches themselves at this layer.

- [ ] **Step 8: Real-device verification (requires completed Firebase setup — see Global Constraints)**

Do **not** attempt this step until the user confirms the manual Firebase project setup (creating the project, placing `android/app/google-services.json`, generating and setting `FIREBASE_SERVICE_ACCOUNT_JSON`) is complete, and a new signed Android build (see the Global Constraints note on why one is needed) has been installed on a real test device. Once both are true:
1. Open the profile dropdown on the Android app, enable the Push-Benachrichtigungen toggle, grant the permission prompt.
2. Confirm (via a throwaway script reading `prisma.fcmToken.findMany()`) that a real `FcmToken` row was created for the test user.
3. Trigger a real push (e.g. via the Kalender event detail page's "Push-Benachrichtigung jetzt senden" button, or by sending a News post to that user's audience).
4. Confirm the notification arrives with the app backgrounded/closed, and tapping it opens the app and navigates to the correct `data.url` target.
5. Confirm a toast appears (not a system notification) when a push arrives while the app is in the foreground.
6. Disable the toggle, confirm the `FcmToken` row is deleted, and confirm no further pushes arrive for that device.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json android/capacitor.settings.gradle android/app/capacitor.build.gradle src/components/layout/push-notifications-toggle.tsx src/components/layout/profile-menu.tsx src/components/capacitor/native-push-listener.tsx src/app/layout.tsx
git commit -m "feat: native Android push registration, receipt, and tap navigation"
```

**Reminder (not a task step — the user's own manual action):** this feature changes the native shell. Before the next Play Store upload, a new signed Android build is required (`Build → Generate Signed Bundle / APK…` in Android Studio, using the existing keystore) — the same process already used for this project's first internal test build, just with "Choose existing…" instead of "Create new" for the keystore.
