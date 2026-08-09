-- CreateTable for District
CREATE TABLE "District" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "District_pkey" PRIMARY KEY ("id")
);

-- CreateIndex on District
CREATE UNIQUE INDEX "District_number_key" ON "District"("number");

-- Add districtId, parentId to Organization
ALTER TABLE "Organization" ADD COLUMN "districtId" TEXT;
ALTER TABLE "Organization" ADD COLUMN "parentId" TEXT;

-- CreateTable for DroneGroup
CREATE TABLE "DroneGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "flightNotificationEmail" TEXT,
    "qrToken" TEXT,

    CONSTRAINT "DroneGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex for DroneGroup
CREATE UNIQUE INDEX "DroneGroup_name_key" ON "DroneGroup"("name");
CREATE UNIQUE INDEX "DroneGroup_qrToken_key" ON "DroneGroup"("qrToken");
CREATE INDEX "DroneGroup_organizationId_idx" ON "DroneGroup"("organizationId");

-- Add droneGroupId to DrohnengruppeMembership
ALTER TABLE "DrohnengruppeMembership" ADD COLUMN "droneGroupId" TEXT;
CREATE INDEX "DrohnengruppeMembership_droneGroupId_idx" ON "DrohnengruppeMembership"("droneGroupId");

-- Add droneGroupId to Event
ALTER TABLE "Event" ADD COLUMN "droneGroupId" TEXT;

-- Add droneGroupId to Drone
ALTER TABLE "Drone" ADD COLUMN "droneGroupId" TEXT;
CREATE INDEX "Drone_droneGroupId_idx" ON "Drone"("droneGroupId");

-- Add droneGroupId to DroneDocument
ALTER TABLE "DroneDocument" ADD COLUMN "droneGroupId" TEXT;
CREATE INDEX "DroneDocument_droneGroupId_idx" ON "DroneDocument"("droneGroupId");

-- Add isBezirksAdmin to User
ALTER TABLE "User" ADD COLUMN "isBezirksAdmin" BOOLEAN NOT NULL DEFAULT false;

-- Add Organization indexes for district/parent
CREATE INDEX "Organization_districtId_idx" ON "Organization"("districtId");
CREATE INDEX "Organization_parentId_idx" ON "Organization"("parentId");

-- AddForeignKey for Organization to District
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey for Organization self-relation
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey for DroneGroup to Organization
ALTER TABLE "DroneGroup" ADD CONSTRAINT "DroneGroup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey for DrohnengruppeMembership to DroneGroup
ALTER TABLE "DrohnengruppeMembership" ADD CONSTRAINT "DrohnengruppeMembership_droneGroupId_fkey" FOREIGN KEY ("droneGroupId") REFERENCES "DroneGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey for Event to DroneGroup
ALTER TABLE "Event" ADD CONSTRAINT "Event_droneGroupId_fkey" FOREIGN KEY ("droneGroupId") REFERENCES "DroneGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey for Drone to DroneGroup
ALTER TABLE "Drone" ADD CONSTRAINT "Drone_droneGroupId_fkey" FOREIGN KEY ("droneGroupId") REFERENCES "DroneGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey for DroneDocument to DroneGroup
ALTER TABLE "DroneDocument" ADD CONSTRAINT "DroneDocument_droneGroupId_fkey" FOREIGN KEY ("droneGroupId") REFERENCES "DroneGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
