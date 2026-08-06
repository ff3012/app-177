-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "facebookLastFetchAt" TIMESTAMP(3),
ADD COLUMN     "facebookLastFetchError" TEXT;
