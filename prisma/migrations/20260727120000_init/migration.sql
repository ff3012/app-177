-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('FEUERWEHR', 'ABSCHNITTSKOMMANDO');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "DroneRole" AS ENUM ('PILOT', 'VIEWER');

-- CreateEnum
CREATE TYPE "FlightPurpose" AS ENUM ('UEBUNG', 'EINSATZ');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "type" "OrganizationType" NOT NULL,
    "icsToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "homeOrganizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrohnengruppeMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "DroneRole" NOT NULL DEFAULT 'PILOT',
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DrohnengruppeMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "organizationId" TEXT NOT NULL,
    "isSectionWide" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Drone" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Drone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DroneFlight" (
    "id" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "pilotName" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "droneId" TEXT NOT NULL,
    "purpose" "FlightPurpose" NOT NULL,
    "notes" TEXT,
    "registeredById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DroneFlight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_name_key" ON "Organization"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_icsToken_key" ON "Organization"("icsToken");

-- CreateIndex
CREATE INDEX "Organization_type_idx" ON "Organization"("type");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_homeOrganizationId_idx" ON "User"("homeOrganizationId");

-- CreateIndex
CREATE INDEX "Membership_organizationId_idx" ON "Membership"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_organizationId_role_key" ON "Membership"("userId", "organizationId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "DrohnengruppeMembership_userId_key" ON "DrohnengruppeMembership"("userId");

-- CreateIndex
CREATE INDEX "Event_organizationId_startsAt_idx" ON "Event"("organizationId", "startsAt");

-- CreateIndex
CREATE INDEX "Event_isSectionWide_startsAt_idx" ON "Event"("isSectionWide", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Drone_name_key" ON "Drone"("name");

-- CreateIndex
CREATE INDEX "DroneFlight_startsAt_idx" ON "DroneFlight"("startsAt");

-- CreateIndex
CREATE INDEX "DroneFlight_droneId_idx" ON "DroneFlight"("droneId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_homeOrganizationId_fkey" FOREIGN KEY ("homeOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrohnengruppeMembership" ADD CONSTRAINT "DrohnengruppeMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DroneFlight" ADD CONSTRAINT "DroneFlight_droneId_fkey" FOREIGN KEY ("droneId") REFERENCES "Drone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DroneFlight" ADD CONSTRAINT "DroneFlight_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
