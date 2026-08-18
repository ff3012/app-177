-- CreateEnum
CREATE TYPE "PhotoUploadKind" AS ENUM ('EINSATZ', 'UEBUNG', 'SONSTIGES');

-- CreateEnum
CREATE TYPE "PhotoStatus" AS ENUM ('PENDING', 'UPLOADING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "PhotoUpload" (
    "id" TEXT NOT NULL,
    "fireDepartmentId" TEXT NOT NULL,
    "kind" "PhotoUploadKind" NOT NULL,
    "description" TEXT NOT NULL,
    "occurredOn" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhotoUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "photoUploadId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "previewKey" TEXT,
    "thumbKey" TEXT,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "takenAt" TIMESTAMP(3),
    "status" "PhotoStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhotoUpload_fireDepartmentId_idx" ON "PhotoUpload"("fireDepartmentId");

-- CreateIndex
CREATE INDEX "PhotoUpload_createdAt_idx" ON "PhotoUpload"("createdAt");

-- CreateIndex
CREATE INDEX "Photo_photoUploadId_idx" ON "Photo"("photoUploadId");

-- CreateIndex
CREATE INDEX "Photo_status_createdAt_idx" ON "Photo"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "PhotoUpload" ADD CONSTRAINT "PhotoUpload_fireDepartmentId_fkey" FOREIGN KEY ("fireDepartmentId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoUpload" ADD CONSTRAINT "PhotoUpload_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_photoUploadId_fkey" FOREIGN KEY ("photoUploadId") REFERENCES "PhotoUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
