-- DropForeignKey
ALTER TABLE "Report" DROP CONSTRAINT "Report_vehicleBookingId_fkey";

-- DropIndex
DROP INDEX "Report_fireDepartmentId_status_idx";

-- DropIndex
DROP INDEX "Report_vehicleBookingId_key";

-- AlterTable
ALTER TABLE "Report" DROP COLUMN "status",
DROP COLUMN "vehicleBookingId",
ALTER COLUMN "number" SET NOT NULL,
ALTER COLUMN "year" SET NOT NULL,
ALTER COLUMN "ownActivity" SET NOT NULL,
ALTER COLUMN "remark" SET NOT NULL,
ALTER COLUMN "submittedAt" SET NOT NULL;

-- DropEnum
DROP TYPE "ReportStatus";

