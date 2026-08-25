-- AlterTable
ALTER TABLE "User" ADD COLUMN     "secondaryOrganizationId" TEXT,
ADD COLUMN     "secondaryDienstgradId" TEXT;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_secondaryOrganizationId_fkey" FOREIGN KEY ("secondaryOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_secondaryDienstgradId_fkey" FOREIGN KEY ("secondaryDienstgradId") REFERENCES "Dienstgrad"("id") ON DELETE SET NULL ON UPDATE CASCADE;
