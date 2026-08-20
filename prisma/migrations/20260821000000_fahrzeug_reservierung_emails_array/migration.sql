-- AlterTable: fahrzeugReservierungEmail (single, nullable) -> fahrzeugReservierungEmails (array).
-- Add the new array column first, backfill from the old scalar column (single existing value becomes
-- a one-element array; NULL becomes an empty array), then drop the old column - the standard safe
-- sequence for a non-empty table so `prisma migrate deploy` can run this unattended in one shot.
ALTER TABLE "Organization" ADD COLUMN "fahrzeugReservierungEmails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "Organization"
SET "fahrzeugReservierungEmails" = ARRAY["fahrzeugReservierungEmail"]::TEXT[]
WHERE "fahrzeugReservierungEmail" IS NOT NULL;

ALTER TABLE "Organization" DROP COLUMN "fahrzeugReservierungEmail";
