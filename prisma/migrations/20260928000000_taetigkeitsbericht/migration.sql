-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('ACTIVITY', 'EXERCISE', 'INCIDENT');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "ReportMemberFunktion" AS ENUM ('KOMMANDANT', 'FAHRER', 'MANNSCHAFT');

-- CreateEnum
CREATE TYPE "ReportQuantityKind" AS ENUM ('MATERIAL', 'EQUIPMENT');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "reportRecipients" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "number" INTEGER,
    "year" INTEGER,
    "type" "ReportType" NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
    "fireDepartmentId" TEXT NOT NULL,
    "vehicleBookingId" TEXT,
    "filledById" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "ownActivity" BOOLEAN,
    "activityKinds" TEXT[],
    "activityOther" TEXT,
    "vehicleId" TEXT,
    "vehicleKm" INTEGER,
    "remark" TEXT,
    "emailSentAt" TIMESTAMP(3),
    "emailError" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportMember" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "funktion" "ReportMemberFunktion" NOT NULL,

    CONSTRAINT "ReportMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportQuantity" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "kind" "ReportQuantityKind" NOT NULL,
    "code" TEXT NOT NULL,
    "value" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "ReportQuantity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSequence" (
    "fireDepartmentId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReportSequence_pkey" PRIMARY KEY ("fireDepartmentId","year")
);

-- CreateIndex
CREATE UNIQUE INDEX "Report_vehicleBookingId_key" ON "Report"("vehicleBookingId");

-- CreateIndex
CREATE INDEX "Report_fireDepartmentId_status_idx" ON "Report"("fireDepartmentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Report_fireDepartmentId_year_number_key" ON "Report"("fireDepartmentId", "year", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ReportMember_reportId_userId_key" ON "ReportMember"("reportId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportQuantity_reportId_kind_code_key" ON "ReportQuantity"("reportId", "kind", "code");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_fireDepartmentId_fkey" FOREIGN KEY ("fireDepartmentId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_vehicleBookingId_fkey" FOREIGN KEY ("vehicleBookingId") REFERENCES "VehicleBooking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_filledById_fkey" FOREIGN KEY ("filledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportMember" ADD CONSTRAINT "ReportMember_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportMember" ADD CONSTRAINT "ReportMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportQuantity" ADD CONSTRAINT "ReportQuantity_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

