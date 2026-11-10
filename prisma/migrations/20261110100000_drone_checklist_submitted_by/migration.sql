-- AlterTable
ALTER TABLE "DroneChecklist" ADD COLUMN     "submittedById" TEXT;

-- AddForeignKey
ALTER TABLE "DroneChecklist" ADD CONSTRAINT "DroneChecklist_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

