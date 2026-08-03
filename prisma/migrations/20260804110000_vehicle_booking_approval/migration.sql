-- CreateEnum
CREATE TYPE "VehicleBookingStatus" AS ENUM ('OFFEN', 'GENEHMIGT', 'ABGELEHNT');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "fahrzeugReservierungEmail" TEXT;

-- AlterTable
ALTER TABLE "VehicleBooking" ADD COLUMN     "approvalToken" TEXT,
ADD COLUMN     "status" "VehicleBookingStatus" NOT NULL DEFAULT 'GENEHMIGT';

-- CreateIndex
CREATE UNIQUE INDEX "VehicleBooking_approvalToken_key" ON "VehicleBooking"("approvalToken");
