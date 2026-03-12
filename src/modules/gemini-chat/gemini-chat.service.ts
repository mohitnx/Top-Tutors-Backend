import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemInstructionsService } from '../ai/system-instructions/system-instructions.service';
import { LlmService, LlmMessage, LlmContentPart, LlmStream } from '../llm';
import { LlmProvider } from '../prompts/types/prompt.types';
import { PromptService } from '../prompts/prompt.service';
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
import {
  COUNCIL_MEMBERS,
  CouncilMember,
  CouncilMemberResponse,
  SYNTHESIZER_MODEL,
  SYNTHESIZER_CONFIG,
  parseCouncilResponse,
} from '../ai/council-members';

export interface StreamingResponse {
  messageId: string;
  sessionId: string;
  emitter: EventEmitter;
}

@Injectable()
export class GeminiChatService {
  private readonly logger = new Logger(GeminiChatService.name);
  private workingModelName: string | null = null;

  // Track active streams for reconnection
  private activeStreams: Map<
    string,
    {
      content: string;
      complete: boolean;
      startedAtMs: number;
      lastActivityAtMs: number;
      cancelled?: boolean;
    }
  > = new Map();

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly systemInstructions: SystemInstructionsService,
    private readonly promptService: PromptService,
    private readonly llm: LlmService,
  ) {}

  /**
   * Get or detect a working model name (tries multiple models via LlmService)
   */
  private workingProvider: string | null = null;

  private async getWorkingModelName(): Promise<string> {
    if (this.workingModelName) return this.workingModelName;

    // Try each available provider in priority order
    const providers = this.llm.getAvailableProviders();
    for (const providerName of providers) {
      const resolved = this.llm.resolvePrompt('tutor-chat-single', undefined, providerName);
      for (const modelName of resolved.models) {
        try {
          const testResult = await this.llm.generate(
            providerName,
            [{ role: 'user', parts: [{ text: 'Hi' }] }],
            {
              model: modelName,
              systemPrompt: resolved.systemPrompt || undefined,
              generationConfig: resolved.generationConfig,
            },
          );
          if (testResult.text) {
            this.workingModelName = modelName;
            this.workingProvider = providerName;
            this.logger.log(`Using model: ${modelName} (provider: ${providerName})`);
            return modelName;
          }
        } catch (error: any) {
          this.logger.warn(`[${providerName}] Model ${modelName} failed: ${error.message}`);
          continue;
        }
      }
    }

    throw new InternalServerErrorException('No working LLM model found. Check your API keys.');
  }

  private getActiveProvider(): LlmProvider {
    return (this.workingProvider as LlmProvider) || this.llm.getDefaultProvider();
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
        ...(dto.mode && { mode: dto.mode as any }),
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

    const [sessions, total] = await this.prisma.withUserContext(userId, (tx) =>
      Promise.all([
        tx.ai_chat_sessions.findMany({
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
        tx.ai_chat_sessions.count({ where: whereClause }),
      ])
    );

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
    const session = await this.prisma.withUserContext(userId, (tx) =>
      tx.ai_chat_sessions.findFirst({
        where: { id: sessionId, userId },
        include: {
          ai_messages: {
            orderBy: { createdAt: 'asc' },
          },
          _count: {
            select: { ai_messages: true },
          },
        },
      })
    );

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
        ...(dto.mode !== undefined && { mode: dto.mode as any }),
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

    const modelName = await this.getWorkingModelName();
    this.logger.log(`Using model: ${modelName}`);

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
    const promptParts = await this.buildPromptParts(dto.content || '', attachments);

    try {
      this.logger.log(`Generating content with history length: ${history.length}`);

      const resolved = this.llm.resolvePrompt('tutor-chat-single');
      const messages: LlmMessage[] = [
        ...history,
        { role: 'user', parts: promptParts },
      ];

      // Generate response
      const result = await this.llm.generate(this.getActiveProvider(), messages, {
        model: modelName,
        systemPrompt: resolved.systemPrompt || undefined,
        generationConfig: resolved.generationConfig,
      });

      const responseText = result.text;
      const usageMetadata = result.usage;

      this.logger.log(`Generated response: ${responseText?.substring(0, 100)}..., tokens: ${usageMetadata?.promptTokens}/${usageMetadata?.completionTokens}`);

      // Create AI message
      const aiMessage = await this.prisma.ai_messages.create({
        data: {
          sessionId: session.id,
          role: 'ASSISTANT',
          content: responseText,
          isComplete: true,
          promptTokens: usageMetadata?.promptTokens,
          completionTokens: usageMetadata?.completionTokens,
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
    // Pre-validate model availability
    await this.getWorkingModelName();

    const emitter = new EventEmitter();

    // Get or create session
    let session: any;
    if (dto.sessionId) {
      // withUserContext activates RLS — DB enforces ownership even if WHERE clause were removed
      session = await this.prisma.withUserContext(userId, (tx) =>
        tx.ai_chat_sessions.findFirst({ where: { id: dto.sessionId, userId } })
      );
      if (!session) {
        throw new NotFoundException('Session not found');
      }
    } else {
      session = await this.prisma.ai_chat_sessions.create({
        data: { userId },
      });
    }

    // Route to council mode if enabled on this session
    if (session.mode === 'COUNCIL') {
      this.logger.log(`[MODE] Council mode active for session ${session.id} — routing to multi-expert pipeline`);
      return this.runCouncilStreaming(session, dto.content || '', attachments, emitter);
    }
    this.logger.log(`[MODE] Single AI mode for session ${session.id}`);

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
    const now = Date.now();
    this.activeStreams.set(streamId, {
      content: '',
      complete: false,
      startedAtMs: now,
      lastActivityAtMs: now,
      cancelled: false,
    });

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
    const heartbeatIntervalMs =
      Number(this.configService.get<string>('GEMINI_STREAM_HEARTBEAT_MS')) || 5000;
    const idleTimeoutMs =
      Number(this.configService.get<string>('GEMINI_STREAM_IDLE_TIMEOUT_MS')) || 90000;
    const totalTimeoutMs =
      Number(this.configService.get<string>('GEMINI_STREAM_TOTAL_TIMEOUT_MS')) || 5 * 60 * 1000;

    let heartbeatTimer: NodeJS.Timeout | null = null;

    try {
      // Get working model and prompt config
      const modelName = await this.getWorkingModelName();
      const resolved = this.llm.resolvePrompt('tutor-chat-single');

      // Get conversation history + build prompt
      const history = await this.getConversationHistory(sessionId, messageId);
      const promptParts = await this.buildPromptParts(content, attachments);

      // Emit start
      emitter.emit('chunk', {
        type: 'start',
        messageId,
        sessionId,
        message: 'Started generating response',
      } as StreamChunk);

      // Stream via LlmService
      const llmStream = await this.llm.stream(
        this.getActiveProvider(),
        [...history, { role: 'user', parts: promptParts }],
        {
          model: modelName,
          systemPrompt: resolved.systemPrompt || undefined,
          generationConfig: resolved.generationConfig,
        },
      );

      let fullContent = '';
      const startedAtMs = Date.now();

      // Heartbeat: keep UI alive even when model is slow
      heartbeatTimer = setInterval(() => {
        const streamData = this.activeStreams.get(streamId);
        if (!streamData || streamData.complete || streamData.cancelled) return;

        const now = Date.now();
        const waitingMs = now - streamData.lastActivityAtMs;
        emitter.emit('chunk', {
          type: 'heartbeat',
          messageId,
          sessionId,
          fullContent: streamData.content,
          waitingMs,
          message:
            waitingMs > 30000
              ? 'Still working… this is taking longer than usual'
              : 'Still working…',
        } as StreamChunk);
      }, heartbeatIntervalMs);

      // Iterate the provider-agnostic stream with timeout
      for await (const chunkText of llmStream) {
        const elapsedMs = Date.now() - startedAtMs;
        if (elapsedMs > totalTimeoutMs) {
          throw new Error('Generation timed out (took too long)');
        }

        fullContent += chunkText;

        // Update stream tracking
        const streamData = this.activeStreams.get(streamId);
        if (streamData) {
          streamData.content = fullContent;
          streamData.lastActivityAtMs = Date.now();
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
      const finalResult = await llmStream.getResponse();
      const usageMetadata = finalResult.usage;

      // Update message in database
      await this.prisma.ai_messages.update({
        where: { id: messageId },
        data: {
          content: fullContent,
          isStreaming: false,
          isComplete: true,
          promptTokens: usageMetadata?.promptTokens,
          completionTokens: usageMetadata?.completionTokens,
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
          promptTokens: usageMetadata?.promptTokens || 0,
          completionTokens: usageMetadata?.completionTokens || 0,
        },
      } as StreamChunk);

      // Cleanup stream after a delay
      setTimeout(() => {
        this.activeStreams.delete(streamId);
      }, 60000);

    } catch (error: any) {
      this.logger.error(`Streaming error: ${error.message}`);

      const streamData = this.activeStreams.get(streamId);
      if (streamData) {
        streamData.cancelled = true;
      }

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
        message: 'Failed to generate response',
      } as StreamChunk);
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
    }
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    let timeout: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timeout = setTimeout(() => reject(new Error(message)), ms);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
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
   * Transcribe audio using LLM
   */
  private async transcribeAudio(file: Express.Multer.File): Promise<string> {
    let mimeType = file.mimetype || 'audio/webm';
    if (mimeType === 'application/octet-stream') {
      const ext = file.originalname?.split('.').pop()?.toLowerCase();
      const mimeMap: Record<string, string> = {
        webm: 'audio/webm', mp3: 'audio/mp3', wav: 'audio/wav',
        m4a: 'audio/m4a', ogg: 'audio/ogg',
      };
      mimeType = mimeMap[ext || ''] || 'audio/webm';
    }

    try {
      const result = await this.llm.generateFromPrompt('audio-transcription', undefined, {
        userParts: [{
          inlineData: { mimeType, data: file.buffer.toString('base64') },
        }],
      });
      return result.text.trim() || '[Could not transcribe audio]';
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

  private async buildPromptParts(content: string, attachments?: Express.Multer.File[]): Promise<LlmContentPart[]> {
    const parts: LlmContentPart[] = [];

    // Add attachments first (images/PDFs)
    if (attachments) {
      for (const file of attachments) {
        if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
          parts.push({
            inlineData: {
              mimeType: file.mimetype,
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

  private async getConversationHistory(sessionId: string, excludeMessageId?: string): Promise<LlmMessage[]> {
    const messages = await this.prisma.ai_messages.findMany({
      where: {
        sessionId,
        role: { in: ['USER', 'ASSISTANT'] },
        isComplete: true,
        hasError: false,
        ...(excludeMessageId && { id: { not: excludeMessageId } }),
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });

    return messages.map((msg: any) => ({
      role: (msg.role === 'USER' ? 'user' : 'assistant') as 'user' | 'assistant',
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
    try {
      const result = await this.llm.generateFromPrompt('title-generation', {
        content: content.slice(0, 200),
      });
      return result.text.trim().slice(0, 100);
    } catch {
      return content.slice(0, 50) + (content.length > 50 ? '...' : '');
    }
  }

  private async detectSubject(messages: { content?: string }[]): Promise<string> {
    const content = messages.map(m => m.content).filter(Boolean).join(' ');
    if (!content) return 'GENERAL';

    const validSubjects = [
      'MATHEMATICS', 'PHYSICS', 'CHEMISTRY', 'BIOLOGY', 'ENGLISH',
      'HISTORY', 'GEOGRAPHY', 'COMPUTER_SCIENCE', 'ECONOMICS', 'SOCIAL', 'HUMANITIES', 'ARTS', 'ACCOUNTING', 'GENERAL',
    ];

    try {
      const result = await this.llm.generateFromPrompt('subject-detection', {
        content: content.slice(0, 500),
        validSubjects: validSubjects.join(', '),
      });
      const detected = result.text.trim().toUpperCase();
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

  // ============ AI Council Mode (GPAI-style multi-model pipeline) ============

  private async runCouncilStreaming(
    session: any,
    userContent: string,
    attachments: Express.Multer.File[] | undefined,
    emitter: EventEmitter,
  ): Promise<StreamingResponse> {
    const processedAttachments = await this.processAttachments(attachments);

    await this.prisma.ai_messages.create({
      data: {
        sessionId: session.id,
        role: 'USER',
        content: userContent || null,
        attachments: processedAttachments.length > 0 ? (processedAttachments as any) : undefined,
      },
    });

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

    const now = Date.now();
    this.activeStreams.set(streamId, {
      content: '',
      complete: false,
      startedAtMs: now,
      lastActivityAtMs: now,
      cancelled: false,
    });

    this.executeCouncil(
      session.id,
      aiMessage.id,
      streamId,
      userContent,
      session.subject,
      attachments,
      emitter,
    ).catch((error) => {
      this.logger.error(`Council error: ${error.message}`);
      emitter.emit('chunk', {
        type: 'error',
        messageId: aiMessage.id,
        sessionId: session.id,
        error: error.message,
      } as StreamChunk);
    });

    return { messageId: aiMessage.id, sessionId: session.id, emitter };
  }

  /**
   * GPAI-style council pipeline:
   *   Phase 1: Parallel analysis — each member uses its OWN model
   *   Phase 2: Cross-review — each member critiques the others
   *   Phase 3: Synthesis — strongest model weaves everything together
   *
   * Events are emitted in REAL-TIME as each member finishes (not batched).
   */
  private async executeCouncil(
    sessionId: string,
    messageId: string,
    streamId: string,
    userContent: string,
    sessionSubject: string | null,
    attachments: Express.Multer.File[] | undefined,
    emitter: EventEmitter,
  ): Promise<void> {
    const history = await this.getConversationHistory(sessionId, messageId);
    const promptParts = await this.buildPromptParts(userContent, attachments);

    this.logger.log(`[COUNCIL] Starting GPAI-style multi-model council for session ${sessionId}`);
    this.logger.log(`[COUNCIL] Models: ${COUNCIL_MEMBERS.map((m) => `${m.label}=${m.modelName}`).join(', ')}`);

    // Notify frontend that council analysis is starting
    emitter.emit('councilStatus', {
      type: 'councilAnalysisStart',
      sessionId,
      messageId,
      experts: COUNCIL_MEMBERS.map((m) => ({
        id: m.id,
        name: m.name,
        label: m.label,
        status: 'analyzing',
      })),
    });

    // ── Phase 1: Parallel analysis with DIFFERENT models ──
    const memberStartTime = Date.now();
    const memberResponses: CouncilMemberResponse[] = [];

    // Use individual promises so we can emit events as each completes (real-time)
    const memberPromises = COUNCIL_MEMBERS.map(async (member, index) => {
      this.logger.log(
        `[COUNCIL] [${member.label}] ${member.name} analyzing via ${member.modelName}...`,
      );
      try {
        const rawText = await this.callCouncilMember(member, history, promptParts, sessionSubject);
        const parsed = parseCouncilResponse(rawText);
        const elapsed = Date.now() - memberStartTime;

        this.logger.log(
          `[COUNCIL] [${member.label}] ${member.name} completed in ${elapsed}ms ` +
            `(confidence: ${parsed.confidence}, ${parsed.content.length} chars, model: ${member.modelName})`,
        );

        const response: CouncilMemberResponse = {
          memberId: member.id,
          memberName: member.name,
          memberLabel: member.label,
          content: parsed.content,
          confidence: parsed.confidence,
          keyPoints: parsed.keyPoints,
        };

        // Emit immediately when this member finishes (real-time, not batched)
        emitter.emit('councilMemberComplete', {
          memberId: member.id,
          memberName: member.name,
          memberLabel: member.label,
          content: parsed.content,
          confidence: parsed.confidence,
          index,
          total: COUNCIL_MEMBERS.length,
        });

        return response;
      } catch (error: any) {
        const elapsed = Date.now() - memberStartTime;
        this.logger.warn(
          `[COUNCIL] [${member.label}] ${member.name} failed after ${elapsed}ms (model: ${member.modelName}): ${error.message}`,
        );

        const fallback: CouncilMemberResponse = {
          memberId: member.id,
          memberName: member.name,
          memberLabel: member.label,
          content: `(${member.name} was unable to respond.)`,
          confidence: 0,
          keyPoints: [],
        };

        emitter.emit('councilMemberComplete', {
          memberId: member.id,
          memberName: member.name,
          memberLabel: member.label,
          content: fallback.content,
          confidence: 0,
          index,
          total: COUNCIL_MEMBERS.length,
        });

        return fallback;
      }
    });

    const resolvedResponses = await Promise.all(memberPromises);
    memberResponses.push(...resolvedResponses);

    // ── Phase 2: Cross-review round (GPAI debate) ──
    this.logger.log(`[COUNCIL] Phase 2: Cross-review round starting...`);
    emitter.emit('councilStatus', {
      type: 'councilCrossReviewStart',
      sessionId,
      messageId,
    });

    await this.runCrossReview(memberResponses, userContent, sessionSubject);
    this.logger.log(`[COUNCIL] Cross-review complete.`);

    // ── Phase 3: Synthesis with strongest model ──
    this.logger.log(
      `[COUNCIL] Phase 3: Synthesis via ${SYNTHESIZER_MODEL} — weaving ${memberResponses.length} perspectives...`,
    );
    emitter.emit('councilSynthesisStart', { sessionId, messageId });

    const synthesizerPrompt = this.systemInstructions.getSynthesizerPrompt(
      memberResponses,
      userContent,
    );

    await this.streamCouncilSynthesis(
      sessionId,
      messageId,
      streamId,
      synthesizerPrompt,
      memberResponses,
      userContent,
      emitter,
    );
  }

  /**
   * Call a single council member using its DEDICATED model and config.
   * Each member has its own model, temperature, and token limits.
   */
  private async callCouncilMember(
    member: CouncilMember,
    history: LlmMessage[],
    promptParts: LlmContentPart[],
    sessionSubject: string | null,
  ): Promise<string> {
    const systemPrompt = this.systemInstructions.getCouncilMemberPrompt(member, sessionSubject);

    const messages: LlmMessage[] = [
      ...history,
      { role: 'user', parts: promptParts },
    ];

    const result = await this.withTimeout(
      this.llm.generate(this.getActiveProvider(), messages, {
        model: member.modelName,
        systemPrompt,
        generationConfig: {
          temperature: member.config.temperature,
          maxOutputTokens: member.config.maxOutputTokens,
        },
      }),
      45000,
      `Council member ${member.name} (${member.modelName}) timed out`,
    );

    return result.text;
  }

  /**
   * GPAI-style cross-review: each council member reviews the other members'
   * responses and provides brief critique/corrections. This catches errors
   * and adds nuance before synthesis.
   */
  private async runCrossReview(
    memberResponses: CouncilMemberResponse[],
    userQuestion: string,
    sessionSubject: string | null,
  ): Promise<void> {
    const reviewPromises = COUNCIL_MEMBERS.map(async (member) => {
      try {
        const reviewSystemPrompt = this.systemInstructions.getCrossReviewPrompt(
          member,
          memberResponses,
          userQuestion,
        );

        const messages: LlmMessage[] = [
          { role: 'user', parts: [{ text: 'Please review the other experts\' responses.' }] },
        ];

        const result = await this.withTimeout(
          this.llm.generate(this.getActiveProvider(), messages, {
            model: member.modelName,
            systemPrompt: reviewSystemPrompt,
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: member.config.reviewMaxTokens,
            },
          }),
          20000,
          `Cross-review by ${member.name} timed out`,
        );

        const review = result.text.trim();
        const memberResponse = memberResponses.find((r) => r.memberId === member.id);
        if (memberResponse) {
          memberResponse.review = review;
        }

        this.logger.log(
          `[COUNCIL] [REVIEW] ${member.name} reviewed peers: "${review.substring(0, 80)}..."`,
        );
      } catch (error: any) {
        this.logger.warn(`[COUNCIL] [REVIEW] ${member.name} review failed: ${error.message}`);
        // Cross-review is optional — synthesis proceeds without it
      }
    });

    await Promise.allSettled(reviewPromises);
  }

  /**
   * Stream the final synthesis using the dedicated synthesizer model (strongest model).
   */
  private async streamCouncilSynthesis(
    sessionId: string,
    messageId: string,
    streamId: string,
    synthesizerSystemPrompt: string,
    memberResponses: CouncilMemberResponse[],
    userContent: string,
    emitter: EventEmitter,
  ): Promise<void> {
    this.logger.log(
      `[COUNCIL] Synthesizer model: ${SYNTHESIZER_MODEL} — weaving ${memberResponses.length} expert perspectives...`,
    );
    emitter.emit('chunk', {
      type: 'start',
      messageId,
      sessionId,
      message: 'Synthesizing perspectives...',
    } as StreamChunk);

    const messages: LlmMessage[] = [
      { role: 'user', parts: [{ text: 'Please synthesize the perspectives above into a complete answer.' }] },
    ];

    const llmStream = await this.llm.stream(this.getActiveProvider(), messages, {
      model: SYNTHESIZER_MODEL,
      systemPrompt: synthesizerSystemPrompt,
      generationConfig: {
        temperature: SYNTHESIZER_CONFIG.temperature,
        maxOutputTokens: SYNTHESIZER_CONFIG.maxOutputTokens,
      },
    });

    let fullContent = '';
    for await (const chunkText of llmStream) {
      fullContent += chunkText;

      const streamData = this.activeStreams.get(streamId);
      if (streamData) {
        streamData.content = fullContent;
        streamData.lastActivityAtMs = Date.now();
      }

      emitter.emit('chunk', {
        type: 'chunk',
        messageId,
        sessionId,
        content: chunkText,
        fullContent,
      } as StreamChunk);
    }

    // Strip metadata from council responses before persisting (clean for frontend)
    const cleanResponses = memberResponses.map((r) => ({
      memberId: r.memberId,
      memberName: r.memberName,
      memberLabel: r.memberLabel,
      content: r.content,
      confidence: r.confidence,
      keyPoints: r.keyPoints,
    }));

    await this.prisma.ai_messages.update({
      where: { id: messageId },
      data: {
        content: fullContent,
        isStreaming: false,
        isComplete: true,
        councilResponses: cleanResponses as any,
      },
    });

    const streamData = this.activeStreams.get(streamId);
    if (streamData) streamData.complete = true;

    await this.updateSessionAfterMessage(sessionId, userContent, fullContent);

    this.logger.log(
      `[COUNCIL] Synthesis complete (${fullContent.length} chars). Council response delivered.`,
    );

    emitter.emit('chunk', {
      type: 'end',
      messageId,
      sessionId,
      fullContent,
    } as StreamChunk);

    setTimeout(() => this.activeStreams.delete(streamId), 60000);
  }
}

