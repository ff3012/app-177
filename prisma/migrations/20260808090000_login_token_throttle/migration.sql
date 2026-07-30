-- CreateTable
CREATE TABLE "LoginTokenRequestAttempt" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "firstRequestAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoginTokenRequestAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LoginTokenRequestAttempt_email_key" ON "LoginTokenRequestAttempt"("email");
