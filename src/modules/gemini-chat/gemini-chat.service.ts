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
import { ProjectsService } from '../projects/projects.service';
import { ProjectChatService } from '../projects/project-chat.service';
import {
  DEMO_STUDENT_REPORT,
  DEMO_TEACHER_REPORT,
  DEMO_ADMIN_REPORT,
} from '../projects/sap-templates';
import { StorageService } from '../storage/storage.service';
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
  /** Audio URL for audio messages (so frontend can play back what the user said) */
  audioUrl?: string;
  /** Transcription text for audio messages */
  transcription?: string;
}

@Injectable()
export class GeminiChatService {
  private readonly logger = new Logger(GeminiChatService.name);

  // Track active streams for reconnection
  private activeStreams: Map<
    string,
    {
      content: string;
      complete: boolean;
      startedAtMs: number;
      lastActivityAtMs: number;
      cancelled?: boolean;
      // Extended state for reconnection
      messageId: string;
      sessionId: string;
      mode?: StreamChunk['mode'];
      thinkingTrace: string[];
      provider?: string;
    }
  > = new Map();

  // Temporary in-memory PDF cache for SAP reports (auto-expires after 30 min)
  private pdfCache: Map<string, { buffer: Buffer; filename: string; expiresAt: number }> = new Map();


  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly systemInstructions: SystemInstructionsService,
    private readonly promptService: PromptService,
    private readonly llm: LlmService,
    private readonly projectsService: ProjectsService,
    private readonly storage: StorageService,
    private readonly projectChatService: ProjectChatService,
  ) {}

  /**
   * Select the best provider for a given task.
   * - Normal chat / Deep Think → anthropic (paid, best reasoning) → vertex → gemini (free)
   * - Deep Research → vertex (paid Gemini with Google Search) → gemini → anthropic
   * - Council → uses the default provider priority
   */
  private getProviderForTask(task: 'chat' | 'deep-think' | 'deep-research' | 'council'): LlmProvider {
    if (task === 'deep-research') {
      // Prefer Gemini-family for deep research (native Google Search grounding)
      if (this.llm.isProviderAvailable('vertex')) return 'vertex';
      if (this.llm.isProviderAvailable('gemini')) return 'gemini';
      if (this.llm.isProviderAvailable('anthropic')) return 'anthropic';
    } else if (task === 'council') {
      // Council members use Gemini-specific model names — must use Gemini-family provider
      if (this.llm.isProviderAvailable('vertex')) return 'vertex';
      if (this.llm.isProviderAvailable('gemini')) return 'gemini';
      // Anthropic/OpenAI can't use gemini-2.5-pro model names
      return this.llm.getDefaultProvider();
    } else if (task === 'deep-think') {
      // Prefer Gemini Pro for deep thinking (native thinking mode, produces visibly deeper responses)
      if (this.llm.isProviderAvailable('vertex')) return 'vertex';
      if (this.llm.isProviderAvailable('gemini')) return 'gemini';
      if (this.llm.isProviderAvailable('anthropic')) return 'anthropic';
    } else if (task === 'chat') {
      // Prefer Anthropic for regular chat (best conversational quality)
      if (this.llm.isProviderAvailable('anthropic')) return 'anthropic';
      if (this.llm.isProviderAvailable('vertex')) return 'vertex';
      if (this.llm.isProviderAvailable('gemini')) return 'gemini';
    }
    return this.llm.getDefaultProvider();
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

    // Get or create session
    let session: any;
    if (dto.sessionId) {
      session = await this.prisma.ai_chat_sessions.findFirst({
        where: { id: dto.sessionId, userId },
      });
      if (!session) {
        throw new NotFoundException('Session not found');
      }
      // Link existing session to project if projectId is newly provided
      if (dto.projectId && !session.projectId) {
        session = await this.prisma.ai_chat_sessions.update({
          where: { id: session.id },
          data: { projectId: dto.projectId },
        });
      }
    } else {
      session = await this.prisma.ai_chat_sessions.create({
        data: {
          userId,
          ...(dto.projectId && { projectId: dto.projectId }),
        },
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

      // Select prompt and provider based on deep mode flags
      const task = dto.deepThink ? 'deep-think' : dto.deepResearch ? 'deep-research' : 'chat';
      const promptId = task === 'deep-think'
        ? 'deep-think' as const
        : task === 'deep-research'
          ? 'deep-research' as const
          : 'tutor-chat-single' as const;

      let provider = this.getProviderForTask(task);
      const resolved = this.llm.resolvePrompt(promptId, undefined, provider);
      let systemPrompt = resolved.systemPrompt || '';

      this.logger.log(`[${task}] Using provider: ${provider}, models: [${resolved.models.join(', ')}]`);

      // Inject project context if projectId is provided
      let projectTemperature: number | undefined;
      let isSap = false;
      if (dto.projectId) {
        const project = await this.projectsService.verifyOwnership(dto.projectId, userId);
        isSap = this.isSapProject(project);

        // Inject custom AI system prompt / persona
        if (project.aiSystemPrompt) {
          systemPrompt += `\n\n[Project Persona Instructions]\n${project.aiSystemPrompt}`;
        }
        if (project.title) {
          systemPrompt += `\n\n[Project: "${project.title}"]`;
        }

        // SAP-specific system instructions — always inject when SAP project is attached
        if (isSap) {
          const hasFiles = attachments?.some(f => f.mimetype.startsWith('image/') || f.mimetype === 'application/pdf') || false;
          systemPrompt += this.getSapSystemInstructions(hasFiles);
        }

        // Inject study materials context
        const projectContext = await this.projectsService.getResourceContext(dto.projectId);
        if (projectContext) {
          const truncated = projectContext.length > 50000
            ? projectContext.slice(0, 50000) + '\n\n[Study materials truncated due to length...]'
            : projectContext;
          systemPrompt += `\n\n[Study Materials from Project]\n${truncated}`;
        }

        projectTemperature = project.aiTemperature;
      }

      // SAP: always flag — the LLM decides whether to generate a report
      const isSapReport = isSap;
      const sapHasFiles = isSap && (attachments?.some(f => f.mimetype.startsWith('image/') || f.mimetype === 'application/pdf') || false);

      const messages: LlmMessage[] = [
        ...history,
        { role: 'user', parts: promptParts },
      ];

      // Generate response with automatic fallback across providers (web search enabled)
      const genConfig = { ...resolved.generationConfig };
      if (projectTemperature !== undefined) genConfig.temperature = projectTemperature;
      // SAP: use best models + more output tokens
      let activeModels = resolved.models;
      if (isSap) {
        genConfig.maxOutputTokens = 16384;
        if (this.llm.isProviderAvailable('anthropic')) {
          activeModels = ['claude-opus-4-6', 'claude-sonnet-4-20250514'];
          provider = 'anthropic';
          delete genConfig.topP;
        }
      }
      const result = await this.llm.generateWithFallback(messages, {
        systemPrompt: systemPrompt || undefined,
        generationConfig: genConfig,
        models: activeModels,
        provider,
        webSearch: true,
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

      // SAP Report: auto-generate PDF and upload to GCS
      let reportDownload: StreamChunk['reportDownload'] | undefined;
      const isActualReport = isSapReport && responseText && dto.projectId &&
        (sapHasFiles ? responseText.length > 50 : this.looksLikeReport(responseText));
      if (isActualReport) {
        try {
          const reportMarkdown = this.stripPreamble(responseText);
          const pdfBuffer = await this.projectChatService.renderMarkdownToPdf(reportMarkdown, 'SAP');
          const dateStr = new Date().toISOString().slice(0, 10);
          const filename = `SAP-Report-${dateStr}.pdf`;

          try {
            const gcsKey = `sap-reports/${dto.projectId}/${aiMessage.id}/${filename}`;
            const downloadUrl = await this.storage.uploadBuffer(gcsKey, pdfBuffer, 'application/pdf');
            reportDownload = { downloadUrl, filename, messageId: aiMessage.id };
            this.logger.log(`SAP report PDF uploaded to GCS: ${gcsKey}`);
          } catch (uploadError: any) {
            this.logger.warn(`GCS upload failed, serving from backend cache: ${uploadError.message}`);
            const cacheKey = this.cachePdf(pdfBuffer, filename);
            const downloadUrl = `/api/v1/gemini-chat/sap-report/${cacheKey}/download`;
            reportDownload = { downloadUrl, filename, messageId: aiMessage.id };
          }
        } catch (pdfError: any) {
          this.logger.error(`Failed to generate SAP report PDF: ${pdfError.message}`);
        }
      }

      // For SAP reports: replace chat content with brief message (full report is in DB + PDF)
      if (isActualReport && reportDownload) {
        await this.prisma.ai_messages.update({
          where: { id: aiMessage.id },
          data: { content: 'Your SAP report has been generated. Download it using the button below.' },
        });
        aiMessage.content = 'Your SAP report has been generated. Download it using the button below.';
      }

      // Update session
      const chatContent = isActualReport && reportDownload
        ? 'Your SAP report has been generated. Download it using the button below.'
        : responseText;
      await this.updateSessionAfterMessage(session.id, dto.content || '', chatContent);

      const updatedSession = await this.prisma.ai_chat_sessions.findUnique({
        where: { id: session.id },
      });

      this.logger.log(`Returning response with session ID: ${updatedSession?.id}`);

      return {
        userMessage: this.formatMessage(userMessage),
        aiMessage: this.formatMessage(aiMessage),
        session: this.formatSession(updatedSession),
        ...(reportDownload && { reportDownload }),
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
    this.logger.log(`[SAP-DEBUG] sendMessageStreaming called — projectId=${dto.projectId}, hasAttachments=${!!attachments?.length}, attachmentCount=${attachments?.length || 0}, imageCount=${attachments?.filter(f => f.mimetype.startsWith('image/')).length || 0}`);
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
      // Link existing session to project if projectId is newly provided
      if (dto.projectId && !session.projectId) {
        session = await this.prisma.ai_chat_sessions.update({
          where: { id: session.id },
          data: { projectId: dto.projectId },
        });
      }
    } else {
      session = await this.prisma.ai_chat_sessions.create({
        data: {
          userId,
          ...(dto.projectId && { projectId: dto.projectId }),
        },
      });
    }

    // Route to council mode if requested per-message OR set on session,
    // BUT deep think / deep research flags take priority over council.
    const wantsCouncil = dto.council === true || session.mode === 'COUNCIL';
    const wantsDeep = dto.deepThink === true || dto.deepResearch === true;

    if (wantsCouncil && !wantsDeep) {
      this.logger.log(`[MODE] Council mode for session ${session.id} — routing to multi-expert pipeline`);
      return this.runCouncilStreaming(session, dto.content || '', attachments, emitter);
    }
    this.logger.log(
      `[MODE] Single AI mode for session ${session.id}` +
      (dto.deepThink ? ' (deep think)' : dto.deepResearch ? ' (deep research)' : ''),
    );

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
    const mode: StreamChunk['mode'] = dto.deepThink
      ? 'deep-think'
      : dto.deepResearch
        ? 'deep-research'
        : 'single';
    this.activeStreams.set(streamId, {
      content: '',
      complete: false,
      startedAtMs: now,
      lastActivityAtMs: now,
      cancelled: false,
      messageId: aiMessage.id,
      sessionId: session.id,
      mode,
      thinkingTrace: [],
      provider: undefined, // set once provider is resolved in streamResponse
    });

    // Start streaming in background
    this.streamResponse(
      session.id,
      aiMessage.id,
      streamId,
      dto.content || '',
      attachments,
      emitter,
      {
        deepThink: dto.deepThink,
        deepResearch: dto.deepResearch,
        projectId: dto.projectId,
        userId,
      },
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
    options?: {
      deepThink?: boolean;
      deepResearch?: boolean;
      projectId?: string;
      userId?: string;
    },
  ): Promise<void> {
    const heartbeatIntervalMs =
      Number(this.configService.get<string>('GEMINI_STREAM_HEARTBEAT_MS')) || 5000;
    const idleTimeoutMs =
      Number(this.configService.get<string>('GEMINI_STREAM_IDLE_TIMEOUT_MS')) || 45000;
    const totalTimeoutMs =
      Number(this.configService.get<string>('GEMINI_STREAM_TOTAL_TIMEOUT_MS')) || 6 * 60 * 1000;

    let heartbeatTimer: NodeJS.Timeout | null = null;

    try {
      // Select prompt and provider based on task type
      const task = options?.deepThink ? 'deep-think' : options?.deepResearch ? 'deep-research' : 'chat';
      const promptId = task === 'deep-think'
        ? 'deep-think' as const
        : task === 'deep-research'
          ? 'deep-research' as const
          : 'tutor-chat-single' as const;

      let provider = this.getProviderForTask(task);
      const resolved = this.llm.resolvePrompt(promptId, undefined, provider);
      let systemPrompt = resolved.systemPrompt || '';

      // Update activeStream with resolved provider
      const activeSD = this.activeStreams.get(streamId);
      if (activeSD) activeSD.provider = provider;

      this.logger.log(`[${task}] Using provider: ${provider}, models: [${resolved.models.join(', ')}]`);

      // Inject project context if projectId is provided
      let isSap = false;
      if (options?.projectId && options?.userId) {
        const project = await this.projectsService.verifyOwnership(options.projectId, options.userId);
        isSap = this.isSapProject(project);

        // Inject custom AI system prompt / persona
        if (project.aiSystemPrompt) {
          systemPrompt += `\n\n[Project Persona Instructions]\n${project.aiSystemPrompt}`;
        }
        if (project.title) {
          systemPrompt += `\n\n[Project: "${project.title}"]`;
        }

        // SAP-specific system instructions — always inject when SAP project is attached
        if (isSap) {
          const hasFiles = attachments?.some(f => f.mimetype.startsWith('image/') || f.mimetype === 'application/pdf') || false;
          systemPrompt += this.getSapSystemInstructions(hasFiles);
        }

        // Inject study materials context
        const projectContext = await this.projectsService.getResourceContext(options.projectId);
        if (projectContext) {
          const truncated = projectContext.length > 50000
            ? projectContext.slice(0, 50000) + '\n\n[Study materials truncated due to length...]'
            : projectContext;
          systemPrompt += `\n\n[Study Materials from Project]\n${truncated}`;
        }

        // Apply project's AI temperature
        if (project.aiTemperature !== undefined && resolved.generationConfig) {
          resolved.generationConfig.temperature = project.aiTemperature;
        }

        // SAP: use best models + more output tokens
        if (isSap) {
          if (resolved.generationConfig) {
            resolved.generationConfig.maxOutputTokens = 16384;
          }
          // Override to best available models for SAP report generation
          if (this.llm.isProviderAvailable('anthropic')) {
            resolved.models = ['claude-opus-4-6', 'claude-sonnet-4-20250514'];
            provider = 'anthropic';
            // Anthropic can't have both temperature and topP — drop topP
            if (resolved.generationConfig?.topP !== undefined) {
              delete resolved.generationConfig.topP;
            }
          }
        }
      }

      // Get conversation history + build prompt
      const history = await this.getConversationHistory(sessionId, messageId);
      const promptParts = await this.buildPromptParts(content, attachments);

      // Guard: ensure we have something to send to the LLM
      if (promptParts.length === 0) {
        promptParts.push({ text: '(continue)' });
      }

      // SAP: always flag SAP projects — the LLM decides whether to generate a report
      const isSapReport = isSap;
      const sapHasFiles = isSap && (attachments?.some(f => f.mimetype.startsWith('image/') || f.mimetype === 'application/pdf') || false);

      // ── Mode detection & thinking trace ──
      const mode: StreamChunk['mode'] = options?.deepThink
        ? 'deep-think'
        : options?.deepResearch
          ? 'deep-research'
          : 'single';
      const thinkingTrace: string[] = [];

      // Flag: once real content chunks start, stop emitting fake status phases
      let streamingStarted = false;

      /** Helper: emit a status chunk with an accumulated thinking trace */
      const emitStatus = (message: string) => {
        if (streamingStarted) return; // don't emit status after content has started
        thinkingTrace.push(message);
        // Keep activeStream in sync for reconnection
        const sd = this.activeStreams.get(streamId);
        if (sd) sd.thinkingTrace = [...thinkingTrace];
        emitter.emit('chunk', {
          type: 'status',
          messageId,
          sessionId,
          mode,
          message,
          thinkingTrace: [...thinkingTrace],
          provider,
        } as StreamChunk);
      };

      /** Helper: schedule a status emission only if stream hasn't started yet */
      const scheduleStatus = (delay: number, message: string) => {
        setTimeout(() => {
          const sd = this.activeStreams.get(streamId);
          if (sd && !sd.complete && !sd.cancelled && !streamingStarted) {
            emitStatus(message);
          }
        }, delay);
      };

      /** Called once when the first real content chunk arrives — closes the thinking phase */
      const finalizeThinkingTrace = () => {
        if (streamingStarted) return;
        streamingStarted = true;
        // Add a final closing entry so the trace has a clean ending
        const closingMsg = options?.deepThink
          ? 'Analysis complete — delivering answer...'
          : options?.deepResearch
            ? 'Research complete — delivering answer...'
            : 'Delivering answer...';
        thinkingTrace.push(closingMsg);
        const sd = this.activeStreams.get(streamId);
        if (sd) sd.thinkingTrace = [...thinkingTrace];
        emitter.emit('chunk', {
          type: 'status',
          messageId,
          sessionId,
          mode,
          message: closingMsg,
          thinkingTrace: [...thinkingTrace],
          provider,
        } as StreamChunk);
      };

      // Emit start (include streamId so frontend can cancel)
      emitter.emit('chunk', {
        type: 'start',
        messageId,
        sessionId,
        streamId,
        mode,
        provider,
        message: options?.deepThink
          ? 'Starting deep analysis...'
          : options?.deepResearch
            ? 'Starting deep research...'
            : 'Started generating response',
      } as StreamChunk);

      // Generate question-specific insight phases
      const insights = this.generateInsightPhases(content, mode);

      // ── Deep Think phases — front-load insights before the LLM call ──
      if (options?.deepThink) {
        emitStatus(insights[0]);
        // Rapid-fire first 3 insights before LLM call even starts
        for (let i = 1; i < Math.min(insights.length, 3); i++) {
          scheduleStatus(1200 * i, insights[i]);
        }
        // Remaining insights spaced out during LLM processing
        for (let i = 3; i < insights.length; i++) {
          scheduleStatus(3000 + (i - 3) * 2500, insights[i]);
        }
      }

      // ── Deep Research phases ──
      if (options?.deepResearch) {
        emitStatus(insights[0]);
        for (let i = 1; i < Math.min(insights.length, 3); i++) {
          scheduleStatus(1000 * i, insights[i]);
        }
        for (let i = 3; i < insights.length; i++) {
          scheduleStatus(2500 + (i - 3) * 2500, insights[i]);
        }
      }

      // ── Normal single mode phases ──
      if (!options?.deepThink && !options?.deepResearch) {
        emitStatus(insights[0]);
        for (let i = 1; i < insights.length; i++) {
          scheduleStatus(2000 + (i - 1) * 3000, insights[i]);
        }
      }

      // Deep Think: deliberate pause to let insight phases show before streaming begins
      // This creates the "thinking" feel — the user sees analysis phases for ~3s first
      if (options?.deepThink) {
        await new Promise((resolve) => setTimeout(resolve, 3500));
      }

      // Stream via LlmService with automatic provider/model fallback
      const llmStream = await this.llm.streamWithFallback(
        [...history, { role: 'user', parts: promptParts }],
        {
          systemPrompt: systemPrompt || undefined,
          generationConfig: resolved.generationConfig,
          models: resolved.models,
          provider,
          webSearch: true,
          // Deep Think: allocate thinking tokens for chain-of-thought reasoning
          ...(options?.deepThink && { thinkingBudget: 10000 }),
          // Deep Research: allow more web searches (8 instead of default 3)
          ...(options?.deepResearch && { maxWebSearches: 8 }),
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
        const isStalled = waitingMs > 30000; // 30s no content = stalled

        emitter.emit('chunk', {
          type: 'heartbeat',
          messageId,
          sessionId,
          fullContent: streamData.content,
          waitingMs,
          stalled: isStalled || undefined,
          message: isStalled
            ? 'Taking longer than expected… you can retry if needed'
            : 'Still working…',
        } as StreamChunk);
      }, heartbeatIntervalMs);

      // Iterate the provider-agnostic stream with timeout
      let wasCancelled = false;
      for await (const chunkText of llmStream) {
        // Check if user cancelled
        const sd = this.activeStreams.get(streamId);
        if (sd?.cancelled) {
          wasCancelled = true;
          this.logger.log(`Stream ${streamId} breaking due to cancellation`);
          break;
        }

        const elapsedMs = Date.now() - startedAtMs;
        if (elapsedMs > totalTimeoutMs) {
          throw new Error('Generation timed out (took too long)');
        }

        // Idle timeout — no new content for 90 seconds
        if (sd && (Date.now() - sd.lastActivityAtMs > idleTimeoutMs) && fullContent.length > 0) {
          throw new Error('Stream stalled — no new content received');
        }

        // First real chunk: close the thinking trace so no more fake phases appear
        finalizeThinkingTrace();

        fullContent += chunkText;

        // Update stream tracking
        if (sd) {
          sd.content = fullContent;
          sd.lastActivityAtMs = Date.now();
        }

        // SAP: suppress content chunks — PDF will be generated at the end
        // Non-SAP: stream content normally
        if (!isSapReport) {
          emitter.emit('chunk', {
            type: 'chunk',
            messageId,
            sessionId,
            content: chunkText,
            fullContent,
          } as StreamChunk);
        }
      }

      // Get final response for usage stats (may fail if cancelled mid-stream)
      let usageMetadata: any;
      try {
        const finalResult = await llmStream.getResponse();
        usageMetadata = finalResult.usage;
      } catch {
        usageMetadata = {};
      }

      // SAP report handling — detailed logging for debugging
      let reportDownload: StreamChunk['reportDownload'] | undefined;
      if (isSapReport) {
        this.logger.log(`[SAP-DEBUG] isSapReport=${isSapReport}, sapHasFiles=${sapHasFiles}, wasCancelled=${wasCancelled}, projectId=${options?.projectId}, contentLength=${fullContent.length}`);
      }
      // SAP + images = ALWAYS generate PDF. No exceptions. No threshold.
      const isActualReport = !wasCancelled && isSapReport && options?.projectId &&
        (sapHasFiles ? fullContent.length > 50 : this.looksLikeReport(fullContent));
      if (isSapReport) {
        this.logger.log(`[SAP-DEBUG] isActualReport=${isActualReport}`);
      }

      // SAP: if content was suppressed but it's NOT a report, emit the full content now
      if (isSapReport && !isActualReport && !wasCancelled) {
        emitter.emit('chunk', {
          type: 'chunk',
          messageId,
          sessionId,
          content: fullContent,
          fullContent,
        } as StreamChunk);
      }

      // Re-check cancel flag before PDF generation (user may have cancelled while LLM was streaming)
      const cancelledDuringStream = this.activeStreams.get(streamId)?.cancelled;
      if (cancelledDuringStream) {
        wasCancelled = true;
      }

      if (isActualReport && !wasCancelled) {
        emitter.emit('chunk', {
          type: 'status',
          messageId,
          sessionId,
          mode,
          message: 'Creating PDF...',
          thinkingTrace: [...thinkingTrace],
        } as StreamChunk);

        // Check cancel again after PDF render
        try {
          const reportMarkdown = this.stripPreamble(fullContent);
          const pdfBuffer = await this.projectChatService.renderMarkdownToPdf(reportMarkdown, 'SAP');

          if (this.activeStreams.get(streamId)?.cancelled) {
            wasCancelled = true;
            this.logger.log(`Stream ${streamId} cancelled during PDF generation`);
          } else {
            const dateStr = new Date().toISOString().slice(0, 10);
            const filename = `SAP-Report-${dateStr}.pdf`;

            try {
              const gcsKey = `sap-reports/${options.projectId}/${messageId}/${filename}`;
              const downloadUrl = await this.storage.uploadBuffer(gcsKey, pdfBuffer, 'application/pdf');
              reportDownload = { downloadUrl, filename, messageId };
              this.logger.log(`SAP report PDF uploaded to GCS: ${gcsKey}`);
            } catch (uploadError: any) {
              this.logger.warn(`GCS upload failed, serving from backend cache: ${uploadError.message}`);
              const cacheKey = this.cachePdf(pdfBuffer, filename);
              const downloadUrl = `/api/v1/gemini-chat/sap-report/${cacheKey}/download`;
              reportDownload = { downloadUrl, filename, messageId };
            }
          }
        } catch (pdfError: any) {
          this.logger.error(`Failed to generate SAP report PDF: ${pdfError.message}`);
        }
      }

      if (isSapReport) {
        this.logger.log(`[SAP-DEBUG] reportDownload=${!!reportDownload}, chatContent will be: ${isActualReport ? (reportDownload ? 'DOWNLOAD_BUTTON' : 'PDF_FAILED_FALLBACK') : 'FULL_TEXT'}`);
      }

      // Content for chat display
      const chatContent = wasCancelled
        ? (fullContent || 'Generation was cancelled.')
        : isActualReport
          ? (reportDownload
            ? 'Your SAP report has been generated. Download it using the button below.'
            : 'Your SAP report has been generated but PDF creation failed. Here is the report:\n\n' + fullContent)
          : fullContent;

      // Update message in database
      await this.prisma.ai_messages.update({
        where: { id: messageId },
        data: {
          content: fullContent || 'Generation was cancelled.',
          isStreaming: false,
          isComplete: !wasCancelled,
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
      await this.updateSessionAfterMessage(sessionId, content, chatContent);

      // Emit end chunk
      emitter.emit('chunk', {
        type: 'end',
        messageId,
        sessionId,
        mode,
        provider,
        fullContent: chatContent,
        thinkingTrace: [...thinkingTrace],
        cancelled: wasCancelled || undefined,
        usage: {
          promptTokens: usageMetadata?.promptTokens || 0,
          completionTokens: usageMetadata?.completionTokens || 0,
        },
        ...(reportDownload && { reportDownload }),
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

      // Update message with error — wrapped in its own try/catch so the error
      // chunk always reaches the frontend even if the DB write fails
      try {
        await this.prisma.ai_messages.update({
          where: { id: messageId },
          data: {
            isStreaming: false,
            isComplete: false,
            hasError: true,
            errorMessage: error.message?.substring(0, 1000),
          },
        });
      } catch (dbError: any) {
        this.logger.error(`Failed to persist error state for message ${messageId}: ${dbError.message}`);
      }

      // Always emit error to frontend
      emitter.emit('chunk', {
        type: 'error',
        messageId,
        sessionId,
        error: error.message,
        message: 'Failed to generate response. Please try again.',
      } as StreamChunk);
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
      // Prevent memory leaks — remove all listeners after streaming
      emitter.removeAllListeners();
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

  // ═══════════════════════════════════════════════════════════
  // Insight Phase Generation
  // ═══════════════════════════════════════════════════════════

  /**
   * Generate question-specific insight messages for the thinking trace.
   * Extracts keywords/topics from the question and builds contextual phases.
   * Always returns at least 3 insights, up to 7 for deep modes.
   */
  private generateInsightPhases(
    content: string,
    mode: 'deep-think' | 'deep-research' | 'single' | 'council',
  ): string[] {
    const topic = this.extractTopic(content);
    const keywords = this.extractKeywords(content);
    const questionType = this.classifyQuestion(content);

    if (mode === 'deep-think') {
      return this.buildDeepThinkInsights(topic, keywords, questionType);
    } else if (mode === 'deep-research') {
      return this.buildDeepResearchInsights(topic, keywords);
    } else {
      return this.buildNormalInsights(topic, keywords);
    }
  }

  private buildDeepThinkInsights(
    topic: string,
    keywords: string[],
    questionType: string,
  ): string[] {
    const insights: string[] = [];
    const t = topic || 'the question';

    // 1. Always start with understanding
    insights.push(`Analyzing ${t} — identifying core concepts...`);

    // 2. Question-type-aware reasoning
    if (questionType === 'how') {
      insights.push(`Breaking down the process step by step...`);
      insights.push(`Checking for common mistakes when approaching ${t}...`);
    } else if (questionType === 'why') {
      insights.push(`Examining underlying causes and mechanisms...`);
      insights.push(`Considering whether the conventional explanation holds up...`);
    } else if (questionType === 'compare') {
      insights.push(`Identifying key differences and similarities...`);
      insights.push(`Evaluating which factors matter most for ${t}...`);
    } else if (questionType === 'solve') {
      insights.push(`Working through the problem from first principles...`);
      insights.push(`Verifying the solution using an alternative method...`);
    } else {
      insights.push(`Exploring what most explanations of ${t} get wrong...`);
      insights.push(`Connecting ${t} to related concepts for deeper understanding...`);
    }

    // 3. Keyword-specific insights (only if we have meaningful keywords)
    if (keywords.length >= 2) {
      insights.push(`Analyzing the relationship between "${keywords[0]}" and "${keywords[1]}"...`);
    } else if (keywords.length === 1) {
      insights.push(`Looking deeper into "${keywords[0]}" — what's often overlooked...`);
    }

    // 4. Depth phases
    insights.push(`Considering edge cases and common misconceptions...`);
    insights.push(`Cross-checking reasoning for logical gaps...`);
    insights.push(`Structuring the clearest explanation...`);

    return insights;
  }

  private buildDeepResearchInsights(
    topic: string,
    keywords: string[],
  ): string[] {
    const insights: string[] = [];
    const t = topic || 'the topic';

    insights.push(`Formulating search queries for ${t}...`);
    insights.push(`Searching: "${topic || 'the question'}" — finding primary sources...`);

    if (keywords.length > 0) {
      insights.push(`Searching: "${keywords[0]}" — looking for recent data and studies...`);
    } else {
      insights.push(`Rephrasing query — looking for recent data and studies...`);
    }

    if (keywords.length > 1) {
      insights.push(`Searching: "${keywords[1]}" — checking academic and expert views...`);
    } else {
      insights.push(`Expanding search — checking academic and expert perspectives...`);
    }

    insights.push(`Searching for alternative viewpoints and counter-arguments...`);
    insights.push(`Cross-referencing sources — verifying key facts...`);
    insights.push(`Evaluating source credibility and recency...`);
    insights.push(`Synthesizing findings into a comprehensive answer...`);

    return insights;
  }

  private buildNormalInsights(
    topic: string,
    keywords: string[],
  ): string[] {
    const t = topic || 'your question';
    const insights: string[] = [];

    insights.push(`Understanding ${t}...`);

    if (keywords.length > 0) {
      insights.push(`Considering key aspects of "${keywords[0]}"...`);
    } else {
      insights.push(`Analyzing context and formulating approach...`);
    }

    insights.push(`Generating response...`);

    return insights;
  }

  /**
   * Extract a clean topic phrase from the user's message (max 50 chars).
   */
  private extractTopic(content: string): string {
    if (!content || content.trim().length < 5) return '';

    let text = content
      .replace(/^(what|how|why|when|where|who|can you|could you|please|explain|tell me about|help me with|help me understand|i need help with|i want to know about|i'm curious about|i don't understand)\s+/i, '')
      .replace(/^(is|are|do|does|did|was|were|will|would|should|could|can)\s+/i, '')
      .trim();

    // Take first meaningful phrase
    const breakMatch = text.match(/^(.{8,50}?)[\.\?\!\n;—]/);
    if (breakMatch) {
      text = breakMatch[1].trim();
    } else if (text.length > 50) {
      text = text.substring(0, 50).replace(/\s+\S*$/, '').trim();
    }

    // Clean trailing filler words
    text = text.replace(/\s+(the|a|an|is|are|of|in|to|for|and|or|with|by|it|this|that)$/i, '').trim();

    return text.length >= 3 ? text : '';
  }

  /**
   * Extract 1-3 meaningful keywords from the question (nouns/phrases the student cares about).
   */
  private extractKeywords(content: string): string[] {
    if (!content || content.trim().length < 5) return [];

    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'can', 'shall', 'must', 'need', 'to', 'of',
      'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about',
      'between', 'through', 'during', 'before', 'after', 'above', 'below',
      'and', 'but', 'or', 'not', 'no', 'if', 'then', 'than', 'so', 'too',
      'very', 'just', 'also', 'how', 'what', 'why', 'when', 'where', 'who',
      'which', 'that', 'this', 'these', 'those', 'it', 'its', 'my', 'your',
      'me', 'i', 'you', 'we', 'they', 'he', 'she', 'him', 'her', 'them',
      'explain', 'tell', 'help', 'understand', 'please', 'know', 'think',
      'mean', 'work', 'make', 'get', 'use', 'find', 'give', 'say', 'want',
      'does', 'difference', 'between', 'example', 'examples',
    ]);

    // Extract words, filter stop words, require 4+ chars for specificity
    const words = content
      .toLowerCase()
      .replace(/[^\w\s'-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !stopWords.has(w));

    // Deduplicate and take top 3 by length (longer words tend to be more specific)
    const unique = [...new Set(words)];
    unique.sort((a, b) => b.length - a.length);

    return unique.slice(0, 3);
  }

  /**
   * Classify the question type to tailor insights.
   */
  private classifyQuestion(content: string): string {
    const lower = content.toLowerCase().trim();
    if (/^(how\s+(do|does|to|can|would|should)|steps|process|method)/i.test(lower)) return 'how';
    if (/^(why|what\s+(cause|reason|makes))/i.test(lower)) return 'why';
    if (/\b(compare|contrast|difference|vs\.?|versus|better)\b/i.test(lower)) return 'compare';
    if (/\b(solve|calculate|compute|find the|evaluate|simplify|derive|prove)\b/i.test(lower)) return 'solve';
    if (/^(what\s+is|what\s+are|define|meaning)/i.test(lower)) return 'define';
    return 'general';
  }

  // ═══════════════════════════════════════════════════════════
  // SAP PDF Cache (in-memory, auto-expires)
  // ═══════════════════════════════════════════════════════════

  /** Store a PDF in the temporary cache, returns a cache key. */
  cachePdf(buffer: Buffer, filename: string): string {
    // Clean up expired entries
    const now = Date.now();
    for (const [key, entry] of this.pdfCache) {
      if (entry.expiresAt < now) this.pdfCache.delete(key);
    }
    const cacheKey = `sap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.pdfCache.set(cacheKey, { buffer, filename, expiresAt: now + 30 * 60 * 1000 });
    return cacheKey;
  }

  /** Retrieve a cached PDF by key. Returns null if expired or not found. */
  getCachedPdf(cacheKey: string): { buffer: Buffer; filename: string } | null {
    const entry = this.pdfCache.get(cacheKey);
    if (!entry || entry.expiresAt < Date.now()) {
      this.pdfCache.delete(cacheKey);
      return null;
    }
    return { buffer: entry.buffer, filename: entry.filename };
  }

  // ═══════════════════════════════════════════════════════════
  // SAP Report Helpers
  // ═══════════════════════════════════════════════════════════

  private isSapProject(project: { title?: string | null }): boolean {
    return /\bsap\b/i.test(project.title || '');
  }

  /** Strip LLM preamble/thinking text before the first markdown heading */
  private stripPreamble(content: string): string {
    const firstHeading = content.search(/^#{1,3}\s+/m);
    if (firstHeading > 0) {
      return content.slice(firstHeading);
    }
    return content;
  }

  /** Check if the LLM response actually contains a report (not just a refusal). */
  private looksLikeReport(content: string): boolean {
    if (content.length < 800) return false;
    const headingCount = (content.match(/^#{1,3}\s+/gm) || []).length;
    return headingCount >= 1;
  }

  /**
   * Detect whether the user message is asking for a report and return the
   * SAP system instructions — injected into the system prompt when a SAP project is attached.
   * No regex. The LLM decides from the user's message whether to generate a report.
   * All report templates are included so the LLM has them ready.
   */
  private getSapSystemInstructions(hasFiles: boolean): string {
    return [
      '\n\n[SAP — School Assessment & Performance Project]',
      '',
      'You are in a SAP project. You have VISION capabilities — you CAN see and read images and PDFs.',
      '',
      ...(hasFiles ? [
        '██████████████████████████████████████████████████████████████',
        'ABSOLUTE DIRECTIVE — NO EXCEPTIONS:',
        'Images/PDFs are attached. You MUST generate a FULL REPORT immediately.',
        'DO NOT ask questions. DO NOT ask for more info. DO NOT refuse.',
        'DO NOT say "I need more information" or "please provide".',
        'JUST GENERATE THE REPORT NOW.',
        '██████████████████████████████████████████████████████████████',
        '',
      ] : [
        'No images attached yet. Ask the user to upload question/assessment images.',
        '',
      ]),
      'RULES — follow ALL of these:',
      '1. Read ALL attached images and PDFs with vision. Extract whatever you can: subjects, questions, names, IDs, dates.',
      '2. If name/ID/date are NOT readable or missing, leave them as "N/A" in the report. DO NOT ask the user.',
      '3. If you can read even ONE question from the images, generate the full report.',
      '4. Default to STUDENT report unless the user says otherwise.',
      '5. Follow the EXACT markdown structure from the demo templates below.',
      '6. Use REAL extracted data. For learning streaks: use demo values as placeholders.',
      '7. Output in full markdown with # ## ### headings. Must be 1000+ words.',
      '8. Start DIRECTLY with # heading. NO preamble, NO "let me analyze", NO thinking out loud.',
      '9. You may include Devanagari text when source is in Devanagari. The PDF supports it.',
      '10. Pay attention to user\'s message for any specific instructions about the report.',
      '',
      '=== STUDENT REPORT DEMO ===',
      DEMO_STUDENT_REPORT,
      '',
      '=== TEACHER REPORT DEMO ===',
      DEMO_TEACHER_REPORT,
      '',
      '=== ADMIN REPORT DEMO ===',
      DEMO_ADMIN_REPORT,
      '',
      '[END OF SAP TEMPLATES]',
    ].join('\n');
  }

  /**
   * Full stream state for reconnection — includes content, trace, mode, provider.
   */
  async getStreamState(streamId: string): Promise<{
    content: string;
    complete: boolean;
    messageId?: string;
    sessionId?: string;
    mode?: StreamChunk['mode'];
    thinkingTrace?: string[];
    provider?: string;
  } | null> {
    const sd = this.activeStreams.get(streamId);
    if (sd) {
      return {
        content: sd.content,
        complete: sd.complete,
        messageId: sd.messageId,
        sessionId: sd.sessionId,
        mode: sd.mode,
        thinkingTrace: [...sd.thinkingTrace],
        provider: sd.provider,
      };
    }

    // Check database for completed stream
    const message = await this.prisma.ai_messages.findFirst({
      where: { streamId },
    });

    if (message) {
      return {
        content: message.content || '',
        complete: message.isComplete,
        messageId: message.id,
        sessionId: message.sessionId,
      };
    }

    return null;
  }

  /**
   * Cancel an active stream. Sets cancelled flag so the streaming loop breaks.
   * Returns the partial content accumulated so far, or null if stream not found.
   */
  cancelStream(streamId: string): { messageId: string; sessionId: string; partialContent: string } | null {
    const sd = this.activeStreams.get(streamId);
    if (!sd || sd.complete || sd.cancelled) return null;
    sd.cancelled = true;
    this.logger.log(`Stream ${streamId} cancelled by user`);
    return { messageId: sd.messageId, sessionId: sd.sessionId, partialContent: sd.content };
  }

  /**
   * Find an active or recently-completed stream by messageId.
   * Used when frontend knows the messageId (e.g. from a previous response) but not streamId.
   */
  async getStreamStateByMessageId(
    messageId: string,
    userId: string,
  ): Promise<{
    content: string;
    complete: boolean;
    messageId: string;
    sessionId: string;
    mode?: StreamChunk['mode'];
    thinkingTrace?: string[];
    provider?: string;
    hasError?: boolean;
    errorMessage?: string;
  } | null> {
    // Check in-memory active streams first
    for (const [, sd] of this.activeStreams) {
      if (sd.messageId === messageId) {
        return {
          content: sd.content,
          complete: sd.complete,
          messageId: sd.messageId,
          sessionId: sd.sessionId,
          mode: sd.mode,
          thinkingTrace: [...sd.thinkingTrace],
          provider: sd.provider,
        };
      }
    }

    // Fall back to database
    const message = await this.prisma.ai_messages.findFirst({
      where: { id: messageId },
      include: { ai_chat_sessions: true },
    });

    if (!message || message.ai_chat_sessions.userId !== userId) {
      return null;
    }

    return {
      content: message.content || '',
      complete: message.isComplete,
      messageId: message.id,
      sessionId: message.sessionId,
      hasError: message.hasError,
      errorMessage: message.errorMessage || undefined,
    };
  }

  /**
   * Get the most recent AI message for a session — used after page reload
   * to check if there's an in-flight or recently-completed stream.
   */
  async getMostRecentAIMessage(
    sessionId: string,
    userId: string,
  ): Promise<{
    content: string;
    complete: boolean;
    messageId: string;
    sessionId: string;
    mode?: StreamChunk['mode'];
    thinkingTrace?: string[];
    provider?: string;
    hasError?: boolean;
    errorMessage?: string;
    isStreaming?: boolean;
  } | null> {
    // Verify session ownership
    const session = await this.prisma.ai_chat_sessions.findFirst({
      where: { id: sessionId, userId },
    });
    if (!session) return null;

    const message = await this.prisma.ai_messages.findFirst({
      where: { sessionId, role: 'ASSISTANT' },
      orderBy: { createdAt: 'desc' },
    });
    if (!message) return null;

    // If still streaming in memory, return live state
    if (message.streamId) {
      const sd = this.activeStreams.get(message.streamId);
      if (sd && !sd.complete) {
        return {
          content: sd.content,
          complete: false,
          messageId: sd.messageId,
          sessionId: sd.sessionId,
          mode: sd.mode,
          thinkingTrace: [...sd.thinkingTrace],
          provider: sd.provider,
          isStreaming: true,
        };
      }
    }

    return {
      content: message.content || '',
      complete: message.isComplete,
      messageId: message.id,
      sessionId: message.sessionId,
      hasError: message.hasError,
      errorMessage: message.errorMessage || undefined,
      isStreaming: message.isStreaming,
    };
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
    readAloud?: boolean,
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
    const result = await this.sendMessageStreaming(userId, {
      content: transcription,
      sessionId: session.id,
      readAloud,
    });

    // Attach audio metadata so the frontend can play back the user's audio
    return { ...result, audioUrl, transcription };
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
    const key = `chat/${folder}/${uuidv4()}.${ext}`;
    try {
      await this.storage.uploadBuffer(key, file.buffer, file.mimetype);
    } catch (error: any) {
      this.logger.error(`GCS upload failed for ${file.originalname}: ${error.message}`);
      throw new BadRequestException(`File upload failed: ${error.message}`);
    }
    return key;
  }

  /**
   * Get a signed preview URL for a chat attachment
   */
  async getAttachmentPreviewUrl(
    messageId: string,
    attachmentIndex: number,
    userId: string,
  ): Promise<{ url: string; mimeType: string; name: string }> {
    const message = await this.prisma.ai_messages.findFirst({
      where: { id: messageId },
      include: { ai_chat_sessions: { select: { userId: true } } },
    });

    if (!message || message.ai_chat_sessions.userId !== userId) {
      throw new NotFoundException('Message not found');
    }

    const attachments = (message.attachments as any[]) || [];
    if (attachmentIndex < 0 || attachmentIndex >= attachments.length) {
      throw new NotFoundException('Attachment not found');
    }

    const attachment = attachments[attachmentIndex];
    const key = attachment.url;

    // If already a full URL, return directly
    if (key.startsWith('http')) {
      return { url: key, mimeType: attachment.mimeType, name: attachment.name };
    }

    const signedUrl = await this.storage.getSignedUrl(key, 3600);
    return { url: signedUrl, mimeType: attachment.mimeType, name: attachment.name };
  }

  private async buildPromptParts(content: string, attachments?: Express.Multer.File[]): Promise<LlmContentPart[]> {
    const parts: LlmContentPart[] = [];

    // Add attachments first (images/PDFs/text/docs)
    if (attachments) {
      for (const file of attachments) {
        if (file.mimetype === 'text/plain') {
          // Inject plain text content directly
          const textContent = file.buffer.toString('utf-8');
          parts.push({ text: `[File: ${file.originalname}]\n${textContent}` });
        } else if (
          file.mimetype === 'application/msword' ||
          file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ) {
          // Word docs: send as inline data for Gemini to process
          parts.push({
            inlineData: {
              mimeType: file.mimetype,
              data: file.buffer.toString('base64'),
            },
          });
        } else if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
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

    return messages
      .filter((msg: any) => msg.content && msg.content.trim() !== '')
      .map((msg: any) => ({
        role: (msg.role === 'USER' ? 'user' : 'assistant') as 'user' | 'assistant',
        parts: [{ text: msg.content }],
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
      messageId: aiMessage.id,
      sessionId: session.id,
      mode: 'council',
      thinkingTrace: [],
      provider: 'vertex', // council always uses Gemini-family
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

    // ── Council thinking trace (accumulated across all phases) ──
    const councilTrace: string[] = [];
    const emitCouncilTrace = (message: string, extra?: Record<string, any>) => {
      councilTrace.push(message);
      // Keep activeStream in sync for reconnection
      const sd = this.activeStreams.get(streamId);
      if (sd) sd.thinkingTrace = [...councilTrace];
      emitter.emit('chunk', {
        type: 'status',
        messageId,
        sessionId,
        mode: 'council' as const,
        message,
        thinkingTrace: [...councilTrace],
        ...extra,
      } as StreamChunk);
    };

    // Emit the initial 'start' chunk so the frontend knows it's council mode
    emitter.emit('chunk', {
      type: 'start',
      messageId,
      sessionId,
      streamId,
      mode: 'council',
      provider: 'vertex',
      message: 'Starting AI Council deliberation...',
    } as StreamChunk);

    // Notify frontend that council analysis is starting
    emitCouncilTrace(`Assembling ${COUNCIL_MEMBERS.length} expert perspectives...`);
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
        emitCouncilTrace(
          `${member.name} finished analysis (${parsed.confidence}% confidence)`,
          { activeExpert: member.name },
        );
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

        emitCouncilTrace(`${member.name} could not respond — continuing with other experts`);
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
    emitCouncilTrace('All experts have responded — cross-reviewing each other\'s answers...');
    emitter.emit('councilStatus', {
      type: 'councilCrossReviewStart',
      sessionId,
      messageId,
    });

    await this.runCrossReview(memberResponses, userContent, sessionSubject);
    this.logger.log(`[COUNCIL] Cross-review complete.`);
    emitCouncilTrace('Cross-review complete — experts verified each other\'s work');

    // ── Phase 3: Synthesis with strongest model ──
    this.logger.log(
      `[COUNCIL] Phase 3: Synthesis via ${SYNTHESIZER_MODEL} — weaving ${memberResponses.length} perspectives...`,
    );
    emitCouncilTrace('Synthesizing the best answer from all perspectives...');
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

    const councilProvider = this.getProviderForTask('council');
    const result = await this.withTimeout(
      this.llm.generateWithFallback(messages, {
        systemPrompt,
        generationConfig: {
          temperature: member.config.temperature,
          maxOutputTokens: member.config.maxOutputTokens,
        },
        models: [member.modelName],
        provider: councilProvider,
      }),
      60000,
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

        const councilProvider = this.getProviderForTask('council');
        const result = await this.withTimeout(
          this.llm.generateWithFallback(messages, {
            systemPrompt: reviewSystemPrompt,
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: member.config.reviewMaxTokens,
            },
            models: [member.modelName],
            provider: councilProvider,
          }),
          30000,
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
    // NOTE: Do NOT emit a 'start' chunk here — the council start was already
    // emitted by executeCouncil. Emitting another 'start' resets the frontend
    // state (clears thinkingTrace). Instead emit a status update.
    const sd = this.activeStreams.get(streamId);
    emitter.emit('chunk', {
      type: 'status',
      messageId,
      sessionId,
      mode: 'council',
      message: 'Generating final answer from expert consensus...',
      thinkingTrace: sd ? [...sd.thinkingTrace, 'Generating final answer from expert consensus...'] : [],
    } as StreamChunk);
    if (sd) sd.thinkingTrace = [...(sd.thinkingTrace || []), 'Generating final answer from expert consensus...'];

    const messages: LlmMessage[] = [
      { role: 'user', parts: [{ text: 'Please synthesize the perspectives above into a complete answer.' }] },
    ];

    const councilProvider = this.getProviderForTask('council');
    // Use streamWithFallback so synthesis survives provider failures
    const llmStream = await this.llm.streamWithFallback(messages, {
      systemPrompt: synthesizerSystemPrompt,
      generationConfig: {
        temperature: SYNTHESIZER_CONFIG.temperature,
        maxOutputTokens: SYNTHESIZER_CONFIG.maxOutputTokens,
      },
      models: [SYNTHESIZER_MODEL],
      provider: councilProvider,
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

    const finalSD = this.activeStreams.get(streamId);
    emitter.emit('chunk', {
      type: 'end',
      messageId,
      sessionId,
      mode: 'council',
      fullContent,
      thinkingTrace: finalSD ? [...finalSD.thinkingTrace] : [],
      provider: finalSD?.provider || 'vertex',
    } as StreamChunk);

    setTimeout(() => this.activeStreams.delete(streamId), 60000);
  }
}

