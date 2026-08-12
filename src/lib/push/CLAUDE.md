# CLAUDE.md — News module (Web Push)

This file loads automatically (in addition to the root CLAUDE.md) when Claude Code works with files under this directory. Moved out of the root CLAUDE.md by a /doctor pass (context-size cleanup) — content is unchanged verbatim.

### News module (Web Push)

`/news` sends push notifications to installed devices — gated by `canManageNews` (Abschnittskommando-Admin
only for now; see the comment above that function for why it isn't opened up to `feuerwehrAdminOrgIds` yet).
This is Web Push (VAPID), not a native push service (no APNs/FCM integration) — it rides entirely on the PWA
infrastructure already in place:

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
- **`src/lib/push/audience.ts`** resolves a `NewsMessage`'s audience (one `Organization` = that org's
  `homeOrganizationId` members, or `DROHNENGRUPPE` = everyone with a `droneMembership`) to a user list;
  **`src/lib/news/send-news.ts`**'s `dispatchNewsMessage()` turns that into subscriptions, sends, and marks
  `sentAt` — idempotent (already-sent messages are a no-op), so it's safe to call from both the "send now"
  path and the scheduled-dispatch cron without double-sending.
- **Scheduling has no in-process worker**: `createNewsMessage` either dispatches immediately or just stores
  `scheduledAt` with `sentAt: null`. Actually delivering scheduled news depends entirely on
  `docker/send-scheduled-news.sh` being in the host crontab (mirrors `docker/backup.sh`'s pattern) hitting
  `/api/cron/send-scheduled-news?secret=...` — a `CRON_SECRET`-gated route, public in `middleware.ts` for the
  same reason `/kalender/ics` and `/drohnen-schnell` are (no session available to a cron job; a capability
  secret substitutes for one). Without that cron entry, scheduled news silently never sends — there's no
  admin-visible warning for a missing cron job today.
- `public/sw.js` handles `push` (shows the notification) and `notificationclick` (focuses an existing tab or
  opens `/kalender`) — both required for anything to actually appear on screen; the manifest/offline-cache
  parts of the service worker are unrelated and untouched by this.

