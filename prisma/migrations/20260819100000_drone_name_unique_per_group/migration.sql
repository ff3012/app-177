-- DropIndex
DROP INDEX "Drone_name_key";

-- CreateIndex
CREATE UNIQUE INDEX "Drone_droneGroupId_name_key" ON "Drone"("droneGroupId", "name");

