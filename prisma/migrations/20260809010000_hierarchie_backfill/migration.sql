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

-- Dasselbe für bestehende Drohnengruppen-TERMINE. Event.droneGroupId bleibt zwar nullable (anders als
-- die drei Spalten oben), muss aber trotzdem gesetzt werden: jede Sichtbarkeits-/Push-Prüfung vergleicht
-- exakt (event.droneGroupId === user.droneGroupId), und NULL === '<gruppe>' ist für JEDEN Nutzer false -
-- ohne dieses Backfill würden alle bereits bestehenden Drohnengruppen-Termine nach dem Deploy still
-- für alle unsichtbar.
UPDATE "Event" SET "droneGroupId" = 'dronegroup-afkdo-purkersdorf'
WHERE category = 'DROHNENGRUPPE' AND "droneGroupId" IS NULL;

-- Die 9 bestehenden Purkersdorf-Feuerwehren gehören zum bestehenden Abschnitt. Muss per Migration
-- passieren, nicht nur im Seed-Skript (prisma/seed.ts, seedAbschnitteUndFeuerwehren): docker/entrypoint.sh
-- führt beim Containerstart automatisch nur `prisma migrate deploy` aus, der Seed ist ein separater,
-- manueller Einmal-Befehl. Ohne dieses UPDATE bliebe parentId zwischen Deploy und manuellem Seed NULL,
-- und getAbschnittOrganizationId() könnte den Abschnitt einer Feuerwehr nicht auflösen - /kalender und
-- /meine-feuerwehr (die Startseite nach dem Login) würden für praktisch jeden Nutzer fehlschlagen.
-- Per name statt nummer gematcht: die Spalte Organization.nummer wird erst von der später
-- sortierenden Migration 20260810090000_organization_nummer angelegt - ein Match auf nummer würde
-- einen From-Scratch-Replay dieser Migration hier mit "column nummer does not exist" abbrechen.
-- name ist seit init @unique vorhanden und identisch zu FEUERWEHR_NAMEN in prisma/seed.ts.
UPDATE "Organization" SET "parentId" = (
  SELECT id FROM "Organization" WHERE name = 'Abschnittsfeuerwehrkommando Purkersdorf'
)
WHERE name IN ('FF Wolfsgraben','FF Pressbaum','FF Purkersdorf','FF Gablitz','FF Tullnerbach','FF Tullnerbach-Irenental','FF Steinbach','FF Mauerbach','FF Rekawinkel')
  AND "parentId" IS NULL;

-- Bootstrap-Admin wird Bezirksadmin - ebenfalls per Migration statt nur im Seed, damit die App sofort
-- nach dem Deploy einen erreichbaren Bezirksadmin hat (sonst wären /admin/email, /admin/status, /news
-- und die Benutzer-Excel-Routen bis zum manuellen Seed-Lauf für niemanden erreichbar).
UPDATE "User" SET "isBezirksAdmin" = true
WHERE email = 'admin@abschnitt-purkersdorf.at';

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

