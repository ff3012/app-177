-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "icsUid" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "icsImportLastSyncAt" TIMESTAMP(3),
ADD COLUMN     "icsImportLastSyncError" TEXT,
ADD COLUMN     "icsImportUrl" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Event_organizationId_icsUid_key" ON "Event"("organizationId", "icsUid");

