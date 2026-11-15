-- CreateEnum
CREATE TYPE "NotificationForm" AS ENUM ('DRINKS', 'DAMAGE');

-- CreateTable
CREATE TABLE "NotificationFormSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "form" "NotificationForm" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "recipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "products" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationFormSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationFormSetting_organizationId_form_key" ON "NotificationFormSetting"("organizationId", "form");

-- AddForeignKey
ALTER TABLE "NotificationFormSetting" ADD CONSTRAINT "NotificationFormSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

