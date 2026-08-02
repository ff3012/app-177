-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "vehicleBookingId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Event_vehicleBookingId_key" ON "Event"("vehicleBookingId");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_vehicleBookingId_fkey" FOREIGN KEY ("vehicleBookingId") REFERENCES "VehicleBooking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
