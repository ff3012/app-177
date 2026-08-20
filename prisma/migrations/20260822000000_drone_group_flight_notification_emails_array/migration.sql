-- AlterTable: DroneGroup.flightNotificationEmail (single, nullable) -> flightNotificationEmails
-- (array). Add the new array column first, backfill from the old scalar column (single existing
-- value becomes a one-element array; NULL becomes an empty array), then drop the old column - the
-- standard safe sequence for a non-empty table so `prisma migrate deploy` can run this unattended.
ALTER TABLE "DroneGroup" ADD COLUMN "flightNotificationEmails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "DroneGroup"
SET "flightNotificationEmails" = ARRAY["flightNotificationEmail"]::TEXT[]
WHERE "flightNotificationEmail" IS NOT NULL;

ALTER TABLE "DroneGroup" DROP COLUMN "flightNotificationEmail";
