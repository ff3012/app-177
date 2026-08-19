/*
  Warnings:

  - You are about to drop the `NewsMessage` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "NewsAudience" AS ENUM ('FIRE_DEPARTMENT', 'DRONE_GROUP');

-- DropForeignKey
ALTER TABLE "NewsMessage" DROP CONSTRAINT "NewsMessage_audienceDroneGroupId_fkey";

-- DropForeignKey
ALTER TABLE "NewsMessage" DROP CONSTRAINT "NewsMessage_audienceOrgId_fkey";

-- DropForeignKey
ALTER TABLE "NewsMessage" DROP CONSTRAINT "NewsMessage_createdById_fkey";

-- DropTable
DROP TABLE "NewsMessage";

-- DropEnum
DROP TYPE "NewsAudienceType";

-- CreateTable
CREATE TABLE "NewsPost" (
    "id" TEXT NOT NULL,
    "audience" "NewsAudience" NOT NULL,
    "fireDepartmentId" TEXT,
    "droneGroupId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "eventId" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsRead" (
    "newsPostId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsRead_pkey" PRIMARY KEY ("newsPostId","userId")
);

-- CreateIndex
CREATE INDEX "NewsPost_scheduledAt_idx" ON "NewsPost"("scheduledAt");

-- CreateIndex
CREATE INDEX "NewsPost_fireDepartmentId_idx" ON "NewsPost"("fireDepartmentId");

-- CreateIndex
CREATE INDEX "NewsPost_droneGroupId_idx" ON "NewsPost"("droneGroupId");

-- AddForeignKey
ALTER TABLE "NewsPost" ADD CONSTRAINT "NewsPost_fireDepartmentId_fkey" FOREIGN KEY ("fireDepartmentId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsPost" ADD CONSTRAINT "NewsPost_droneGroupId_fkey" FOREIGN KEY ("droneGroupId") REFERENCES "DroneGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsPost" ADD CONSTRAINT "NewsPost_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsPost" ADD CONSTRAINT "NewsPost_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsRead" ADD CONSTRAINT "NewsRead_newsPostId_fkey" FOREIGN KEY ("newsPostId") REFERENCES "NewsPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsRead" ADD CONSTRAINT "NewsRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
