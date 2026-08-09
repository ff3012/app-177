-- Bezirk 17 St. Pölten (bislang kein Bezirk modelliert - die App kannte nur einen Abschnitt).
INSERT INTO "District" (id, number, name)
VALUES ('district-17', '17', 'St. Pölten');

-- Der bestehende einzige Abschnitt (AFKDO Purkersdorf) gehört zu diesem Bezirk.
UPDATE "Organization"
SET "districtId" = 'district-17'
WHERE name = 'Abschnittsfeuerwehrkommando Purkersdorf';

-- Die bisherige einzige (flache) Drohnengruppe wird zur benannten Gruppe "AFKDO Purkersdorf",
-- verankert am bestehenden Abschnitt.
INSERT INTO "DroneGroup" (id, name, "organizationId")
SELECT 'dronegroup-afkdo-purkersdorf', 'AFKDO Purkersdorf', id
FROM "Organization"
WHERE name = 'Abschnittsfeuerwehrkommando Purkersdorf';

-- Jedes bestehende Drohnengruppen-Mitglied, jedes bestehende Unterlagen-PDF und jede bestehende
-- Drohne gehören ab jetzt zu dieser einen Gruppe.
UPDATE "DrohnengruppeMembership" SET "droneGroupId" = 'dronegroup-afkdo-purkersdorf' WHERE "droneGroupId" IS NULL;
UPDATE "DroneDocument" SET "droneGroupId" = 'dronegroup-afkdo-purkersdorf' WHERE "droneGroupId" IS NULL;
UPDATE "Drone" SET "droneGroupId" = 'dronegroup-afkdo-purkersdorf' WHERE "droneGroupId" IS NULL;

-- DropForeignKey
ALTER TABLE "DrohnengruppeMembership" DROP CONSTRAINT "DrohnengruppeMembership_droneGroupId_fkey";

-- DropForeignKey
ALTER TABLE "Drone" DROP CONSTRAINT "Drone_droneGroupId_fkey";

-- DropForeignKey
ALTER TABLE "DroneDocument" DROP CONSTRAINT "DroneDocument_droneGroupId_fkey";

-- AlterTable
ALTER TABLE "DrohnengruppeMembership" ALTER COLUMN "droneGroupId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Drone" ALTER COLUMN "droneGroupId" SET NOT NULL;

-- AlterTable
ALTER TABLE "DroneDocument" ALTER COLUMN "droneGroupId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "DrohnengruppeMembership" ADD CONSTRAINT "DrohnengruppeMembership_droneGroupId_fkey" FOREIGN KEY ("droneGroupId") REFERENCES "DroneGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Drone" ADD CONSTRAINT "Drone_droneGroupId_fkey" FOREIGN KEY ("droneGroupId") REFERENCES "DroneGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DroneDocument" ADD CONSTRAINT "DroneDocument_droneGroupId_fkey" FOREIGN KEY ("droneGroupId") REFERENCES "DroneGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

