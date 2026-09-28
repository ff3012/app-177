-- DropForeignKey
ALTER TABLE "Report" DROP CONSTRAINT "Report_vehicleBookingId_fkey";

-- DropIndex
DROP INDEX "Report_fireDepartmentId_status_idx";

-- DropIndex
DROP INDEX "Report_vehicleBookingId_key";

-- Never-submitted draft reports have no meaning under the new no-draft design (a draft's
-- number/year/remark/submittedAt are still null by definition) - remove them before tightening
-- those columns to NOT NULL below. ReportMember/ReportQuantity cascade-delete with their Report.
DELETE FROM "Report" WHERE "status" = 'DRAFT';

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
