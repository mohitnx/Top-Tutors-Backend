-- AlterTable: make teacherId optional, add uploadedByUserId
ALTER TABLE "daily_uploads" ALTER COLUMN "teacherId" DROP NOT NULL;

-- Backfill uploadedByUserId from existing teacher records
ALTER TABLE "daily_uploads" ADD COLUMN "uploadedByUserId" TEXT;

UPDATE "daily_uploads"
SET "uploadedByUserId" = t."userId"
FROM "teachers" t
WHERE "daily_uploads"."teacherId" = t."id";

-- Now make it NOT NULL after backfill
ALTER TABLE "daily_uploads" ALTER COLUMN "uploadedByUserId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "daily_uploads" ADD CONSTRAINT "daily_uploads_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "daily_uploads_uploadedByUserId_idx" ON "daily_uploads"("uploadedByUserId");
