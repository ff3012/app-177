-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "isDistrictWide" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sondergruppeId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "ausgeblendeteSondergruppenIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "Sondergruppe" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Sondergruppe_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Sondergruppe_name_key" ON "Sondergruppe"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Sondergruppe_sortOrder_key" ON "Sondergruppe"("sortOrder");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_sondergruppeId_fkey" FOREIGN KEY ("sondergruppeId") REFERENCES "Sondergruppe"("id") ON DELETE SET NULL ON UPDATE CASCADE;
