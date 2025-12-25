import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiBody,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { GeminiChatService } from './gemini-chat.service';
import { GeminiChatGateway } from './gemini-chat.gateway';
import { Logger } from '@nestjs/common';
import {
  CreateSessionDto,
  UpdateSessionDto,
  GetSessionsQueryDto,
  SendMessageDto,
  SendAudioMessageDto,
  RetryMessageDto,
  MessageFeedbackDto,
  RequestTutorDto,
} from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('gemini-chat')
@Controller('gemini-chat')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class GeminiChatController {
  private readonly logger = new Logger(GeminiChatController.name);

  constructor(
    private readonly geminiChatService: GeminiChatService,
    private readonly geminiChatGateway: GeminiChatGateway,
  ) {}

  // ============ Session Endpoints ============

  @Post('sessions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new chat session' })
  @ApiResponse({ status: 201, description: 'Session created successfully' })
  async createSession(
    @CurrentUser() user: any,
    @Body() dto: CreateSessionDto,
  ) {
    return this.geminiChatService.createSession(user.id, dto);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Get all chat sessions (for sidebar)' })
  @ApiResponse({ status: 200, description: 'List of chat sessions' })
  async getSessions(
    @CurrentUser() user: any,
    @Query() query: GetSessionsQueryDto,
  ) {
    return this.geminiChatService.getSessions(user.id, query);
  }

  @Get('sessions/:sessionId')
  @ApiOperation({ summary: 'Get a single session with all messages' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'Session with messages' })
  async getSession(
    @CurrentUser() user: any,
    @Param('sessionId') sessionId: string,
  ) {
    return this.geminiChatService.getSession(sessionId, user.id);
  }

  @Put('sessions/:sessionId')
  @ApiOperation({ summary: 'Update session (title, pin, archive)' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'Session updated' })
  async updateSession(
    @CurrentUser() user: any,
    @Param('sessionId') sessionId: string,
    @Body() dto: UpdateSessionDto,
  ) {
    return this.geminiChatService.updateSession(sessionId, user.id, dto);
  }

  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a session' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'Session deleted' })
  async deleteSession(
    @CurrentUser() user: any,
    @Param('sessionId') sessionId: string,
  ) {
    return this.geminiChatService.deleteSession(sessionId, user.id);
  }

  // ============ Message Endpoints ============

  @Post('messages')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a text message to Gemini AI' })
  @ApiBody({ type: SendMessageDto })
  @ApiResponse({ status: 200, description: 'Message sent and AI response received' })
  async sendMessage(
    @CurrentUser() user: any,
    @Body() dto: SendMessageDto,
  ) {
    this.logger.log(`Sending message for user ${user.id}, stream: ${dto.stream}`);

    // Non-streaming response for simple cases
    if (!dto.stream) {
      this.logger.log('Using non-streaming response');
      const result = await this.geminiChatService.sendMessage(user.id, dto);
      this.logger.log(`Non-streaming result: ${JSON.stringify(result)}`);
      return result;
    }

    // For streaming, return message IDs and use WebSocket for content
    this.logger.log('Using streaming response');
    const result = await this.geminiChatService.sendMessageStreaming(user.id, dto);

    // Set up event forwarding to WebSocket
    result.emitter.on('chunk', (chunk) => {
      this.logger.log(`Emitting chunk: ${chunk.type}`);
      this.geminiChatGateway.emitStreamChunk(user.id, chunk);
    });

    return {
      messageId: result.messageId,
      sessionId: result.sessionId,
      streaming: true,
      message: 'Response streaming via WebSocket',
    };
  }

  @Post('messages/stream')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a message with SSE streaming response' })
  @ApiBody({ type: SendMessageDto })
  @ApiResponse({ status: 200, description: 'Streaming response' })
  async sendMessageStream(
    @CurrentUser() user: any,
    @Body() dto: SendMessageDto,
    @Res() res: Response,
  ) {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const result = await this.geminiChatService.sendMessageStreaming(user.id, dto);

    // Send initial message
    res.write(`data: ${JSON.stringify({ type: 'init', messageId: result.messageId, sessionId: result.sessionId })}\n\n`);

    result.emitter.on('chunk', (chunk) => {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      
      if (chunk.type === 'end' || chunk.type === 'error') {
        res.end();
      }
    });

    // Handle client disconnect
    res.on('close', () => {
      result.emitter.removeAllListeners();
    });
  }

  @Post('messages/with-attachments')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FilesInterceptor('files', 5, {
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB per file
    fileFilter: (req, file, cb) => {
      const allowedMimes = [
        'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
        'application/pdf',
      ];
      if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new BadRequestException('Only images and PDFs are allowed'), false);
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
        },
        content: { type: 'string' },
        sessionId: { type: 'string' },
        stream: { type: 'boolean', default: true },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Message with attachments sent' })
  async sendMessageWithAttachments(
    @CurrentUser() user: any,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() dto: SendMessageDto,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('At least one file is required');
    }

    // Validate: max 5 images or 3 PDFs
    const pdfFiles = files.filter(f => f.mimetype === 'application/pdf');
    const imageFiles = files.filter(f => f.mimetype.startsWith('image/'));

    if (pdfFiles.length > 3) {
      throw new BadRequestException('Maximum 3 PDF files allowed');
    }

    if (imageFiles.length > 5) {
      throw new BadRequestException('Maximum 5 image files allowed');
    }

    const result = await this.geminiChatService.sendMessageStreaming(user.id, dto, files);
    
    // Set up event forwarding to WebSocket
    result.emitter.on('chunk', (chunk) => {
      this.geminiChatGateway.emitStreamChunk(user.id, chunk);
    });

    return {
      messageId: result.messageId,
      sessionId: result.sessionId,
      streaming: true,
      attachments: files.length,
    };
  }

  @Post('messages/audio')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('audio', {
    limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
    fileFilter: (req, file, cb) => {
      if (file.mimetype.startsWith('audio/') || 
          file.mimetype === 'application/octet-stream' ||
          file.originalname?.match(/\.(webm|mp3|wav|m4a|ogg|aac)$/i)) {
        cb(null, true);
      } else {
        cb(new BadRequestException('Only audio files are allowed'), false);
      }
    },
  }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Send an audio message (will be transcribed)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        audio: { type: 'string', format: 'binary' },
        sessionId: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Audio message sent and transcribed' })
  async sendAudioMessage(
    @CurrentUser() user: any,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: SendAudioMessageDto,
  ) {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('No audio file provided');
    }

    const result = await this.geminiChatService.sendAudioMessage(user.id, file, dto.sessionId);
    
    // Set up event forwarding to WebSocket
    result.emitter.on('chunk', (chunk) => {
      this.geminiChatGateway.emitStreamChunk(user.id, chunk);
    });

    return {
      messageId: result.messageId,
      sessionId: result.sessionId,
      streaming: true,
    };
  }

  @Post('messages/:messageId/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retry a failed AI response' })
  @ApiParam({ name: 'messageId', description: 'Failed message ID to retry' })
  @ApiResponse({ status: 200, description: 'Retry initiated' })
  async retryMessage(
    @CurrentUser() user: any,
    @Param('messageId') messageId: string,
  ) {
    const result = await this.geminiChatService.retryMessage(messageId, user.id);
    
    result.emitter.on('chunk', (chunk) => {
      this.geminiChatGateway.emitStreamChunk(user.id, chunk);
    });

    return {
      messageId: result.messageId,
      sessionId: result.sessionId,
      streaming: true,
    };
  }

  @Post('messages/:messageId/feedback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add feedback (like/dislike) to a message' })
  @ApiParam({ name: 'messageId', description: 'Message ID' })
  @ApiBody({ type: MessageFeedbackDto })
  @ApiResponse({ status: 200, description: 'Feedback added' })
  async addFeedback(
    @CurrentUser() user: any,
    @Param('messageId') messageId: string,
    @Body() dto: MessageFeedbackDto,
  ) {
    return this.geminiChatService.addMessageFeedback(messageId, user.id, dto.feedback);
  }

  @Get('streams/:streamId')
  @ApiOperation({ summary: 'Get current state of a stream (for reconnection)' })
  @ApiParam({ name: 'streamId', description: 'Stream ID from message' })
  @ApiResponse({ status: 200, description: 'Stream state' })
  async getStreamState(
    @Param('streamId') streamId: string,
  ) {
    const state = await this.geminiChatService.getStreamState(streamId);
    if (!state) {
      return { found: false };
    }
    return { found: true, ...state };
  }

  // ============ Tutor Request Endpoints ============

  @Post('tutor/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a real tutor for help with current session' })
  @ApiBody({ type: RequestTutorDto })
  @ApiResponse({ status: 200, description: 'Tutor request initiated' })
  async requestTutor(
    @CurrentUser() user: any,
    @Body() dto: RequestTutorDto,
  ) {
    const result = await this.geminiChatService.requestTutor(
      user.id, 
      dto.sessionId, 
      dto.subject, 
      dto.urgency
    );

    // Notify via WebSocket
    if (result.linkedConversationId) {
      this.geminiChatGateway.emitTutorStatusUpdate(user.id, dto.sessionId, {
        status: 'REQUESTED',
        message: 'Looking for available tutors...',
      });
    }

    return result;
  }

  @Delete('tutor/request/:sessionId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel tutor request' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'Tutor request cancelled' })
  async cancelTutorRequest(
    @CurrentUser() user: any,
    @Param('sessionId') sessionId: string,
  ) {
    const result = await this.geminiChatService.cancelTutorRequest(user.id, sessionId);

    this.geminiChatGateway.emitTutorStatusUpdate(user.id, sessionId, {
      status: 'CANCELLED',
      message: 'Tutor request cancelled',
    });

    return result;
  }

  @Get('tutor/status/:sessionId')
  @ApiOperation({ summary: 'Get tutor request status for a session' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'Tutor request status' })
  async getTutorStatus(
    @CurrentUser() user: any,
    @Param('sessionId') sessionId: string,
  ) {
    return this.geminiChatService.getTutorRequestStatus(user.id, sessionId);
  }
}

