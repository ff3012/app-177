-- CreateEnum
CREATE TYPE "ZusageStatus" AS ENUM ('ZUGESAGT', 'ABGESAGT', 'UNKLAR');

-- CreateTable
CREATE TABLE "TerminZusage" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ZusageStatus" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TerminZusage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TerminZusage_eventId_idx" ON "TerminZusage"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "TerminZusage_eventId_userId_key" ON "TerminZusage"("eventId", "userId");

-- AddForeignKey
ALTER TABLE "TerminZusage" ADD CONSTRAINT "TerminZusage_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerminZusage" ADD CONSTRAINT "TerminZusage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
