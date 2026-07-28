-- CreateEnum
CREATE TYPE "EventCategory" AS ENUM ('ALLGEMEIN', 'DROHNENGRUPPE');

-- AlterTable: Event category
ALTER TABLE "Event" ADD COLUMN "category" "EventCategory" NOT NULL DEFAULT 'ALLGEMEIN';

-- AlterTable: DroneFlight.pilotName (free text) -> DroneFlight.pilotUserId (FK to User)
ALTER TABLE "DroneFlight" ADD COLUMN "pilotUserId" TEXT;

-- Backfill: best-effort assume the person who registered an existing flight was also the pilot
UPDATE "DroneFlight" SET "pilotUserId" = "registeredById" WHERE "pilotUserId" IS NULL;

ALTER TABLE "DroneFlight" ALTER COLUMN "pilotUserId" SET NOT NULL;

ALTER TABLE "DroneFlight" DROP COLUMN "pilotName";

-- CreateIndex
CREATE INDEX "DroneFlight_pilotUserId_idx" ON "DroneFlight"("pilotUserId");

-- AddForeignKey
ALTER TABLE "DroneFlight" ADD CONSTRAINT "DroneFlight_pilotUserId_fkey" FOREIGN KEY ("pilotUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
