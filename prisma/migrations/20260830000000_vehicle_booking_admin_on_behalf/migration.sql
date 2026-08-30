-- AddColumn
ALTER TABLE "VehicleBooking" ADD COLUMN "bookedByAdminId" TEXT;

-- AddForeignKey
ALTER TABLE "VehicleBooking" ADD CONSTRAINT "VehicleBooking_bookedByAdminId_fkey" FOREIGN KEY ("bookedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
