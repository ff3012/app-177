-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "photoUploadNotificationEmails" TEXT[] DEFAULT ARRAY[]::TEXT[];
