-- AlterTable
ALTER TABLE "NewsMessage" ADD COLUMN     "audienceDroneGroupId" TEXT;

-- AddForeignKey
ALTER TABLE "NewsMessage" ADD CONSTRAINT "NewsMessage_audienceDroneGroupId_fkey" FOREIGN KEY ("audienceDroneGroupId") REFERENCES "DroneGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
