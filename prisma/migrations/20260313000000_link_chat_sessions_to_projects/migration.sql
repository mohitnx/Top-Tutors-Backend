-- AlterTable
ALTER TABLE "ai_chat_sessions" ADD COLUMN "projectId" TEXT;

-- CreateIndex
CREATE INDEX "ai_chat_sessions_projectId_idx" ON "ai_chat_sessions"("projectId");

-- AddForeignKey
ALTER TABLE "ai_chat_sessions" ADD CONSTRAINT "ai_chat_sessions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
