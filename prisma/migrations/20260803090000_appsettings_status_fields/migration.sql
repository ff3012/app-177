-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN "lastNewsCronRunAt" TIMESTAMP(3),
ADD COLUMN "lastBackupAt" TIMESTAMP(3);
