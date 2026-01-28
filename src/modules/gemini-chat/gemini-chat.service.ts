import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel, Content, Part } from '@google/generative-ai';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateSessionDto,
  UpdateSessionDto,
  GetSessionsQueryDto,
  SendMessageDto,
  SessionResponse,
  MessageResponse,
  AIAttachment,
  StreamChunk,
} from './dto';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';

export interface StreamingResponse {
  messageId: string;
  sessionId: string;
  emitter: EventEmitter;
}

@Injectable()
export class GeminiChatService {
  private readonly logger = new Logger(GeminiChatService.name);
  private genAI: GoogleGenerativeAI | null = null;
  private model: GenerativeModel | null = null;
  private workingModelName: string | null = null;
  
  // Models to try in order of preference
  private readonly modelsToTry = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-pro', 'gemini-pro-latest']

  
  // Track active streams for reconnection
  private activeStreams: Map<string, { content: string; complete: boolean }> = new Map();

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    // Use NEW_GEMINI_KEY as specified
    const apiKey = this.configService.get<string>('NEW_GEMINI_KEY');
    
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey.trim());
      this.logger.log('Gemini AI SDK initialized, will detect working model on first request');
    } else {
      this.logger.warn('NEW_GEMINI_KEY not configured - AI chat will not work');
    }
  }

  /**
   * Get or initialize a working model (tries multiple models)
   */
  private async getWorkingModel(): Promise<GenerativeModel> {
    if (!this.genAI) {
      throw new InternalServerErrorException('Gemini AI not configured');
    }

    // If we already have a working model, return it
    if (this.model && this.workingModelName) {
      return this.model;
    }

    // Try each model until one works
    for (const modelName of this.modelsToTry) {
      try {
        const testModel = this.genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            temperature: 0.7,
            topP: 0.95,
            topK: 40,
            maxOutputTokens: 8192,
          },
        });

        // Test with a simple prompt
        const testResult = await testModel.generateContent('Hi');
        if (testResult.response?.text()) {
          this.model = testModel;
          this.workingModelName = modelName;
          this.logger.log(`✅ Using Gemini model: ${modelName}`);
          return this.model;
        }
      } catch (error: any) {
        this.logger.warn(`Model ${modelName} failed: ${error.message}`);
        continue;
      }
    }

    throw new InternalServerErrorException('No working Gemini model found. Please check your API key.');
  }

  // ============ Session Management ============

  /**
   * Create a new chat session
   */
  async createSession(userId: string, dto: CreateSessionDto): Promise<SessionResponse> {
    const session = await this.prisma.ai_chat_sessions.create({
      data: {
        userId,
        title: dto.title || null,
        subject: dto.subject as any,
      },
    });

    return this.formatSession(session);
  }

  /**
   * Get all sessions for a user (for sidebar)
   */
  async getSessions(userId: string, query: GetSessionsQueryDto): Promise<{
    sessions: SessionResponse[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const { page = 1, limit = 20, includeArchived, subject, search } = query;
    const skip = (page - 1) * limit;

    const whereClause: any = { userId };
    
    if (!includeArchived) {
      whereClause.isArchived = false;
    }
    
    if (subject) {
      whereClause.subject = subject;
    }
    
    if (search) {
      whereClause.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { summary: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [sessions, total] = await Promise.all([
      this.prisma.ai_chat_sessions.findMany({
        where: whereClause,
        orderBy: [
          { isPinned: 'desc' },
          { lastMessageAt: 'desc' },
        ],
        skip,
        take: limit,
        include: {
          ai_messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              content: true,
              role: true,
              createdAt: true,
            },
          },
          _count: {
            select: { ai_messages: true },
          },
        },
      }),
      this.prisma.ai_chat_sessions.count({ where: whereClause }),
    ]);

    return {
      sessions: sessions.map((s: any) => this.formatSession(s, true)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get a single session with all messages
   */
  async getSession(sessionId: string, userId: string): Promise<{
    session: SessionResponse;
    messages: MessageResponse[];
  }> {
    const session = await this.prisma.ai_chat_sessions.findFirst({
      where: { id: sessionId, userId },
      include: {
        ai_messages: {
          orderBy: { createdAt: 'asc' },
        },
        _count: {
          select: { ai_messages: true },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    return {
      session: this.formatSession(session, true),
      messages: session.ai_messages.map((m: any) => this.formatMessage(m)),
    };
  }

  /**
   * Update session (title, pin, archive)
   */
  async updateSession(sessionId: string, userId: string, dto: UpdateSessionDto): Promise<SessionResponse> {
    const session = await this.prisma.ai_chat_sessions.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    const updated = await this.prisma.ai_chat_sessions.update({
      where: { id: sessionId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.isPinned !== undefined && { isPinned: dto.isPinned }),
        ...(dto.isArchived !== undefined && { isArchived: dto.isArchived }),
      },
    });

    return this.formatSession(updated);
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string, userId: string): Promise<{ success: boolean }> {
    const session = await this.prisma.ai_chat_sessions.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    await this.prisma.ai_chat_sessions.delete({
      where: { id: sessionId },
    });

    return { success: true };
  }

  // ============ Message Handling ============

  /**
   * Send a message and get AI response (non-streaming)
   */
  async sendMessage(
    userId: string,
    dto: SendMessageDto,
    attachments?: Express.Multer.File[]
  ): Promise<{
    userMessage: MessageResponse;
    aiMessage: MessageResponse;
    session: SessionResponse;
  }> {
    this.logger.log(`sendMessage called for user ${userId}, content: ${dto.content?.substring(0, 50)}...`);

    if (!this.genAI) {
      this.logger.error('Gemini AI not configured');
      throw new InternalServerErrorException('Gemini AI not configured');
    }

    const model = await this.getWorkingModel();
    this.logger.log(`Using model: ${model?.model}`);

    // Get or create session
    let session: any;
    if (dto.sessionId) {
      session = await this.prisma.ai_chat_sessions.findFirst({
        where: { id: dto.sessionId, userId },
      });
      if (!session) {
        throw new NotFoundException('Session not found');
      }
    } else {
      session = await this.prisma.ai_chat_sessions.create({
        data: { userId },
      });
    }

    // Process attachments
    const processedAttachments = await this.processAttachments(attachments);

    // Create user message
    const userMessage = await this.prisma.ai_messages.create({
      data: {
        sessionId: session.id,
        role: 'USER',
        content: dto.content || null,
        attachments: processedAttachments.length > 0 ? (processedAttachments as any) : undefined,
      },
    });

    // Get conversation history
    const history = await this.getConversationHistory(session.id);

    // Build the prompt with attachments
    const prompt = await this.buildPrompt(dto.content || '', attachments);

    try {
      this.logger.log(`Generating content with history length: ${history.length}, prompt length: ${prompt.length}`);

      // Generate response
      const result = await model.generateContent({
        contents: [...history, { role: 'user', parts: prompt }],
      });

      const responseText = result.response.text();
      const usageMetadata = result.response.usageMetadata;

      this.logger.log(`Generated response: ${responseText?.substring(0, 100)}..., tokens: ${usageMetadata?.promptTokenCount}/${usageMetadata?.candidatesTokenCount}`);

      // Create AI message
      const aiMessage = await this.prisma.ai_messages.create({
        data: {
          sessionId: session.id,
          role: 'ASSISTANT',
          content: responseText,
          isComplete: true,
          promptTokens: usageMetadata?.promptTokenCount,
          completionTokens: usageMetadata?.candidatesTokenCount,
        },
      });

      this.logger.log(`Created AI message with ID: ${aiMessage.id}`);

      // Update session
      await this.updateSessionAfterMessage(session.id, dto.content || '', responseText);

      const updatedSession = await this.prisma.ai_chat_sessions.findUnique({
        where: { id: session.id },
      });

      this.logger.log(`Returning response with session ID: ${updatedSession?.id}`);

      return {
        userMessage: this.formatMessage(userMessage),
        aiMessage: this.formatMessage(aiMessage),
        session: this.formatSession(updatedSession),
      };
    } catch (error: any) {
      this.logger.error(`Error generating AI response: ${error.message}`, error.stack);

      // Create error message
      const aiMessage = await this.prisma.ai_messages.create({
        data: {
          sessionId: session.id,
          role: 'ASSISTANT',
          content: null,
          hasError: true,
          errorMessage: error.message || 'Failed to generate response',
          isComplete: false,
        },
      });

      this.logger.log(`Created error message with ID: ${aiMessage.id}`);

      throw new InternalServerErrorException({
        message: 'Failed to generate AI response',
        userMessage: this.formatMessage(userMessage),
        aiMessage: this.formatMessage(aiMessage),
        session: this.formatSession(session),
      });
    }
  }

  /**
   * Send a message with streaming response
   */
  async sendMessageStreaming(
    userId: string,
    dto: SendMessageDto,
    attachments?: Express.Multer.File[],
  ): Promise<StreamingResponse> {
    if (!this.genAI) {
      throw new InternalServerErrorException('Gemini AI not configured');
    }

    // Pre-validate model availability
    await this.getWorkingModel();

    const emitter = new EventEmitter();

    // Get or create session
    let session: any;
    if (dto.sessionId) {
      session = await this.prisma.ai_chat_sessions.findFirst({
        where: { id: dto.sessionId, userId },
      });
      if (!session) {
        throw new NotFoundException('Session not found');
      }
    } else {
      session = await this.prisma.ai_chat_sessions.create({
        data: { userId },
      });
    }

    // Process attachments
    const processedAttachments = await this.processAttachments(attachments);

    // Create user message
    const userMessage = await this.prisma.ai_messages.create({
      data: {
        sessionId: session.id,
        role: 'USER',
        content: dto.content || null,
        attachments: processedAttachments.length > 0 ? (processedAttachments as any) : undefined,
      },
    });

    // Create placeholder AI message
    const streamId = uuidv4();
    const aiMessage = await this.prisma.ai_messages.create({
      data: {
        sessionId: session.id,
        role: 'ASSISTANT',
        content: '',
        isStreaming: true,
        isComplete: false,
        streamId,
      },
    });

    // Initialize stream tracking
    this.activeStreams.set(streamId, { content: '', complete: false });

    // Start streaming in background
    this.streamResponse(
      session.id,
      aiMessage.id,
      streamId,
      dto.content || '',
      attachments,
      emitter,
    ).catch((error) => {
      this.logger.error(`Stream error: ${error.message}`);
      emitter.emit('chunk', {
        type: 'error',
        messageId: aiMessage.id,
        sessionId: session.id,
        error: error.message,
      } as StreamChunk);
    });

    return {
      messageId: aiMessage.id,
      sessionId: session.id,
      emitter,
    };
  }

  /**
   * Internal streaming method
   */
  private async streamResponse(
    sessionId: string,
    messageId: string,
    streamId: string,
    content: string,
    attachments: Express.Multer.File[] | undefined,
    emitter: EventEmitter,
  ): Promise<void> {
    try {
      // Get working model
      const model = await this.getWorkingModel();

      // Get conversation history
      const history = await this.getConversationHistory(sessionId, messageId);
      const prompt = await this.buildPrompt(content, attachments);

      // Emit start
      emitter.emit('chunk', {
        type: 'start',
        messageId,
        sessionId,
      } as StreamChunk);

      // Generate streaming response
      const result = await model.generateContentStream({
        contents: [...history, { role: 'user', parts: prompt }],
      });

      let fullContent = '';

      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        fullContent += chunkText;

        // Update stream tracking
        const streamData = this.activeStreams.get(streamId);
        if (streamData) {
          streamData.content = fullContent;
        }

        // Emit chunk
        emitter.emit('chunk', {
          type: 'chunk',
          messageId,
          sessionId,
          content: chunkText,
          fullContent,
        } as StreamChunk);
      }

      // Get final response for usage stats
      const finalResponse = await result.response;
      const usageMetadata = finalResponse.usageMetadata;

      // Update message in database
      await this.prisma.ai_messages.update({
        where: { id: messageId },
        data: {
          content: fullContent,
          isStreaming: false,
          isComplete: true,
          promptTokens: usageMetadata?.promptTokenCount,
          completionTokens: usageMetadata?.candidatesTokenCount,
        },
      });

      // Update stream tracking
      const streamData = this.activeStreams.get(streamId);
      if (streamData) {
        streamData.complete = true;
      }

      // Update session
      await this.updateSessionAfterMessage(sessionId, content, fullContent);

      // Emit end
      emitter.emit('chunk', {
        type: 'end',
        messageId,
        sessionId,
        fullContent,
        usage: {
          promptTokens: usageMetadata?.promptTokenCount || 0,
          completionTokens: usageMetadata?.candidatesTokenCount || 0,
        },
      } as StreamChunk);

      // Cleanup stream after a delay
      setTimeout(() => {
        this.activeStreams.delete(streamId);
      }, 60000); // Keep for 1 minute for reconnection

    } catch (error: any) {
      this.logger.error(`Streaming error: ${error.message}`);

      // Update message with error
      await this.prisma.ai_messages.update({
        where: { id: messageId },
        data: {
          isStreaming: false,
          isComplete: false,
          hasError: true,
          errorMessage: error.message,
        },
      });

      // Emit error
      emitter.emit('chunk', {
        type: 'error',
        messageId,
        sessionId,
        error: error.message,
      } as StreamChunk);
    }
  }

  /**
   * Get current stream state (for reconnection after page reload)
   */
  async getStreamState(streamId: string): Promise<{
    content: string;
    complete: boolean;
  } | null> {
    const streamData = this.activeStreams.get(streamId);
    if (streamData) {
      return streamData;
    }

    // Check database for completed stream
    const message = await this.prisma.ai_messages.findFirst({
      where: { streamId },
    });

    if (message) {
      return {
        content: message.content || '',
        complete: message.isComplete,
      };
    }

    return null;
  }

  /**
   * Retry a failed message
   */
  async retryMessage(messageId: string, userId: string): Promise<StreamingResponse> {
    // Get the failed message
    const failedMessage = await this.prisma.ai_messages.findFirst({
      where: { id: messageId },
      include: { ai_chat_sessions: true },
    });

    if (!failedMessage) {
      throw new NotFoundException('Message not found');
    }

    if (failedMessage.ai_chat_sessions.userId !== userId) {
      throw new NotFoundException('Message not found');
    }

    if (failedMessage.role !== 'ASSISTANT' || !failedMessage.hasError) {
      throw new BadRequestException('Can only retry failed AI messages');
    }

    // Get the user message before this one
    const userMessage = await this.prisma.ai_messages.findFirst({
      where: {
        sessionId: failedMessage.sessionId,
        role: 'USER',
        createdAt: { lt: failedMessage.createdAt },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!userMessage) {
      throw new BadRequestException('Cannot find original message to retry');
    }

    // Delete the failed message
    await this.prisma.ai_messages.delete({
      where: { id: messageId },
    });

    // Update retry count
    await this.prisma.ai_messages.update({
      where: { id: userMessage.id },
      data: { retryCount: { increment: 1 } },
    });

    // Resend the message
    return this.sendMessageStreaming(userId, {
      content: userMessage.content || undefined,
      sessionId: failedMessage.sessionId,
    });
  }

  /**
   * Add feedback to a message
   */
  async addMessageFeedback(
    messageId: string,
    userId: string,
    feedback: 'GOOD' | 'BAD',
  ): Promise<MessageResponse> {
    const message = await this.prisma.ai_messages.findFirst({
      where: { id: messageId },
      include: { ai_chat_sessions: true },
    });

    if (!message || message.ai_chat_sessions.userId !== userId) {
      throw new NotFoundException('Message not found');
    }

    const updated = await this.prisma.ai_messages.update({
      where: { id: messageId },
      data: { feedback },
    });

    return this.formatMessage(updated);
  }

  // ============ Audio Message Handling ============

  /**
   * Send an audio message
   */
  async sendAudioMessage(
    userId: string,
    file: Express.Multer.File,
    sessionId?: string,
  ): Promise<StreamingResponse> {
    if (!this.genAI) {
      throw new InternalServerErrorException('Gemini AI not configured');
    }

    // Transcribe audio
    const transcription = await this.transcribeAudio(file);

    // Get or create session
    let session: any;
    if (sessionId) {
      session = await this.prisma.ai_chat_sessions.findFirst({
        where: { id: sessionId, userId },
      });
      if (!session) {
        throw new NotFoundException('Session not found');
      }
    } else {
      session = await this.prisma.ai_chat_sessions.create({
        data: { userId },
      });
    }

    // Store audio file
    const audioUrl = await this.storeFile(file, 'audio');

    // Create user message with audio
    await this.prisma.ai_messages.create({
      data: {
        sessionId: session.id,
        role: 'USER',
        content: transcription,
        audioUrl,
        audioDuration: Math.ceil(file.size / 16000), // Rough estimate
        transcription,
      },
    });

    // Send transcribed message for AI response
    return this.sendMessageStreaming(userId, {
      content: transcription,
      sessionId: session.id,
    });
  }

  /**
   * Transcribe audio using Gemini
   */
  private async transcribeAudio(file: Express.Multer.File): Promise<string> {
    if (!this.genAI) {
      return '[Audio transcription unavailable]';
    }

    const base64Audio = file.buffer.toString('base64');
    let mimeType = file.mimetype || 'audio/webm';

    if (mimeType === 'application/octet-stream') {
      const ext = file.originalname?.split('.').pop()?.toLowerCase();
      const mimeMap: Record<string, string> = {
        webm: 'audio/webm',
        mp3: 'audio/mp3',
        wav: 'audio/wav',
        m4a: 'audio/m4a',
        ogg: 'audio/ogg',
      };
      mimeType = mimeMap[ext || ''] || 'audio/webm';
    }

    try {
      const model = await this.getWorkingModel();
      const result = await model.generateContent([
        {
          inlineData: { mimeType, data: base64Audio },
        },
        {
          text: 'Transcribe this audio message accurately. Return only the transcription text.',
        },
      ]);

      const transcription = result.response.text().trim();
      return transcription || '[Could not transcribe audio]';
    } catch (error: any) {
      this.logger.warn(`Audio transcription failed: ${error.message}`);
      return '[Audio transcription failed]';
    }
  }

  // ============ Tutor Request ============

  /**
   * Request a tutor for a session
   */
  async requestTutor(
    userId: string,
    sessionId: string,
    subject?: string,
    urgency: string = 'NORMAL',
  ): Promise<{
    success: boolean;
    status: string;
    linkedConversationId?: string;
  }> {
    const session = await this.prisma.ai_chat_sessions.findFirst({
      where: { id: sessionId, userId },
      include: {
        ai_messages: {
          orderBy: { createdAt: 'asc' },
          take: 10,
        },
        users: {
          select: { name: true, email: true },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (session.tutorRequestStatus && session.tutorRequestStatus !== 'NONE') {
      throw new BadRequestException('Tutor already requested for this session');
    }

    // Get user's student profile
    const student = await this.prisma.students.findUnique({
      where: { userId },
    });

    if (!student) {
      throw new BadRequestException('Student profile required to request tutor');
    }

    // Analyze conversation to determine subject if not provided
    const detectedSubject = subject || session.subject || await this.detectSubject(session.ai_messages.filter(m => m.content !== null).map(m => ({ content: m.content || undefined })));

    // Create a conversation for tutor matching
    const conversation = await this.prisma.conversations.create({
      data: {
        id: uuidv4(),
        studentId: student.id,
        subject: detectedSubject as any,
        topic: session.title || 'Help Request from AI Chat',
        urgency: urgency as any,
        status: 'PENDING',
        updatedAt: new Date(),
      },
    });

    // Copy relevant messages to conversation
    const messagesContext = session.ai_messages
      .slice(-5)
      .map((m: any) => `[${m.role}]: ${m.content}`)
      .join('\n\n');

    // Create initial message with context
    await this.prisma.messages.create({
      data: {
        id: uuidv4(),
        conversationId: conversation.id,
        senderId: student.id,
        senderType: 'STUDENT',
        content: `[Context from AI Chat]\n\n${messagesContext}\n\n---\nI need help from a real tutor with this topic.`,
        messageType: 'TEXT',
      },
    });

    // Update session with tutor request status
    await this.prisma.ai_chat_sessions.update({
      where: { id: sessionId },
      data: {
        tutorRequestStatus: 'REQUESTED',
        tutorRequestedAt: new Date(),
        linkedConversationId: conversation.id,
        subject: detectedSubject as any,
      },
    });

    return {
      success: true,
      status: 'REQUESTED',
      linkedConversationId: conversation.id,
    };
  }

  /**
   * Cancel tutor request
   */
  async cancelTutorRequest(userId: string, sessionId: string): Promise<{ success: boolean }> {
    const session = await this.prisma.ai_chat_sessions.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (!session.tutorRequestStatus || session.tutorRequestStatus === 'NONE') {
      throw new BadRequestException('No tutor request to cancel');
    }

    if (session.tutorRequestStatus === 'TUTOR_CONNECTED') {
      throw new BadRequestException('Cannot cancel - tutor already connected');
    }

    // Cancel the linked conversation
    if (session.linkedConversationId) {
      await this.prisma.conversations.update({
        where: { id: session.linkedConversationId },
        data: { status: 'CLOSED', updatedAt: new Date() },
      });
    }

    // Update session
    await this.prisma.ai_chat_sessions.update({
      where: { id: sessionId },
      data: {
        tutorRequestStatus: 'CANCELLED',
      },
    });

    return { success: true };
  }

  /**
   * Get tutor request status
   */
  async getTutorRequestStatus(userId: string, sessionId: string): Promise<{
    status: string;
    tutorInfo?: any;
    conversationId?: string;
    estimatedWait?: string;
  }> {
    const session = await this.prisma.ai_chat_sessions.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    let tutorInfo = null;
    let estimatedWait = null;

    if (session.linkedConversationId) {
      const conversation = await this.prisma.conversations.findUnique({
        where: { id: session.linkedConversationId },
        include: {
          tutors: {
            include: {
              users: { select: { name: true, avatar: true } },
            },
          },
          waiting_queue: true,
        },
      });

      if (conversation?.tutors) {
        tutorInfo = {
          id: conversation.tutors.id,
          name: conversation.tutors.users?.name,
          avatar: conversation.tutors.users?.avatar,
        };
      }

      if (conversation?.waiting_queue?.shortestWaitMinutes) {
        estimatedWait = `~${conversation.waiting_queue.shortestWaitMinutes} minutes`;
      }
    }

    return {
      status: session.tutorRequestStatus || 'NONE',
      tutorInfo,
      conversationId: session.linkedConversationId || undefined,
      estimatedWait: estimatedWait || undefined,
    };
  }

  // ============ Private Helper Methods ============

  private async processAttachments(files?: Express.Multer.File[]): Promise<AIAttachment[]> {
    if (!files || files.length === 0) return [];

    const attachments: AIAttachment[] = [];
    for (const file of files) {
      const folder = file.mimetype.startsWith('image/') ? 'images' : 'documents';
      const url = await this.storeFile(file, folder);
      attachments.push({
        url,
        name: file.originalname || 'file',
        type: file.mimetype.startsWith('image/') ? 'image' : 'document',
        size: file.size,
        mimeType: file.mimetype,
      });
    }
    return attachments;
  }

  private async storeFile(file: Express.Multer.File, folder: string): Promise<string> {
    const ext = file.originalname?.split('.').pop() || 'bin';
    const filename = `${uuidv4()}.${ext}`;
    // TODO: Upload to cloud storage in production
    return `/uploads/${folder}/${filename}`;
  }

  private async buildPrompt(content: string, attachments?: Express.Multer.File[]): Promise<Part[]> {
    const parts: Part[] = [];

    // Add attachments first (images/PDFs)
    if (attachments) {
      for (const file of attachments) {
        if (file.mimetype.startsWith('image/')) {
          parts.push({
            inlineData: {
              mimeType: file.mimetype,
              data: file.buffer.toString('base64'),
            },
          });
        } else if (file.mimetype === 'application/pdf') {
          // For PDFs, we can send them as inline data
          parts.push({
            inlineData: {
              mimeType: 'application/pdf',
              data: file.buffer.toString('base64'),
            },
          });
        }
      }
    }

    // Add text content
    if (content) {
      parts.push({ text: content });
    }

    return parts;
  }

  private async getConversationHistory(sessionId: string, excludeMessageId?: string): Promise<Content[]> {
    const messages = await this.prisma.ai_messages.findMany({
      where: {
        sessionId,
        role: { in: ['USER', 'ASSISTANT'] },
        isComplete: true,
        hasError: false,
        ...(excludeMessageId && { id: { not: excludeMessageId } }),
      },
      orderBy: { createdAt: 'asc' },
      take: 20, // Limit history for context window
    });

    return messages.map((msg: any) => ({
      role: msg.role === 'USER' ? 'user' : 'model',
      parts: [{ text: msg.content || '' }],
    }));
  }

  private async updateSessionAfterMessage(sessionId: string, userContent: string, aiContent: string): Promise<void> {
    const session = await this.prisma.ai_chat_sessions.findUnique({
      where: { id: sessionId },
    });

    const updates: any = {
      lastMessageAt: new Date(),
    };

    // Auto-generate title if not set
    if (session && !session.title) {
      updates.title = await this.generateTitle(userContent);
    }

    // Detect subject if not set
    if (session && !session.subject) {
      updates.subject = await this.detectSubject([{ content: userContent }]);
    }

    await this.prisma.ai_chat_sessions.update({
      where: { id: sessionId },
      data: updates,
    });
  }

  private async generateTitle(content: string): Promise<string> {
    if (!this.genAI) {
      return content.slice(0, 50) + (content.length > 50 ? '...' : '');
    }

    try {
      const model = await this.getWorkingModel();
      const result = await model.generateContent(
        `Generate a very short title (max 6 words) for this question. Return only the title, nothing else: "${content.slice(0, 200)}"`
      );
      return result.response.text().trim().slice(0, 100);
    } catch {
      return content.slice(0, 50) + (content.length > 50 ? '...' : '');
    }
  }

  private async detectSubject(messages: { content?: string }[]): Promise<string> {
    const content = messages.map(m => m.content).filter(Boolean).join(' ');
    
    if (!this.genAI || !content) {
      return 'GENERAL';
    }

    const validSubjects = [
      'MATHEMATICS', 'PHYSICS', 'CHEMISTRY', 'BIOLOGY', 'ENGLISH',
      'HISTORY', 'GEOGRAPHY', 'COMPUTER_SCIENCE', 'ECONOMICS', 'ACCOUNTING', 'GENERAL',
    ];

    try {
      const model = await this.getWorkingModel();
      const result = await model.generateContent(
        `Classify this content into one of these subjects: ${validSubjects.join(', ')}. Return only the subject name: "${content.slice(0, 500)}"`
      );
      const detected = result.response.text().trim().toUpperCase();
      return validSubjects.includes(detected) ? detected : 'GENERAL';
    } catch {
      return 'GENERAL';
    }
  }

  private formatSession(session: any, includeLastMessage = false): SessionResponse {
    const result: SessionResponse = {
      id: session.id,
      title: session.title,
      summary: session.summary,
      subject: session.subject,
      isPinned: session.isPinned,
      isArchived: session.isArchived,
      lastMessageAt: session.lastMessageAt,
      createdAt: session.createdAt,
      tutorRequestStatus: session.tutorRequestStatus,
      linkedConversationId: session.linkedConversationId,
    };

    if (session._count) {
      result.messageCount = session._count.ai_messages;
    }

    if (includeLastMessage && session.ai_messages?.[0]) {
      result.lastMessage = {
        content: session.ai_messages[0].content,
        role: session.ai_messages[0].role,
        createdAt: session.ai_messages[0].createdAt,
      };
    }

    return result;
  }

  private formatMessage(message: any): MessageResponse {
    return {
      id: message.id,
      sessionId: message.sessionId,
      role: message.role,
      content: message.content,
      attachments: message.attachments,
      audioUrl: message.audioUrl,
      transcription: message.transcription,
      isStreaming: message.isStreaming,
      isComplete: message.isComplete,
      hasError: message.hasError,
      errorMessage: message.errorMessage,
      feedback: message.feedback,
      createdAt: message.createdAt,
    };
  }
}

