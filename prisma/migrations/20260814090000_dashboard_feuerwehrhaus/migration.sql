-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "facebookPageAccessToken" TEXT,
ADD COLUMN     "facebookPageId" TEXT;

-- CreateTable
CREATE TABLE "DashboardToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "DashboardToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacebookPostCache" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "posts" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacebookPostCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacebookPostImage" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacebookPostImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WastlImageCache" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "data" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WastlImageCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DashboardToken_token_key" ON "DashboardToken"("token");

-- CreateIndex
CREATE INDEX "DashboardToken_organizationId_idx" ON "DashboardToken"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "FacebookPostCache_organizationId_key" ON "FacebookPostCache"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "FacebookPostImage_postId_key" ON "FacebookPostImage"("postId");

-- AddForeignKey
ALTER TABLE "DashboardToken" ADD CONSTRAINT "DashboardToken_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardToken" ADD CONSTRAINT "DashboardToken_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacebookPostCache" ADD CONSTRAINT "FacebookPostCache_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

