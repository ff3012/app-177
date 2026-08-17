-- CreateEnum
CREATE TYPE "IncidentKind" AS ENUM ('TECHNISCH', 'BRAND', 'SCHADSTOFF', 'SONSTIGES');

-- CreateEnum
CREATE TYPE "PhotoStatus" AS ENUM ('PENDING', 'UPLOADING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "fireDepartmentId" TEXT NOT NULL,
    "kind" "IncidentKind" NOT NULL,
    "keyword" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "alarmedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "crewCount" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentVehicle" (
    "incidentId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,

    CONSTRAINT "IncidentVehicle_pkey" PRIMARY KEY ("incidentId","vehicleId")
);

-- CreateTable
CREATE TABLE "IncidentCrewMember" (
    "incidentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "IncidentCrewMember_pkey" PRIMARY KEY ("incidentId","userId")
);

-- CreateTable
CREATE TABLE "IncidentPhoto" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "previewKey" TEXT,
    "thumbnailKey" TEXT,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "takenAt" TIMESTAMP(3),
    "publicRelease" BOOLEAN NOT NULL DEFAULT false,
    "status" "PhotoStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Incident_fireDepartmentId_idx" ON "Incident"("fireDepartmentId");

-- CreateIndex
CREATE INDEX "Incident_alarmedAt_idx" ON "Incident"("alarmedAt");

-- CreateIndex
CREATE INDEX "IncidentPhoto_incidentId_idx" ON "IncidentPhoto"("incidentId");

-- CreateIndex
CREATE INDEX "IncidentPhoto_status_createdAt_idx" ON "IncidentPhoto"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_fireDepartmentId_fkey" FOREIGN KEY ("fireDepartmentId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentVehicle" ADD CONSTRAINT "IncidentVehicle_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentVehicle" ADD CONSTRAINT "IncidentVehicle_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentCrewMember" ADD CONSTRAINT "IncidentCrewMember_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentCrewMember" ADD CONSTRAINT "IncidentCrewMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentPhoto" ADD CONSTRAINT "IncidentPhoto_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentPhoto" ADD CONSTRAINT "IncidentPhoto_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
