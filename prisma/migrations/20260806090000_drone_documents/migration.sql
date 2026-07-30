-- CreateTable
CREATE TABLE "DroneDocument" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DroneDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DroneDocument_createdAt_idx" ON "DroneDocument"("createdAt");

-- AddForeignKey
ALTER TABLE "DroneDocument" ADD CONSTRAINT "DroneDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
