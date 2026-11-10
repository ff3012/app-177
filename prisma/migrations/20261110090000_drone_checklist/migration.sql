-- CreateEnum
CREATE TYPE "ChecklistStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'DISCARDED');

-- AlterTable
ALTER TABLE "DroneFlight" ADD COLUMN     "checklistId" TEXT;

-- AlterTable
ALTER TABLE "DroneGroup" ADD COLUMN     "featureChecklist" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "DroneChecklist" (
    "id" TEXT NOT NULL,
    "droneGroupId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "pilotId" TEXT,
    "status" "ChecklistStatus" NOT NULL DEFAULT 'DRAFT',
    "step" INTEGER NOT NULL DEFAULT 0,
    "flightAt" TIMESTAMP(3) NOT NULL,
    "purpose" TEXT,
    "area" TEXT,
    "data" JSONB NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "discardedAt" TIMESTAMP(3),
    "pdfKey" TEXT,
    "mailedTo" TEXT,
    "mailedAt" TIMESTAMP(3),
    "mailError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DroneChecklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DroneChecklistDrone" (
    "checklistId" TEXT NOT NULL,
    "droneId" TEXT NOT NULL,

    CONSTRAINT "DroneChecklistDrone_pkey" PRIMARY KEY ("checklistId","droneId")
);

-- CreateIndex
CREATE INDEX "DroneChecklist_droneGroupId_status_idx" ON "DroneChecklist"("droneGroupId", "status");

-- CreateIndex
CREATE INDEX "DroneChecklist_createdById_status_idx" ON "DroneChecklist"("createdById", "status");

-- CreateIndex
CREATE INDEX "DroneFlight_checklistId_idx" ON "DroneFlight"("checklistId");

-- AddForeignKey
ALTER TABLE "DroneFlight" ADD CONSTRAINT "DroneFlight_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "DroneChecklist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DroneChecklist" ADD CONSTRAINT "DroneChecklist_droneGroupId_fkey" FOREIGN KEY ("droneGroupId") REFERENCES "DroneGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DroneChecklist" ADD CONSTRAINT "DroneChecklist_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DroneChecklist" ADD CONSTRAINT "DroneChecklist_pilotId_fkey" FOREIGN KEY ("pilotId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DroneChecklistDrone" ADD CONSTRAINT "DroneChecklistDrone_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "DroneChecklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DroneChecklistDrone" ADD CONSTRAINT "DroneChecklistDrone_droneId_fkey" FOREIGN KEY ("droneId") REFERENCES "Drone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Funktionsschalter "Checkliste Drohnenflug" (Testversion): nur für die Gruppe AFKDO Purkersdorf einschalten.
-- Der Backfill liegt bewusst in der Migration, nicht im Seed: der Container führt beim Start nur
-- "prisma migrate deploy" aus und seedet nie.
UPDATE "DroneGroup" SET "featureChecklist" = true WHERE "name" = 'AFKDO Purkersdorf';
