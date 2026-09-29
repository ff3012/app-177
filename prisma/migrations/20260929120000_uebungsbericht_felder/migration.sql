-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "fuerUebungVerstaendigen" TEXT,
ADD COLUMN     "uebungsbeobachterId" TEXT,
ADD COLUMN     "uebungsdarstellung" TEXT,
ADD COLUMN     "uebungserkenntnis" TEXT,
ADD COLUMN     "uebungslage" TEXT,
ADD COLUMN     "uebungsleiterId" TEXT,
ADD COLUMN     "uebungsortNr" TEXT,
ADD COLUMN     "uebungsortOrt" TEXT,
ADD COLUMN     "uebungsortPlz" TEXT,
ADD COLUMN     "uebungsortStrasse" TEXT,
ADD COLUMN     "uebungsueberwachungId" TEXT,
ADD COLUMN     "uebungsziel" TEXT,
ADD COLUMN     "uebungszielsetzung" TEXT,
ADD COLUMN     "vorschlaege" TEXT,
ADD COLUMN     "weitereFeuerwehren" TEXT;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_uebungsleiterId_fkey" FOREIGN KEY ("uebungsleiterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_uebungsueberwachungId_fkey" FOREIGN KEY ("uebungsueberwachungId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_uebungsbeobachterId_fkey" FOREIGN KEY ("uebungsbeobachterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

