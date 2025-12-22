import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiBody,
} from '@nestjs/swagger';
import { MessagesService, ProcessingStatus } from './messages.service';
import { MessagesGateway } from './messages.gateway';
import { TutorNotificationService } from './tutor-notification.service';
import {
  SendTextMessageDto,
  SendAudioMessageDto,
  AssignTutorDto,
  CloseConversationDto,
  ConversationQueryDto,
} from './dto/send-message.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';

@ApiTags('messages')
@Controller('messages')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MessagesController {
  constructor(
    private readonly messagesService: MessagesService,
    private readonly messagesGateway: MessagesGateway,
    private readonly tutorNotificationService: TutorNotificationService,
  ) {}

  @Post('send')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a text message' })
  @ApiResponse({ status: 200, description: 'Message sent successfully' })
  async sendTextMessage(
    @CurrentUser() user: any,
    @Body() dto: SendTextMessageDto,
  ) {
    // Create status update emitter
    const emitStatus = (update: any) => {
      this.messagesGateway.emitProcessingStatus(user.id, update);
    };

    const result = await this.messagesService.sendTextMessage(
      user.id,
      user.role,
      dto,
      emitStatus,
    );

    const conversation = result.conversation!;

    // Emit real-time message event (pass sender to avoid duplicate on sender's side)
    await this.messagesGateway.emitNewMessage(conversation.id, result.message, user.id);

    // If new conversation, start smart tutor notification with FULL conversation object
    if (result.isNewConversation) {
      const studentName = conversation.student?.user?.name || 'Student';

      // Start the smart notification system - pass full conversation for broadcast
      await this.messagesGateway.startTutorNotification(
        {
          conversationId: conversation.id,
          subject: conversation.subject,
          topic: conversation.topic,
          urgency: conversation.urgency,
          studentName,
          studentId: conversation.studentId,
        },
        user.id,
        conversation, // Pass full conversation object
      );
    }

    return result;
  }

  @Post('send/audio')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('audio', {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB
    },
    fileFilter: (req, file, cb) => {
      // Accept audio files
      if (file.mimetype.startsWith('audio/') || 
          file.mimetype === 'application/octet-stream' ||
          file.originalname?.endsWith('.webm') ||
          file.originalname?.endsWith('.mp3') ||
          file.originalname?.endsWith('.wav') ||
          file.originalname?.endsWith('.m4a') ||
          file.originalname?.endsWith('.ogg')) {
        cb(null, true);
      } else {
        cb(new BadRequestException('Only audio files are allowed'), false);
      }
    },
  }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Send an audio message' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        audio: {
          type: 'string',
          format: 'binary',
          description: 'Audio file (webm, mp3, wav, m4a, ogg)',
        },
        conversationId: {
          type: 'string',
          description: 'Optional conversation ID',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Audio message sent successfully' })
  async sendAudioMessage(
    @CurrentUser() user: any,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: SendAudioMessageDto,
  ) {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('No audio file provided or file is empty');
    }

    // Create status update emitter
    const emitStatus = (update: any) => {
      this.messagesGateway.emitProcessingStatus(user.id, update);
    };

    const result = await this.messagesService.sendAudioMessage(
      user.id,
      user.role,
      file,
      dto.conversationId,
      emitStatus,
    );

    const conversation = result.conversation!;

    // Emit real-time message event (pass sender to avoid duplicate)
    await this.messagesGateway.emitNewMessage(conversation.id, result.message, user.id);

    // If new conversation, start smart tutor notification with FULL conversation object
    if (result.isNewConversation) {
      const studentName = conversation.student?.user?.name || 'Student';

      await this.messagesGateway.startTutorNotification(
        {
          conversationId: conversation.id,
          subject: conversation.subject,
          topic: conversation.topic,
          urgency: conversation.urgency,
          studentName,
          studentId: conversation.studentId,
        },
        user.id,
        conversation, // Pass full conversation object
      );
    }

    return result;
  }

  // Send message to existing conversation
  @Post('conversations/:conversationId/messages')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a message to an existing conversation' })
  @ApiResponse({ status: 200, description: 'Message sent successfully' })
  async sendMessageToConversation(
    @CurrentUser() user: any,
    @Param('conversationId') conversationId: string,
    @Body() dto: { content: string; messageType?: string },
  ) {
    // Send using the existing method with conversationId
    const result = await this.messagesService.sendTextMessage(
      user.id,
      user.role,
      { content: dto.content, conversationId },
      () => {}, // No status updates for existing conversations
    );

    // Emit real-time message event (pass sender to avoid duplicate)
    await this.messagesGateway.emitNewMessage(conversationId, result.message, user.id);

    return result;
  }

  // Send message with attachments (images/PDFs)
  @Post('conversations/:conversationId/attachments')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('files', {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB per file
      files: 4, // Max 4 files (1 image or 3 PDFs)
    },
    fileFilter: (req, file, cb) => {
      // Accept images and PDFs
      const allowedMimes = [
        'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
        'application/pdf'
      ];
      if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new BadRequestException('Only images (jpeg, png, gif, webp) and PDFs are allowed'), false);
      }
    },
  }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Send a message with attachments (images/PDFs)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description: 'Attachment files (max 1 image or 3 PDFs)',
        },
        content: {
          type: 'string',
          description: 'Optional text message with attachments',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Message with attachments sent successfully' })
  async sendAttachments(
    @CurrentUser() user: any,
    @Param('conversationId') conversationId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: { content?: string },
  ) {
    // Validate file
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    // Check attachment limits
    const isPdf = file.mimetype === 'application/pdf';
    const isImage = file.mimetype.startsWith('image/');

    if (!isPdf && !isImage) {
      throw new BadRequestException('Only images and PDFs are allowed');
    }

    // Send message with attachment
    const result = await this.messagesService.sendMessageWithAttachments(
      user.id,
      user.role,
      conversationId,
      dto.content || '',
      [file],
    );

    // Emit real-time message event
    await this.messagesGateway.emitNewMessage(conversationId, result.message, user.id);

    return result;
  }

  // Send multiple attachments
  @Post('conversations/:conversationId/attachments/multiple')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('files'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Send a message with multiple attachments (max 3 PDFs or 1 image)' })
  async sendMultipleAttachments(
    @CurrentUser() user: any,
    @Param('conversationId') conversationId: string,
    @UploadedFile() files: Express.Multer.File[],
    @Body() dto: { content?: string },
  ) {
    const fileArray = Array.isArray(files) ? files : [files].filter(Boolean);
    
    if (fileArray.length === 0) {
      throw new BadRequestException('No files provided');
    }

    // Validate: max 3 PDFs or 1 image
    const pdfFiles = fileArray.filter(f => f.mimetype === 'application/pdf');
    const imageFiles = fileArray.filter(f => f.mimetype.startsWith('image/'));

    if (pdfFiles.length > 3) {
      throw new BadRequestException('Maximum 3 PDF files allowed');
    }

    if (imageFiles.length > 1) {
      throw new BadRequestException('Maximum 1 image file allowed per message');
    }

    // Send message with attachments
    const result = await this.messagesService.sendMessageWithAttachments(
      user.id,
      user.role,
      conversationId,
      dto.content || '',
      fileArray,
    );

    // Emit real-time message event
    await this.messagesGateway.emitNewMessage(conversationId, result.message, user.id);

    return result;
  }

  @Get('conversations')
  @ApiOperation({ summary: 'Get my conversations' })
  @ApiResponse({ status: 200, description: 'List of conversations' })
  async getMyConversations(
    @CurrentUser() user: any,
    @Query() query: ConversationQueryDto,
  ) {
    return this.messagesService.getMyConversations(user.id, user.role, query);
  }

  @Get('conversations/pending')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'TUTOR')
  @ApiOperation({ summary: 'Get pending conversations' })
  @ApiResponse({ status: 200, description: 'List of pending conversations' })
  async getPendingConversations(@Query() query: ConversationQueryDto) {
    return this.messagesService.getPendingConversations(query);
  }

  // Get pending conversations that match tutor's subjects (for dashboard)
  @Get('conversations/pending/for-me')
  @UseGuards(RolesGuard)
  @Roles('TUTOR')
  @ApiOperation({ summary: 'Get pending conversations matching tutor subjects' })
  @ApiResponse({ status: 200, description: 'List of pending conversations tutor can accept' })
  async getPendingConversationsForTutor(@CurrentUser() user: any) {
    return this.messagesService.getPendingConversationsForTutor(user.id);
  }

  // Check if tutor can accept a specific conversation
  @Get('conversations/:conversationId/can-accept')
  @UseGuards(RolesGuard)
  @Roles('TUTOR')
  @ApiOperation({ summary: 'Check if tutor can accept this conversation' })
  @ApiResponse({ status: 200, description: 'Returns canAccept boolean and reason if not' })
  async canAcceptConversation(
    @CurrentUser() user: any,
    @Param('conversationId') conversationId: string,
  ) {
    // Get tutor profile by user ID directly
    const tutor = await this.messagesService.getTutorByUserId(user.id);

    if (!tutor) {
      return { canAccept: false, reason: 'Tutor profile not found' };
    }

    const result = await this.tutorNotificationService.canTutorAccept(tutor.id);
    
    // Also check if conversation is still pending
    const conversation = await this.messagesService.getConversation(conversationId, user.id, user.role);
    if (conversation && conversation.status !== 'PENDING') {
      return { canAccept: false, reason: 'This conversation has already been taken by another tutor' };
    }

    return result;
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: 'Get single conversation with messages' })
  @ApiResponse({ status: 200, description: 'Conversation with messages' })
  async getConversation(
    @CurrentUser() user: any,
    @Param('id') conversationId: string,
  ) {
    return this.messagesService.getConversation(conversationId, user.id, user.role);
  }

  @Post('conversations/:conversationId/accept')
  @UseGuards(RolesGuard)
  @Roles('TUTOR')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Tutor accepts a conversation' })
  @ApiResponse({ status: 200, description: 'Conversation accepted' })
  async acceptConversation(
    @CurrentUser() user: any,
    @Param('conversationId') conversationId: string,
  ) {
    // Get tutor profile by user ID directly
    const tutor = await this.messagesService.getTutorByUserId(user.id);

    if (!tutor) {
      throw new BadRequestException('Tutor profile not found');
    }

    const result = await this.messagesService.tutorAcceptConversation(
      conversationId,
      tutor.id,
      user.id,
    );

    const conversation = result.conversation!;

    // Notify student that tutor accepted
    this.messagesGateway.notifyStudentTutorAssigned(
      result.student.odID,
      conversationId,
      {
        id: tutor.id,
        name: tutor.users?.name || 'Tutor',
        avatar: tutor.users?.avatar,
      },
    );

    // Emit status change
    await this.messagesGateway.emitStatusChange(conversationId, 'ASSIGNED');

    return conversation;
  }

  @Post('conversations/:conversationId/assign')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign tutor to conversation (Admin only)' })
  @ApiResponse({ status: 200, description: 'Tutor assigned successfully' })
  async assignTutor(
    @Param('conversationId') conversationId: string,
    @Body() dto: AssignTutorDto,
  ) {
    const result = await this.messagesService.assignTutor(conversationId, dto.tutorId);

    const conversation = result.conversation!;

    // Get student user ID
    const studentUserId = conversation.student?.user?.id;

    // Notify the assigned tutor
    const studentName = conversation.student?.user?.name || 'Student';
    this.messagesGateway.notifyTutorAssignment(
      dto.tutorId,
      result.tutor.odID,
      {
        conversationId: conversation.id,
        subject: conversation.subject,
        urgency: conversation.urgency,
        studentName,
        topic: conversation.topic,
      },
    );

    // Notify student
    if (studentUserId) {
      this.messagesGateway.notifyStudentTutorAssigned(
        studentUserId,
        conversationId,
        {
          id: dto.tutorId,
          name: result.tutor.name,
        },
      );
    }

    // Notify conversation participants about status change
    await this.messagesGateway.emitStatusChange(conversationId, 'ASSIGNED');

    return conversation;
  }

  @Post('conversations/:conversationId/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close conversation' })
  @ApiResponse({ status: 200, description: 'Conversation closed successfully' })
  async closeConversation(
    @CurrentUser() user: any,
    @Param('conversationId') conversationId: string,
    @Body() dto: CloseConversationDto,
  ) {
    const result = await this.messagesService.closeConversation(
      conversationId,
      user.id,
      user.role,
      dto,
    );

    // Notify both student and tutor about status change with who closed it
    await this.messagesGateway.emitStatusChange(conversationId, dto.status, {
      id: user.id,
      role: user.role,
      name: user.name || user.email,
    });

    return result;
  }

  @Post('conversations/:conversationId/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark conversation as read' })
  @ApiResponse({ status: 200, description: 'Marked as read' })
  async markAsRead(
    @CurrentUser() user: any,
    @Param('conversationId') conversationId: string,
  ) {
    return this.messagesService.markAsRead(conversationId, user.id, user.role);
  }

  @Get('tutors/available')
  @ApiOperation({ summary: 'Find available tutors for a subject' })
  @ApiResponse({ status: 200, description: 'List of available tutors' })
  async findAvailableTutors(@Query('subject') subject: string) {
    return this.messagesService.getAvailableTutorsForSubject(subject || 'GENERAL');
  }

  @Post('tutor/busy-until')
  @UseGuards(RolesGuard)
  @Roles('TUTOR')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update tutor busy until time' })
  @ApiResponse({ status: 200, description: 'Busy until updated' })
  async updateBusyUntil(
    @CurrentUser() user: any,
    @Body() dto: { busyUntil: string },
  ) {
    // Get tutor profile by user ID directly
    const tutor = await this.messagesService.getTutorByUserId(user.id);

    if (!tutor) {
      throw new BadRequestException('Tutor profile not found');
    }

    return this.messagesService.updateTutorBusyUntil(
      tutor.id,
      new Date(dto.busyUntil),
    );
  }

  // ============ Call History Endpoints ============

  @Get('conversations/:conversationId/calls')
  @ApiOperation({ summary: 'Get call history for a conversation' })
  @ApiResponse({ status: 200, description: 'List of calls in the conversation' })
  async getConversationCalls(
    @CurrentUser() user: any,
    @Param('conversationId') conversationId: string,
  ) {
    return this.messagesService.getConversationCalls(conversationId, user.id, user.role);
  }

  @Get('calls/history')
  @ApiOperation({ summary: 'Get all call history for the current user' })
  @ApiResponse({ status: 200, description: 'List of all user calls' })
  async getCallHistory(
    @CurrentUser() user: any,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    return this.messagesService.getUserCallHistory(user.id, parseInt(page), parseInt(limit));
  }

  // DEBUG ENDPOINT - Test notification broadcast
  @Post('debug/test-notification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'DEBUG: Test notification broadcast' })
  async testNotification(@CurrentUser() user: any) {
    const testConversation = {
      id: 'test-conv-' + Date.now(),
      subject: 'COMPUTER_SCIENCE',
      topic: 'Test Notification',
      status: 'PENDING',
      student: {
        id: 'test-student',
        user: {
          id: user.id,
          name: user.name || 'Test Student',
          email: user.email,
          avatar: null,
        },
      },
      tutor: null,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const count = await this.messagesGateway.broadcastNewPendingConversation(
      'COMPUTER_SCIENCE',
      testConversation,
    );

    return {
      success: true,
      message: `Broadcast sent to ${count} tutors`,
      testConversation,
    };
  }

  // DEBUG: Get connected sockets info
  @Get('debug/sockets')
  @ApiOperation({ summary: 'DEBUG: Get connected sockets' })
  async getConnectedSockets() {
    return this.messagesGateway.getConnectedSocketsInfo();
  }

  // DEBUG: Simple emit test
  @Post('debug/emit-test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'DEBUG: Simple emit test' })
  async simpleEmitTest() {
    return this.messagesGateway.simpleEmitTest();
  }

  // ============ Message Reactions ============

  @Post('messages/:messageId/reactions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add or toggle a reaction (like/dislike) on a message' })
  @ApiResponse({ status: 200, description: 'Reaction added/updated/removed' })
  async addReaction(
    @CurrentUser() user: any,
    @Param('messageId') messageId: string,
    @Body() dto: { type: 'LIKE' | 'DISLIKE' },
  ) {
    return this.messagesService.addReaction(messageId, user.id, dto.type);
  }

  @Delete('messages/:messageId/reactions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove your reaction from a message' })
  @ApiResponse({ status: 200, description: 'Reaction removed' })
  async removeReaction(
    @CurrentUser() user: any,
    @Param('messageId') messageId: string,
  ) {
    return this.messagesService.removeReaction(messageId, user.id);
  }

  @Get('messages/:messageId/reactions')
  @ApiOperation({ summary: 'Get reaction summary for a message' })
  @ApiResponse({ status: 200, description: 'Reaction counts and user reaction' })
  async getMessageReactions(
    @CurrentUser() user: any,
    @Param('messageId') messageId: string,
  ) {
    return this.messagesService.getMessageReactions(messageId, user.id);
  }

  // ============ Conversation Sharing ============

  @Post('conversations/:conversationId/share')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Share a conversation (generate share link)' })
  @ApiResponse({ status: 200, description: 'Conversation shared, returns share URL' })
  async shareConversation(
    @CurrentUser() user: any,
    @Param('conversationId') conversationId: string,
  ) {
    return this.messagesService.shareConversation(conversationId, user.id, user.role);
  }

  @Delete('conversations/:conversationId/share')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stop sharing a conversation' })
  @ApiResponse({ status: 200, description: 'Sharing disabled' })
  async unshareConversation(
    @CurrentUser() user: any,
    @Param('conversationId') conversationId: string,
  ) {
    return this.messagesService.unshareConversation(conversationId, user.id, user.role);
  }

  @Get('conversations/:conversationId/share')
  @ApiOperation({ summary: 'Get share status for a conversation' })
  @ApiResponse({ status: 200, description: 'Share status and URL if shared' })
  async getShareStatus(
    @CurrentUser() user: any,
    @Param('conversationId') conversationId: string,
  ) {
    return this.messagesService.getShareStatus(conversationId, user.id, user.role);
  }

  @Get('shared/:shareToken')
  @ApiOperation({ summary: 'View a shared conversation (read-only, requires auth)' })
  @ApiResponse({ status: 200, description: 'Shared conversation view' })
  async getSharedConversation(
    @CurrentUser() user: any,
    @Param('shareToken') shareToken: string,
  ) {
    // User must be authenticated to view shared conversations
    if (!user) {
      throw new BadRequestException('Authentication required to view shared conversations');
    }
    return this.messagesService.getSharedConversation(shareToken);
  }
}
