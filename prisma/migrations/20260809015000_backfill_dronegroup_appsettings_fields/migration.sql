-- Task 9 review fix (Critical): backfills the still-populated AppSettings singleton values into
-- DroneGroup BEFORE the columns get dropped in 20260819090000_remove_drone_appsettings_fields -
-- without this, a real production deploy would silently destroy the live QR-Schnellerfassung token
-- and the drone-flight-notification email address with no recovery path other than a pre-deploy
-- pg_dump. Runs chronologically right after Task 2's 20260809010000_hierarchie_backfill (which
-- created the DroneGroup row referenced below) and well before the drop migration removes the
-- source columns. No-op on any database where AppSettings.droneQuickRegisterToken/
-- droneFlightNotificationEmail are already NULL (a fresh DB where nothing was ever configured).
UPDATE "DroneGroup"
SET "qrToken" = (SELECT "droneQuickRegisterToken" FROM "AppSettings" WHERE id = 'singleton'),
    "flightNotificationEmail" = (SELECT "droneFlightNotificationEmail" FROM "AppSettings" WHERE id = 'singleton')
WHERE id = 'dronegroup-afkdo-purkersdorf';
