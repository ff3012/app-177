-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "reportKioskDeviceName" TEXT;

-- CreateTable
CREATE TABLE "ReportTypeSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "ReportType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "recipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportTypeSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportTypeSetting_organizationId_type_key" ON "ReportTypeSetting"("organizationId", "type");

-- AddForeignKey
ALTER TABLE "ReportTypeSetting" ADD CONSTRAINT "ReportTypeSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: die bisherige Empfängerliste je Feuerwehr gilt für beide freigeschalteten Berichtsarten.
INSERT INTO "ReportTypeSetting" ("id", "organizationId", "type", "enabled", "recipients", "updatedAt")
SELECT 'rts_' || o."id" || '_' || t.type, o."id", t.type::"ReportType", true, o."reportRecipients", CURRENT_TIMESTAMP
FROM "Organization" o
CROSS JOIN (VALUES ('ACTIVITY'), ('EXERCISE')) AS t(type)
WHERE cardinality(o."reportRecipients") > 0
  AND NOT EXISTS (
    SELECT 1 FROM "ReportTypeSetting" s
    WHERE s."organizationId" = o."id" AND s."type" = t.type::"ReportType"
  );
