-- AlterTable
ALTER TABLE "tutor_sessions" ADD COLUMN     "dailyChatMessages" JSONB,
ADD COLUMN     "dailyRecordingUrl" TEXT,
ADD COLUMN     "dailyParticipants" JSONB;


