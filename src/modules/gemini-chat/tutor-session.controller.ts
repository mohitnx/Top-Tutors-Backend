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
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
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
  @UseGuards(RolesGuard)
  @Roles('STUDENT')
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
  @UseGuards(RolesGuard)
  @Roles('STUDENT')
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
  @UseGuards(RolesGuard)
  @Roles('STUDENT')
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
      // Get the AI session to find the student userId
      const prisma = this.tutorSessionService['prisma'];
      const aiSession = await prisma.ai_chat_sessions.findUnique({
        where: { id: aiSessionId },
        select: { userId: true },
      });

      await tutorSessionGateway.notifyTutorAccepted(
        aiSessionId,
        { id: 'test-tutor-id', name: 'Test Tutor', avatar: undefined },
        'test-session-' + Date.now(),
        undefined,
        aiSession?.userId, // ⭐ Pass student userId
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
  @UseGuards(RolesGuard)
  @Roles('TUTOR')
  async getPendingSessions(@CurrentUser('id') userId: string) {
    return this.tutorSessionService.getPendingSessions(userId);
  }

  /**
   * Accept a session
   */
  @Post(':sessionId/accept')
  @UseGuards(RolesGuard)
  @Roles('TUTOR')
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
  @UseGuards(RolesGuard)
  @Roles('TUTOR')
  async startSession(
    @CurrentUser('id') userId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.tutorSessionService.startSession(userId, sessionId);
  }

  /**
   * End the session (TUTOR only — students cannot end sessions)
   */
  @Post(':sessionId/end')
  @UseGuards(RolesGuard)
  @Roles('TUTOR')
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
  @UseGuards(RolesGuard)
  @Roles('TUTOR')
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
  @UseGuards(RolesGuard)
  @Roles('TUTOR')
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

  // ============ Multi-Tutor Collaboration ============

  /**
   * Invite another tutor to join the active session
   */
  @Post(':sessionId/invite-tutor')
  @UseGuards(RolesGuard)
  @Roles('TUTOR')
  async inviteTutor(
    @CurrentUser('id') userId: string,
    @Param('sessionId') sessionId: string,
    @Body() body: { tutorId: string },
  ) {
    return this.tutorSessionService.inviteTutorToSession(userId, sessionId, body.tutorId);
  }

  /**
   * Get available tutors that can be invited to the session
   */
  @Get(':sessionId/available-tutors')
  @UseGuards(RolesGuard)
  @Roles('TUTOR')
  async getAvailableTutors(
    @CurrentUser('id') userId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.tutorSessionService.getAvailableTutorsForInvite(userId, sessionId);
  }

  // ============ Daily.co Meeting Data Endpoints ============

  /**
   * Get Daily.co meeting data for a session (chat messages, recording, etc.)
   */
  @Get(':sessionId/daily-meeting-data')
  async getDailyMeetingData(
    @CurrentUser('id') userId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.tutorSessionService.getDailyMeetingData(userId, sessionId);
  }

  /**
   * Save Daily.co meeting data manually (for testing or frontend integration)
   */
  @Post(':sessionId/save-daily-data')
  async saveDailyMeetingData(
    @Param('sessionId') sessionId: string,
    @Body() meetingData: {
      roomUrl?: string;
      chatMessages?: any[];
      recordingUrl?: string;
      duration?: number;
      participants?: any[];
    },
  ) {
    return this.tutorSessionService.saveDailyMeetingData(sessionId, meetingData);
  }
}

