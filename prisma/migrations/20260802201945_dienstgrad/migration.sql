-- CreateEnum
CREATE TYPE "DienstgradKategorie" AS ENUM ('MANNSCHAFT', 'CHARGE', 'OFFIZIER', 'VERWALTUNG', 'SACHBEARBEITER', 'SONDERDIENSTGRAD', 'EHRENDIENSTGRAD');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "dienstgradId" TEXT;

-- CreateTable
CREATE TABLE "Dienstgrad" (
    "id" TEXT NOT NULL,
    "kurzform" TEXT NOT NULL,
    "bezeichnung" TEXT NOT NULL,
    "kategorie" "DienstgradKategorie" NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "Dienstgrad_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Dienstgrad_kurzform_key" ON "Dienstgrad"("kurzform");

-- CreateIndex
CREATE UNIQUE INDEX "Dienstgrad_sortOrder_key" ON "Dienstgrad"("sortOrder");

-- CreateIndex
CREATE INDEX "Dienstgrad_kategorie_idx" ON "Dienstgrad"("kategorie");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_dienstgradId_fkey" FOREIGN KEY ("dienstgradId") REFERENCES "Dienstgrad"("id") ON DELETE SET NULL ON UPDATE CASCADE;
