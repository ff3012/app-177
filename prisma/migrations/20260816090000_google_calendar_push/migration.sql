-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "googleCalendarServiceAccountJson" TEXT,
ADD COLUMN     "googleCalendarId" TEXT,
ADD COLUMN     "googleCalendarLastSyncAt" TIMESTAMP(3),
ADD COLUMN     "googleCalendarLastSyncError" TEXT;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "googleEventId" TEXT;
