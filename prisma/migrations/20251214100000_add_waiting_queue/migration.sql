-- CreateEnum
CREATE TYPE "WaitingQueueStatus" AS ENUM ('WAITING', 'TUTORS_NOTIFIED', 'AVAILABILITY_COLLECTED', 'MATCHED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AvailabilityResponseType" AS ENUM ('MINUTES_5', 'MINUTES_10', 'NOT_ANYTIME_SOON', 'CUSTOM');

-- CreateTable
CREATE TABLE "waiting_queue" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "subject" "Subject" NOT NULL,
    "status" "WaitingQueueStatus" NOT NULL DEFAULT 'WAITING',
    "waitStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tutorsNotifiedAt" TIMESTAMP(3),
    "shortestWaitMinutes" INTEGER,
    "matchedTutorId" TEXT,
    "matchedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waiting_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tutor_availability_responses" (
    "id" TEXT NOT NULL,
    "waitingQueueId" TEXT NOT NULL,
    "tutorId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "responseType" "AvailabilityResponseType" NOT NULL,
    "customMinutes" INTEGER,
    "freeAt" TIMESTAMP(3) NOT NULL,
    "reminderSent" BOOLEAN NOT NULL DEFAULT false,
    "reminderSentAt" TIMESTAMP(3),
    "sessionTaken" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tutor_availability_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "waiting_queue_conversationId_key" ON "waiting_queue"("conversationId");

-- CreateIndex
CREATE INDEX "waiting_queue_studentId_idx" ON "waiting_queue"("studentId");

-- CreateIndex
CREATE INDEX "waiting_queue_status_idx" ON "waiting_queue"("status");

-- CreateIndex
CREATE INDEX "waiting_queue_subject_idx" ON "waiting_queue"("subject");

-- CreateIndex
CREATE INDEX "tutor_availability_responses_waitingQueueId_idx" ON "tutor_availability_responses"("waitingQueueId");

-- CreateIndex
CREATE INDEX "tutor_availability_responses_tutorId_idx" ON "tutor_availability_responses"("tutorId");

-- CreateIndex
CREATE INDEX "tutor_availability_responses_conversationId_idx" ON "tutor_availability_responses"("conversationId");

-- CreateIndex
CREATE INDEX "tutor_availability_responses_freeAt_idx" ON "tutor_availability_responses"("freeAt");

-- CreateIndex
CREATE UNIQUE INDEX "tutor_availability_responses_waitingQueueId_tutorId_key" ON "tutor_availability_responses"("waitingQueueId", "tutorId");

-- AddForeignKey
ALTER TABLE "waiting_queue" ADD CONSTRAINT "waiting_queue_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tutor_availability_responses" ADD CONSTRAINT "tutor_availability_responses_waitingQueueId_fkey" FOREIGN KEY ("waitingQueueId") REFERENCES "waiting_queue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tutor_availability_responses" ADD CONSTRAINT "tutor_availability_responses_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "tutors"("id") ON DELETE CASCADE ON UPDATE CASCADE;


