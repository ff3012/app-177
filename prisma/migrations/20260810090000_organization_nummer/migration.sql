-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "nummer" TEXT;

-- Backfill known Feuerwehrnummern (Niederösterreichische Landesfeuerwehr-Nummerierung) for the
-- Abschnitt's existing organizations, matched by their stable "name" column, before the column
-- below is tightened to NOT NULL + UNIQUE. Any organization created after this migration must
-- set "nummer" explicitly - the seed script and any future Verwaltung UI are the only places
-- new organizations get created.
UPDATE "Organization" SET "nummer" = '17700' WHERE "name" = 'Abschnittsfeuerwehrkommando Purkersdorf';
UPDATE "Organization" SET "nummer" = '17701' WHERE "name" = 'FF Gablitz';
UPDATE "Organization" SET "nummer" = '17702' WHERE "name" = 'FF Mauerbach';
UPDATE "Organization" SET "nummer" = '17703' WHERE "name" = 'FF Pressbaum';
UPDATE "Organization" SET "nummer" = '17704' WHERE "name" = 'FF Purkersdorf';
UPDATE "Organization" SET "nummer" = '17706' WHERE "name" = 'FF Rekawinkel';
UPDATE "Organization" SET "nummer" = '17707' WHERE "name" = 'FF Steinbach';
UPDATE "Organization" SET "nummer" = '17708' WHERE "name" = 'FF Tullnerbach';
UPDATE "Organization" SET "nummer" = '17709' WHERE "name" = 'FF Tullnerbach-Irenental';
UPDATE "Organization" SET "nummer" = '17711' WHERE "name" = 'FF Wolfsgraben';

-- AlterTable
ALTER TABLE "Organization" ALTER COLUMN "nummer" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Organization_nummer_key" ON "Organization"("nummer");
