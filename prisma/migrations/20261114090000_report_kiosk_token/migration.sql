-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "reportKioskToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Organization_reportKioskToken_key" ON "Organization"("reportKioskToken");
