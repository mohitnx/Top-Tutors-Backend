import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  Req,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { MessagesService } from './messages.service';
import { CreateMessageDto, ConversationResponseDto, ConversationListResponseDto } from './dto';
import { JwtAuthGuard } from '../auth/guards';
import { CurrentUser } from '../auth/decorators';
import { SenderType, ConversationStatus } from '@prisma/client';
import { SUPPORTED_AUDIO_TYPES } from '../ai/ai.service';

@ApiTags('messages')
@Controller('messages')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post('send')
  @ApiOperation({ summary: 'Send a text message (creates conversation if needed)' })
  @ApiResponse({ status: 201, description: 'Message sent successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async sendMessage(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @Body() dto: CreateMessageDto,
  ) {
    const senderType = role === 'TUTOR' ? SenderType.TUTOR : SenderType.STUDENT;
    return this.messagesService.sendMessage(userId, senderType, dto);
  }

  @Post('send/audio')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ 
    summary: 'Send an audio message (supports English, Nepali, and mixed)',
    description: 'Upload audio file. Supported formats: wav, mp3, mpeg, aac, ogg, flac, webm. Max size: 10MB'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        audio: {
          type: 'string',
          format: 'binary',
          description: 'Audio file (wav, mp3, ogg, etc.)',
        },
        conversationId: {
          type: 'string',
          format: 'uuid',
          description: 'Optional: existing conversation ID to reply to',
        },
      },
      required: ['audio'],
    },
  })
  @ApiResponse({ status: 201, description: 'Audio message sent and transcribed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid audio file or format' })
  async sendAudioMessage(
    @Req() req: FastifyRequest,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    const senderType = role === 'TUTOR' ? SenderType.TUTOR : SenderType.STUDENT;

    // Parse multipart form data
    const data = await req.file();

    if (!data) {
      throw new BadRequestException('No audio file provided');
    }

    const mimeType = data.mimetype;

    // Validate audio type
    if (!SUPPORTED_AUDIO_TYPES.includes(mimeType)) {
      throw new BadRequestException(
        `Unsupported audio format: ${mimeType}. Supported formats: ${SUPPORTED_AUDIO_TYPES.join(', ')}`
      );
    }

    // Get the audio buffer
    const audioBuffer = await data.toBuffer();

    // Check file size (max 10MB)
    if (audioBuffer.length > 10 * 1024 * 1024) {
      throw new BadRequestException('Audio file too large. Maximum size is 10MB');
    }

    // Get conversation ID from form fields if provided
    let conversationId: string | undefined;
    if (data.fields && data.fields.conversationId) {
      const field = data.fields.conversationId as any;
      conversationId = field.value;
    }

    // For now, store audio as base64 data URL (in production, upload to cloud storage)
    const audioUrl = `data:${mimeType};base64,${audioBuffer.toString('base64')}`;

    // Estimate duration (rough estimate based on file size)
    // In production, use proper audio metadata extraction
    const estimatedDuration = Math.ceil(audioBuffer.length / 16000); // Rough estimate

    return this.messagesService.sendAudioMessage(
      userId,
      senderType,
      audioBuffer,
      mimeType,
      estimatedDuration,
      audioUrl,
      conversationId,
    );
  }

  @Get('conversations')
  @ApiOperation({ summary: 'Get my conversations' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, enum: ConversationStatus })
  @ApiResponse({ status: 200, description: 'List of conversations', type: ConversationListResponseDto })
  async getMyConversations(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: ConversationStatus,
  ) {
    if (role === 'TUTOR') {
      return this.messagesService.getTutorConversations(userId, page || 1, limit || 10, status);
    }
    return this.messagesService.getStudentConversations(userId, page || 1, limit || 10);
  }

  @Get('conversations/pending')
  @ApiOperation({ summary: 'Get pending conversations (admin/tutor)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'List of pending conversations' })
  async getPendingConversations(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.messagesService.getPendingConversations(page || 1, limit || 10);
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: 'Get a specific conversation with messages' })
  @ApiResponse({ status: 200, description: 'Conversation details', type: ConversationResponseDto })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  async getConversation(@Param('id', ParseUUIDPipe) id: string) {
    return this.messagesService.getConversation(id);
  }

  @Post('conversations/:id/assign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign a tutor to a conversation (admin)' })
  @ApiResponse({ status: 200, description: 'Tutor assigned successfully' })
  async assignTutor(
    @Param('id', ParseUUIDPipe) conversationId: string,
    @Body('tutorId') tutorId: string,
  ) {
    return this.messagesService.assignTutor(conversationId, tutorId);
  }

  @Post('conversations/:id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close or resolve a conversation' })
  @ApiResponse({ status: 200, description: 'Conversation closed successfully' })
  async closeConversation(
    @Param('id', ParseUUIDPipe) conversationId: string,
    @Body('status') status: 'RESOLVED' | 'CLOSED',
  ) {
    return this.messagesService.closeConversation(
      conversationId,
      status === 'RESOLVED' ? ConversationStatus.RESOLVED : ConversationStatus.CLOSED,
    );
  }

  @Post('conversations/:id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark messages as read' })
  @ApiResponse({ status: 200, description: 'Messages marked as read' })
  async markAsRead(
    @Param('id', ParseUUIDPipe) conversationId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.messagesService.markMessagesAsRead(conversationId, userId);
  }
}

