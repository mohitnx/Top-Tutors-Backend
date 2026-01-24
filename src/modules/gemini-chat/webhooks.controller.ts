import {
  Controller,
  Post,
  Body,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TutorSessionService } from './tutor-session.service';

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly tutorSessionService: TutorSessionService) {}

  /**
   * Daily.co webhook endpoint for meeting events
   * Handles meeting.ended events to save chat messages and recordings
   */
  @Post('daily/meeting-ended')
  @HttpCode(HttpStatus.OK)
  async handleDailyMeetingEnded(@Body() webhookData: any) {
    try {
      const { event, payload } = webhookData;

      this.logger.log(`Received Daily.co webhook: ${event}`);

      if (event !== 'meeting.ended') {
        this.logger.warn(`Ignoring unsupported event: ${event}`);
        return { success: false, message: 'Event not supported' };
      }

      const { room, chat_messages, recording_url, participants, duration } = payload;

      if (!room?.name) {
        this.logger.error('Invalid webhook payload: missing room data');
        return { success: false, message: 'Invalid payload: missing room data' };
      }

      // Extract session ID from room name (format: tutor-{sessionId}-{timestamp})
      const roomName = room.name;
      const sessionIdMatch = roomName.match(/^tutor-([^-]+)-/);

      if (!sessionIdMatch) {
        this.logger.warn(`Could not extract session ID from room name: ${roomName}`);
        return { success: false, message: 'Could not extract session ID from room name' };
      }

      const sessionId = sessionIdMatch[1];
      this.logger.log(`Processing meeting data for session: ${sessionId}`);

      // Save the meeting data
      const result = await this.tutorSessionService.saveDailyMeetingData(sessionId, {
        roomUrl: room.url,
        chatMessages: chat_messages,
        recordingUrl: recording_url,
        duration: duration,
        participants: participants,
      });

      this.logger.log(`Successfully saved meeting data for session ${sessionId}`);
      return { success: true, sessionId };

    } catch (error: any) {
      this.logger.error(`Failed to process Daily.co webhook: ${error.message}`, error.stack);
      return { success: false, message: error.message };
    }
  }

  /**
   * Daily.co webhook verification endpoint (if needed)
   */
  @Post('daily/verify')
  @HttpCode(HttpStatus.OK)
  async verifyWebhook(@Body() data: any) {
    // Daily.co webhook verification logic can be added here if needed
    this.logger.log('Daily.co webhook verification request received');
    return { verified: true };
  }
}



