import {
  Controller,
  Post,
  Get,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TutorSessionService } from './tutor-session.service';

@Controller('tutor-session')
@UseGuards(JwtAuthGuard)
export class TutorSessionController {
  constructor(private readonly tutorSessionService: TutorSessionService) {}

  // ============ Student Endpoints ============

  /**
   * Request tutor help with full conversation analysis
   */
  @Post('request')
  async requestTutor(
    @CurrentUser('id') userId: string,
    @Body() body: { aiSessionId: string; urgency?: string },
  ) {
    return this.tutorSessionService.requestTutorWithFullAnalysis(
      userId,
      body.aiSessionId,
      body.urgency || 'NORMAL',
    );
  }

  /**
   * Update live sharing consent
   */
  @Put('consent/:sessionId')
  async updateConsent(
    @CurrentUser('id') userId: string,
    @Param('sessionId') sessionId: string,
    @Body() body: { enabled: boolean },
  ) {
    return this.tutorSessionService.updateLiveSharingConsent(
      userId,
      sessionId,
      body.enabled,
    );
  }

  /**
   * Get consent status
   */
  @Get('consent/:sessionId')
  async getConsentStatus(
    @CurrentUser('id') userId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.tutorSessionService.getConsentStatus(userId, sessionId);
  }

  /**
   * Get student room token for video call
   */
  @Get('student-room-token/:sessionId')
  async getStudentRoomToken(
    @CurrentUser('id') userId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.tutorSessionService.getStudentRoomToken(userId, sessionId);
  }

  /**
   * Debug endpoint to test WebSocket events
   */
  @Post('test-notification/:aiSessionId')
  async testNotification(@Param('aiSessionId') aiSessionId: string) {
    // Access the GeminiChatGateway through the service
    const tutorSessionGateway = this.tutorSessionService['tutorSessionGateway'];
    if (tutorSessionGateway) {
      await tutorSessionGateway.notifyTutorAccepted(
        aiSessionId,
        { name: 'Test Tutor', avatar: undefined },
        'test-session-id',
        'https://test.daily.co/room',
      );
      return { success: true, message: 'Test notification sent' };
    }
    return { success: false, message: 'Gateway not available' };
  }

  // ============ Tutor Endpoints ============

  /**
   * Get pending sessions available for tutor
   */
  @Get('pending')
  async getPendingSessions(@CurrentUser('id') userId: string) {
    return this.tutorSessionService.getPendingSessions(userId);
  }

  /**
   * Accept a session
   */
  @Post(':sessionId/accept')
  async acceptSession(
    @CurrentUser('id') userId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.tutorSessionService.tutorAcceptSession(userId, sessionId);
  }

  /**
   * Start the session
   */
  @Post(':sessionId/start')
  async startSession(
    @CurrentUser('id') userId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.tutorSessionService.startSession(userId, sessionId);
  }

  /**
   * End the session
   */
  @Post(':sessionId/end')
  async endSession(
    @CurrentUser('id') userId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.tutorSessionService.endSession(userId, sessionId);
  }

  /**
   * Get chat history for tutor (respects consent)
   */
  @Get(':sessionId/chat-history')
  async getChatHistory(
    @CurrentUser('id') userId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.tutorSessionService.getChatHistoryForTutor(userId, sessionId);
  }

  /**
   * Download chat as markdown/PDF
   */
  @Get(':sessionId/download')
  async downloadChat(
    @CurrentUser('id') userId: string,
    @Param('sessionId') sessionId: string,
    @Res() res: Response,
  ) {
    const { content, filename, mimeType } =
      await this.tutorSessionService.generateChatPDF(userId, sessionId);

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content);
  }

  /**
   * Save whiteboard data
   */
  @Put(':sessionId/whiteboard')
  async saveWhiteboard(
    @CurrentUser('id') userId: string,
    @Param('sessionId') sessionId: string,
    @Body() body: { whiteboardData: any },
  ) {
    return this.tutorSessionService.saveWhiteboardData(
      userId,
      sessionId,
      body.whiteboardData,
    );
  }

  /**
   * Fix tutor busy status inconsistencies (admin endpoint)
   */
  @Post('fix-tutor-status')
  async fixTutorStatus() {
    return this.tutorSessionService.fixTutorStatusInconsistencies();
  }
}

