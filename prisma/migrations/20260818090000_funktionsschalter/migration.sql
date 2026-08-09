-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "featureAtemschutz" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "featureFacebook" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "featuresUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "featuresUpdatedByName" TEXT;

-- Backfill: Feuerwehren, die bereits ein vollständiges Facebook-Zugangstoken hinterlegt haben, starten
-- mit aktivierter Facebook-Integration statt dem Spalten-Default false - verhindert eine Unterbrechung
-- bereits laufender Integrationen (z. B. FF Wolfsgraben).
UPDATE "Organization"
SET "featureFacebook" = true
WHERE "facebookPageId" IS NOT NULL AND "facebookPageAccessToken" IS NOT NULL;
