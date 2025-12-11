-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- AlterTable
ALTER TABLE "tutors" ADD COLUMN     "busyUntil" TIMESTAMP(3),
ADD COLUMN     "currentConversationId" TEXT,
ADD COLUMN     "isBusy" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "tutor_notifications" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "tutorId" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "wave" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tutor_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tutor_notifications_conversationId_idx" ON "tutor_notifications"("conversationId");

-- CreateIndex
CREATE INDEX "tutor_notifications_tutorId_idx" ON "tutor_notifications"("tutorId");
