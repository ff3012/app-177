# CLAUDE.md — News module (Web Push)

This file loads automatically (in addition to the root CLAUDE.md) when Claude Code works with files under this directory. Moved out of the root CLAUDE.md by a /doctor pass (context-size cleanup) — content is unchanged verbatim.

### News module (Web Push)

`/news` (list + unread state), `/news/neu` (compose), `/news/[newsPostId]` (detail, the push
notification-click deep-link target) and `/news/[newsPostId]/bearbeiten` (edit, only while unsent) persist a
`NewsPost` and send push notifications to installed devices. This is Web Push (VAPID), not a native push
service (no APNs/FCM integration) — it rides entirely on the PWA infrastructure already in place.

**Reading is open to every member, on both mobile and desktop — this is not an admin-only module.**
Only composing/managing posts is gated by the three-tier permission model below. This tripped up two
real, live-reported bugs after the News rework shipped, both fixed and worth knowing about before
touching nav/permission code near this module again:
- `src/lib/nav-items.ts`'s `getNavItems()` used to gate the desktop `<Nav>`'s "News" entry on
  `canSendAnyNews`, a leftover from the pre-rework, Bezirksadmin-only module — a plain member had no
  way to find `/news` from the nav bar even though the page itself was already fully readable. The
  entry is now unconditional, the same as "Meine Feuerwehr". `MobileTabBar` never had a News tab in
  the first place (by design — News is deliberately not a 4th mobile tab; reachable there via the
  header bell and the `/meine-feuerwehr` home card instead).
- Don't reintroduce a `canSendAnyNews`/`canManageNewsPost`-style check anywhere on the *reading* path
  (`/news`, `/news/[newsPostId]`, `getVisibleNews`, `getUnreadNewsCount`) — visibility is governed
  solely by `buildVisibilityWhere` (below), which already correctly scopes by recipient circle.

**Three-tier send-permission model** (`src/lib/auth/permissions.ts`, no RBAC library — plain predicate
functions, same style as the rest of the app): a `NewsPost.audience` is either `FIRE_DEPARTMENT`
(`fireDepartmentId` set) or `DRONE_GROUP` (`droneGroupId` set, or `null` meaning "bezirksweit, all 4
groups" — the same null-sentinel pattern used elsewhere for Drohnengruppen data).
- `canSendNewsToFireDepartment(user, fireDepartmentId)` — delegates to `canManageHeimatfeuerwehrFor`
  (Admin of that Feuerwehr, which already includes Bezirksadmin).
- `canSendNewsToDroneGroup(user, droneGroup)` — delegates to `canManageDroneGroupFor` (Bezirksadmin,
  Bezirks-Drohnenadmin, Abschnittsadmin of the group's anchor Abschnitt, or Admin of that specific group).
- `canSendBezirksWideDroneNews(user)` — Bezirksadmin or Bezirks-Drohnenadmin only; deliberately narrower
  than `canSendNewsToDroneGroup` so a single group's Admin can't reach across group boundaries to send to
  all four.
- `canManageNewsPost(user, post, droneGroup)` — edit/delete rights on an *existing* post: the post's
  creator, or whichever of the three functions above applies to that post's audience.
- `canSendAnyNews(user)` — Bezirksadmin, Bezirks-Drohnenadmin, any `feuerwehrAdminOrgIds` entry, or a
  Drohnengruppen-Admin role; gates whether "Verfassen"/the drafts view is shown at all, not a specific
  send action.

- **iOS constraint, not a bug**: push only works on iOS 16.4+ *and* only after the user has added the app to
  their home screen via Safari's "Zum Home-Bildschirm" — a regular Safari tab cannot receive push at all on
  iOS. Android Chrome has no such restriction. `components/layout/push-notifications-toggle.tsx` detects iOS
  and shows an explanatory hint instead of a broken toggle when `Notification`/`PushManager` aren't available.
- **Opt-in is per-device, not per-user**: `PushSubscription` rows key off the browser's own `endpoint` (unique
  per installation), so the same person can have several active subscriptions (phone + laptop). The toggle in
  the profile menu subscribes/unsubscribes the *current* browser only.
- **Status is visible without opening the menu**: `components/layout/profile-menu.tsx` owns the
  `pushSupported`/`pushEnabled` state itself (not `push-notifications-toggle.tsx`) and renders a bell icon in
  the header — green when subscribed, red otherwise/unsupported — next to the profile name, both opening the
  same dropdown. The subscription check has to live in `ProfileMenu` because it's always mounted; the toggle
  component only mounts while the dropdown is open, so state living there couldn't color a bell that's
  visible before the dropdown is ever opened. `PushNotificationsToggle` is a controlled component
  (`enabled`/`onEnabledChange` props) for this reason — don't move its state back to being self-contained.
- **`src/lib/push/web-push-client.ts`** wraps the `web-push` package, configured from `VAPID_PUBLIC_KEY` /
  `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` (generate with `node -e "console.log(require('web-push').generateVAPIDKeys())"`
  inside the running container — see `docker/README.md`). Subscriptions that come back 404/410 (revoked/expired)
  are reported to the caller as `staleIds` and deleted, rather than being retried forever.
- **`src/lib/news/audience.ts`** is the single source of both News visibility and send-audience resolution:
  `buildVisibilityWhere(user)` (used by `getVisibleNews`/`getUnreadNewsCount`, shared by `/news`, the
  Startbildschirm card, and the bell-icon unread count — never a parallel query) and
  `resolveNewsAudienceUserIds(post)` (used only by dispatch, below — "who should be notified about THIS
  post", as opposed to "what can THIS user see"). Both apply the same `canViewDroneModule`-equivalent gate
  for `DRONE_GROUP` posts: a user with no drone membership and no Bezirks-Drohnenadmin right sees/receives
  neither a specific group's posts nor bezirksweit ones. This file is distinct from
  **`src/lib/push/audience.ts`**'s `resolveEventAudienceUserIds`, which resolves the unrelated Kalender
  "Push jetzt senden" one-off audience for an `Event`, not a `NewsPost`.
- **`src/lib/news/dispatch-news.ts`**'s `dispatchNewsPost(newsPostId)` turns `resolveNewsAudienceUserIds`'s
  result into subscriptions, sends via `sendPushToSubscriptions`, deletes stale (404/410) subscriptions, and
  marks `sentAt` — idempotent (an already-sent post is a no-op returning `{sent: 0, recipients: 0}`), so
  it's safe to call from both the "send now" path (`createNewsPost`/`updateNewsPost` in
  `src/app/(app)/news/actions.ts`) and the scheduled-dispatch cron without double-sending. The push payload
  carries `data: { url: '/news/${post.id}' }` so a notification click can deep-link straight to that post
  (see `public/sw.js` below) — this is what replaced the old, non-deep-linking flat push send.
- **Scheduling has no in-process worker**: `createNewsPost` either dispatches immediately or just stores
  `scheduledAt` with `sentAt: null`. Actually delivering scheduled news depends entirely on
  `docker/send-scheduled-news.sh` being in the host crontab (mirrors `docker/backup.sh`'s pattern) hitting
  `/api/cron/send-scheduled-news?secret=...` — a `CRON_SECRET`-gated route, public in `middleware.ts` for the
  same reason `/kalender/ics` and `/drohnen-schnell` are (no session available to a cron job; a capability
  secret substitutes for one). Without that cron entry, scheduled news silently never sends — there's no
  admin-visible warning for a missing cron job today.
- `public/sw.js` handles `push` (shows the notification, passing through `payload.data` so `.url` survives
  onto the notification object) and `notificationclick` (reads `event.notification.data?.url`, falling back
  to `/kalender` for the older, News-independent Kalender-Sofortversand which carries no `data.url`). For an
  already-open matching window: `existing.focus().then(() => existing.navigate(url)).catch(() =>
  self.clients.openWindow(url))` — `focus()` alone leaves the previously-open page unchanged, and
  `navigate()` can reject for a window not controlled by this service worker (e.g. a tab loaded before the
  SW took control), which without the `.catch()` fallback would silently strand the user on the stale page —
  exactly the original reported bug this whole feature exists to fix. `self.clients.openWindow(url)` is used
  directly when no matching window is open at all. The manifest/offline-cache parts of the service worker
  are unrelated and untouched by this.
- **"Alle gelesen"** (`markAllNewsRead()` in `src/app/(app)/news/actions.ts`, wired to a button next to the
  unread count on `/news`): marks every currently-visible unread post read in one `newsRead.createMany({
  skipDuplicates: true })` call, not a loop of per-post upserts.
- **Bell-badge staleness after opening a post, a real live-reported bug**: `/news/[newsPostId]/page.tsx`
  upserts the `NewsRead` row during the page's server render, not inside a Server Action or Route Handler —
  `revalidatePath()` is disallowed during render (same Next.js restriction documented on
  `vehicle-booking-decision.ts`'s identical pattern), so a normal `<Link>` visit from `/news` or the home
  card left the Next.js Router Cache serving the `(app)` layout's now-stale bell badge until some unrelated
  navigation happened to refresh it. Fixed with `src/components/news/refresh-after-mark-read.tsx`, a tiny
  client component rendered on the detail page that calls `router.refresh()` once on mount — don't remove it
  as "dead code" or replace the read-tracking with a client-triggered Server Action instead; the design spec
  deliberately requires the read to be recorded at render time, not on a client-side event.
- **`/news/neu`'s event picker is scoped to the sender's own allowed orgs/groups**, not every upcoming
  district-wide event — `neu/page.tsx` builds the `Event` query's `where` from `allowedFireDepartments`/
  `allowedDroneGroups`/`canSendBezirksweit` (computed first), and both `createNewsPost` and `updateNewsPost`
  re-validate a submitted `eventId` actually belongs to the post's own audience/org/group before accepting
  it. Without this, a Feuerwehr-Admin would receive other Abschnitte's event titles/dates in their own
  compose form (a `canViewEvent` would never grant them that in `/kalender`), and at full Bezirk scale the
  unfiltered `take: 50` upcoming-events query would frequently push a sender's own upcoming event past the
  cutoff entirely.

