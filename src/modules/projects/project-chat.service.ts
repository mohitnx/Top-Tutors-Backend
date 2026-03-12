import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectsService } from './projects.service';
import { LlmService, LlmMessage, LlmContentPart } from '../llm';
import {
  CreateProjectChatSessionDto,
  SendProjectMessageDto,
  GenerateQuizDto,
  ProjectChatSessionResponse,
  ProjectMessageResponse,
  ProjectStreamChunk,
} from './dto';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';

export interface ProjectStreamingResponse {
  messageId: string;
  sessionId: string;
  projectId: string;
  emitter: EventEmitter;
}

@Injectable()
export class ProjectChatService {
  private readonly logger = new Logger(ProjectChatService.name);
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
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly llm: LlmService,
  ) {}

  // ============ Session Management ============

  async createSession(
    projectId: string,
    userId: string,
    dto: CreateProjectChatSessionDto,
  ): Promise<ProjectChatSessionResponse> {
    await this.projectsService.verifyOwnership(projectId, userId);

    const session = await this.prisma.project_chat_sessions.create({
      data: {
        projectId,
        userId,
        title: dto.title || null,
      },
    });

    return this.formatSession(session);
  }

  async getSessions(projectId: string, userId: string): Promise<ProjectChatSessionResponse[]> {
    await this.projectsService.verifyOwnership(projectId, userId);

    const sessions = await this.prisma.project_chat_sessions.findMany({
      where: { projectId, userId },
      orderBy: { lastMessageAt: 'desc' },
      include: {
        project_messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true, role: true, createdAt: true },
        },
        _count: { select: { project_messages: true } },
      },
    });

    return sessions.map((s: any) => this.formatSession(s, true));
  }

  async getSession(
    projectId: string,
    sessionId: string,
    userId: string,
  ): Promise<{
    session: ProjectChatSessionResponse;
    messages: ProjectMessageResponse[];
  }> {
    await this.projectsService.verifyOwnership(projectId, userId);

    const session = await this.prisma.project_chat_sessions.findFirst({
      where: { id: sessionId, projectId, userId },
      include: {
        project_messages: { orderBy: { createdAt: 'asc' } },
        _count: { select: { project_messages: true } },
      },
    });

    if (!session) {
      throw new NotFoundException('Chat session not found');
    }

    return {
      session: this.formatSession(session, true),
      messages: session.project_messages.map((m: any) => this.formatMessage(m)),
    };
  }

  async deleteSession(
    projectId: string,
    sessionId: string,
    userId: string,
  ): Promise<{ success: boolean }> {
    await this.projectsService.verifyOwnership(projectId, userId);

    const session = await this.prisma.project_chat_sessions.findFirst({
      where: { id: sessionId, projectId, userId },
    });

    if (!session) {
      throw new NotFoundException('Chat session not found');
    }

    await this.prisma.project_chat_sessions.delete({ where: { id: sessionId } });
    return { success: true };
  }

  // ============ Message Handling ============

  async sendMessage(
    projectId: string,
    userId: string,
    dto: SendProjectMessageDto,
    attachments?: Express.Multer.File[],
  ): Promise<ProjectStreamingResponse> {
    const project = await this.projectsService.verifyOwnership(projectId, userId);
    const emitter = new EventEmitter();

    // Get or create session
    let session: any;
    if (dto.sessionId) {
      session = await this.prisma.project_chat_sessions.findFirst({
        where: { id: dto.sessionId, projectId, userId },
      });
      if (!session) {
        throw new NotFoundException('Chat session not found');
      }
    } else {
      session = await this.prisma.project_chat_sessions.create({
        data: { projectId, userId },
      });
    }

    // Process attachments metadata
    const processedAttachments = await this.processAttachments(attachments);

    // Create user message
    const userMessage = await this.prisma.project_messages.create({
      data: {
        sessionId: session.id,
        role: 'USER',
        content: dto.content || null,
        attachments:
          processedAttachments.length > 0 ? (processedAttachments as any) : undefined,
      },
    });

    // Create placeholder AI message
    const streamId = uuidv4();
    const aiMessage = await this.prisma.project_messages.create({
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
      project,
      session.id,
      aiMessage.id,
      streamId,
      dto.content || '',
      attachments,
      emitter,
    ).catch((error) => {
      this.logger.error(`Project stream error: ${error.message}`);
      emitter.emit('chunk', {
        type: 'error',
        messageId: aiMessage.id,
        sessionId: session.id,
        projectId,
        error: error.message,
      } as ProjectStreamChunk);
    });

    return {
      messageId: aiMessage.id,
      sessionId: session.id,
      projectId,
      emitter,
    };
  }

  // ============ Quiz Generation ============

  async generateQuiz(
    projectId: string,
    userId: string,
    dto: GenerateQuizDto,
  ): Promise<ProjectStreamingResponse> {
    const project = await this.projectsService.verifyOwnership(projectId, userId);
    const resourceContext = await this.projectsService.getResourceContext(projectId);

    if (!resourceContext) {
      throw new BadRequestException('No resources uploaded to this project yet. Upload study materials first.');
    }

    const emitter = new EventEmitter();

    // Create a chat session for the quiz
    const session = await this.prisma.project_chat_sessions.create({
      data: {
        projectId,
        userId,
        title: `Quiz — ${dto.quizType || 'Mixed'} (${dto.difficulty || 'Medium'})`,
      },
    });

    // Create user message (quiz request)
    await this.prisma.project_messages.create({
      data: {
        sessionId: session.id,
        role: 'USER',
        content: `Generate a ${dto.quizType || 'MIXED'} quiz with ${dto.questionCount || 5} questions at ${dto.difficulty || 'MEDIUM'} difficulty based on my study materials.`,
      },
    });

    const streamId = uuidv4();
    const aiMessage = await this.prisma.project_messages.create({
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

    // Build quiz prompt
    const quizPrompt = this.buildQuizPrompt(dto, resourceContext);

    this.streamQuizResponse(
      project,
      session.id,
      aiMessage.id,
      streamId,
      quizPrompt,
      emitter,
    ).catch((error) => {
      this.logger.error(`Quiz generation error: ${error.message}`);
      emitter.emit('chunk', {
        type: 'error',
        messageId: aiMessage.id,
        sessionId: session.id,
        projectId,
        error: error.message,
      } as ProjectStreamChunk);
    });

    return {
      messageId: aiMessage.id,
      sessionId: session.id,
      projectId,
      emitter,
    };
  }

  // ============ Feedback ============

  async addMessageFeedback(
    projectId: string,
    messageId: string,
    userId: string,
    feedback: 'GOOD' | 'BAD',
  ): Promise<ProjectMessageResponse> {
    await this.projectsService.verifyOwnership(projectId, userId);

    const message = await this.prisma.project_messages.findFirst({
      where: { id: messageId },
      include: { project_chat_sessions: true },
    });

    if (!message || message.project_chat_sessions.projectId !== projectId) {
      throw new NotFoundException('Message not found');
    }

    const updated = await this.prisma.project_messages.update({
      where: { id: messageId },
      data: { feedback },
    });

    return this.formatMessage(updated);
  }

  // ============ Stream State ============

  async getStreamState(streamId: string): Promise<{
    content: string;
    complete: boolean;
  } | null> {
    const streamData = this.activeStreams.get(streamId);
    if (streamData) {
      return streamData;
    }

    const message = await this.prisma.project_messages.findFirst({
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

  // ============ Internal Streaming ============

  private async streamResponse(
    project: any,
    sessionId: string,
    messageId: string,
    streamId: string,
    content: string,
    attachments: Express.Multer.File[] | undefined,
    emitter: EventEmitter,
  ): Promise<void> {
    const heartbeatIntervalMs = 5000;
    let heartbeatTimer: NodeJS.Timeout | null = null;

    try {
      const modelName = await this.getWorkingModelName();
      const systemPrompt = this.buildProjectSystemPrompt(project);
      const resolved = this.llm.resolvePrompt('project-chat');
      const genConfig = {
        ...resolved.generationConfig,
        temperature: project.aiTemperature ?? resolved.generationConfig.temperature ?? 0.5,
      };

      // Get conversation history
      const history = await this.getConversationHistory(sessionId, messageId);

      // Get resource context for this project
      const resourceContext = await this.projectsService.getResourceContext(project.id);

      // Build prompt parts
      const promptParts = await this.buildPromptParts(content, attachments, resourceContext);

      // Emit start
      emitter.emit('chunk', {
        type: 'start',
        messageId,
        sessionId,
        projectId: project.id,
        message: 'Started generating response',
      } as ProjectStreamChunk);

      // Generate streaming response via LlmService
      const messages: LlmMessage[] = [
        ...history,
        { role: 'user', parts: promptParts },
      ];

      const llmStream = await this.llm.stream(this.llm.getDefaultProvider(), messages, {
        model: modelName,
        systemPrompt,
        generationConfig: genConfig,
      });

      let fullContent = '';

      // Heartbeat
      heartbeatTimer = setInterval(() => {
        const streamData = this.activeStreams.get(streamId);
        if (!streamData || streamData.complete || streamData.cancelled) return;

        const now = Date.now();
        const waitingMs = now - streamData.lastActivityAtMs;
        emitter.emit('chunk', {
          type: 'heartbeat',
          messageId,
          sessionId,
          projectId: project.id,
          fullContent: streamData.content,
          waitingMs,
          message:
            waitingMs > 30000
              ? 'Still working… this is taking longer than usual'
              : 'Still working…',
        } as ProjectStreamChunk);
      }, heartbeatIntervalMs);

      // Iterate stream using provider-agnostic async iterator
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
          projectId: project.id,
          content: chunkText,
          fullContent,
        } as ProjectStreamChunk);
      }

      // Get usage stats from the completed stream
      const response = await llmStream.getResponse();

      // Update message in database
      await this.prisma.project_messages.update({
        where: { id: messageId },
        data: {
          content: fullContent,
          isStreaming: false,
          isComplete: true,
          promptTokens: response.usage?.promptTokens,
          completionTokens: response.usage?.completionTokens,
        },
      });

      const streamData = this.activeStreams.get(streamId);
      if (streamData) streamData.complete = true;

      // Update session
      await this.updateSessionAfterMessage(sessionId, content);

      // Emit end
      emitter.emit('chunk', {
        type: 'end',
        messageId,
        sessionId,
        projectId: project.id,
        fullContent,
        usage: {
          promptTokens: response.usage?.promptTokens || 0,
          completionTokens: response.usage?.completionTokens || 0,
        },
      } as ProjectStreamChunk);

      // Cleanup
      setTimeout(() => this.activeStreams.delete(streamId), 60000);
    } catch (error: any) {
      this.logger.error(`Project streaming error: ${error.message}`);

      const streamData = this.activeStreams.get(streamId);
      if (streamData) streamData.cancelled = true;

      await this.prisma.project_messages.update({
        where: { id: messageId },
        data: {
          isStreaming: false,
          isComplete: false,
          hasError: true,
          errorMessage: error.message,
        },
      });

      emitter.emit('chunk', {
        type: 'error',
        messageId,
        sessionId,
        projectId: project.id,
        error: error.message,
        message: 'Failed to generate response',
      } as ProjectStreamChunk);
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    }
  }

  private async streamQuizResponse(
    project: any,
    sessionId: string,
    messageId: string,
    streamId: string,
    quizPrompt: string,
    emitter: EventEmitter,
  ): Promise<void> {
    // Reuse streamResponse logic with quiz prompt as the content
    return this.streamResponse(
      project,
      sessionId,
      messageId,
      streamId,
      quizPrompt,
      undefined,
      emitter,
    );
  }

  // ============ Helpers ============

  private async getWorkingModelName(): Promise<string> {
    if (this.workingModelName) return this.workingModelName;

    const resolved = this.llm.resolvePrompt('project-chat');

    for (const modelName of resolved.models) {
      try {
        const testResult = await this.llm.generate(
          this.llm.getDefaultProvider(),
          [{ role: 'user', parts: [{ text: 'Hi' }] }],
          { model: modelName },
        );
        if (testResult.text) {
          this.workingModelName = modelName;
          this.logger.log(`Project Chat: Using model ${modelName} (provider: ${this.llm.getDefaultProvider()})`);
          return modelName;
        }
      } catch (error: any) {
        this.logger.warn(`Project Chat: Model ${modelName} failed: ${error.message}`);
        continue;
      }
    }

    throw new InternalServerErrorException('No working LLM model found for project chat');
  }

  private buildProjectSystemPrompt(project: any): string {
    const resolved = this.llm.resolvePrompt('project-chat', {
      title: project.title,
      description: project.description ? `Description: ${project.description}` : '',
      aiSystemPrompt: project.aiSystemPrompt
        ? `Student's custom instructions for you:\n${project.aiSystemPrompt}`
        : '',
    });

    return resolved.systemPrompt!;
  }

  private buildQuizPrompt(dto: GenerateQuizDto, resourceContext: string): string {
    const resolved = this.llm.resolvePrompt('quiz-generation', {
      questionCount: String(dto.questionCount || 5),
      quizType: dto.quizType || 'MIXED',
      difficulty: dto.difficulty || 'MEDIUM',
      resourceContext,
    });
    return resolved.userPrompt!;
  }

  private async buildPromptParts(
    content: string,
    attachments?: Express.Multer.File[],
    resourceContext?: string,
  ): Promise<LlmContentPart[]> {
    const parts: LlmContentPart[] = [];

    // Add resource context as first part if available
    if (resourceContext) {
      parts.push({
        text: `[Study Materials Context]\n${resourceContext}\n[End of Study Materials]\n\n`,
      });
    }

    // Add inline attachments (images/PDFs sent with the message)
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

  private async getConversationHistory(
    sessionId: string,
    excludeMessageId?: string,
  ): Promise<LlmMessage[]> {
    const messages = await this.prisma.project_messages.findMany({
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

  private async updateSessionAfterMessage(sessionId: string, userContent: string): Promise<void> {
    const session = await this.prisma.project_chat_sessions.findUnique({
      where: { id: sessionId },
    });

    const updates: any = { lastMessageAt: new Date() };

    if (session && !session.title && userContent) {
      updates.title = await this.generateTitle(userContent);
    }

    await this.prisma.project_chat_sessions.update({
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

  private async processAttachments(files?: Express.Multer.File[]): Promise<any[]> {
    if (!files || files.length === 0) return [];

    return files.map((file) => ({
      url: `/uploads/${file.mimetype.startsWith('image/') ? 'images' : 'documents'}/${uuidv4()}.${file.originalname?.split('.').pop() || 'bin'}`,
      name: file.originalname || 'file',
      type: file.mimetype.startsWith('image/') ? 'image' : 'document',
      size: file.size,
      mimeType: file.mimetype,
    }));
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

  private formatSession(session: any, includeLastMessage = false): ProjectChatSessionResponse {
    const result: ProjectChatSessionResponse = {
      id: session.id,
      projectId: session.projectId,
      title: session.title,
      lastMessageAt: session.lastMessageAt,
      createdAt: session.createdAt,
    };

    if (session._count) {
      result.messageCount = session._count.project_messages;
    }

    if (includeLastMessage && session.project_messages?.[0]) {
      result.lastMessage = {
        content: session.project_messages[0].content,
        role: session.project_messages[0].role,
        createdAt: session.project_messages[0].createdAt,
      };
    }

    return result;
  }

  private formatMessage(message: any): ProjectMessageResponse {
    return {
      id: message.id,
      sessionId: message.sessionId,
      role: message.role,
      content: message.content,
      attachments: message.attachments,
      isStreaming: message.isStreaming,
      isComplete: message.isComplete,
      hasError: message.hasError,
      errorMessage: message.errorMessage,
      feedback: message.feedback,
      createdAt: message.createdAt,
    };
  }
}
