-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "googleId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "users_googleId_key" ON "users"("googleId");

-- AlterEnum
ALTER TYPE "ProjectResourceType" ADD VALUE IF NOT EXISTS 'DOCUMENT';
