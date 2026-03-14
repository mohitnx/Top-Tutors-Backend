-- AlterTable: Add optional sessionId to project_resources for session-level files
ALTER TABLE "project_resources" ADD COLUMN "sessionId" TEXT;

-- CreateIndex
CREATE INDEX "project_resources_sessionId_idx" ON "project_resources"("sessionId");

-- AddForeignKey
ALTER TABLE "project_resources" ADD CONSTRAINT "project_resources_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "project_chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
