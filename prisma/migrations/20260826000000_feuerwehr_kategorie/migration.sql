-- CreateEnum
CREATE TYPE "FeuerwehrKategorie" AS ENUM ('FREIWILLIGE_FEUERWEHR', 'BETRIEBSFEUERWEHR');

-- AlterTable
-- NOT NULL with a DEFAULT in the same statement backfills every existing row (Feuerwehr and
-- Abschnittskommando alike) to FREIWILLIGE_FEUERWEHR in one step - no separate UPDATE needed.
ALTER TABLE "Organization" ADD COLUMN "feuerwehrKategorie" "FeuerwehrKategorie" NOT NULL DEFAULT 'FREIWILLIGE_FEUERWEHR';
