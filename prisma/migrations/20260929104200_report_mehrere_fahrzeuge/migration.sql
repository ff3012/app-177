-- CreateTable
CREATE TABLE "ReportVehicle" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "km" INTEGER NOT NULL,

    CONSTRAINT "ReportVehicle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportVehicle_reportId_vehicleId_key" ON "ReportVehicle"("reportId", "vehicleId");

-- AddForeignKey
ALTER TABLE "ReportVehicle" ADD CONSTRAINT "ReportVehicle_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportVehicle" ADD CONSTRAINT "ReportVehicle_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "ReportMember" ADD COLUMN     "reportVehicleId" TEXT;

-- AddForeignKey
ALTER TABLE "ReportMember" ADD CONSTRAINT "ReportMember_reportVehicleId_fkey" FOREIGN KEY ("reportVehicleId") REFERENCES "ReportVehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: jeder bestehende Bericht mit genau einem Fahrzeug (das alte Report.vehicleId/vehicleKm
-- Skalarpaar) wird zu genau einer ReportVehicle-Zeile, und jedes bereits eingesetzte Mitglied dieses
-- Berichts wird dieser einen Zeile zugeordnet - vorher war implizit "der ganze Bericht verwendet
-- dieses eine Fahrzeug", jetzt wird das explizit als Zuordnung abgebildet. Deterministische ID
-- ('rv_' + Report-ID), da ein Bericht im alten Modell nie mehr als ein Fahrzeug hatte - keine
-- Zufalls-ID nötig, kein Konflikt mit dem @@unique([reportId, vehicleId]) oben möglich.
INSERT INTO "ReportVehicle" ("id", "reportId", "vehicleId", "km")
SELECT 'rv_' || "id", "id", "vehicleId", COALESCE("vehicleKm", 0)
FROM "Report"
WHERE "vehicleId" IS NOT NULL;

UPDATE "ReportMember" AS rm
SET "reportVehicleId" = 'rv_' || r."id"
FROM "Report" AS r
WHERE rm."reportId" = r."id" AND r."vehicleId" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "Report" DROP CONSTRAINT "Report_vehicleId_fkey";

-- AlterTable
ALTER TABLE "Report" DROP COLUMN "vehicleId",
DROP COLUMN "vehicleKm";
