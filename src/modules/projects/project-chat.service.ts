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
import { LlmProvider } from '../prompts/types/prompt.types';
import {
  DEMO_STUDENT_REPORT,
  DEMO_TEACHER_REPORT,
  DEMO_ADMIN_REPORT,
} from './sap-templates';
import { SystemInstructionsService } from '../ai/system-instructions/system-instructions.service';
import { StorageService } from '../storage/storage.service';
import {
  COUNCIL_MEMBERS,
  CouncilMember,
  CouncilMemberResponse,
  SYNTHESIZER_MODEL,
  SYNTHESIZER_CONFIG,
  parseCouncilResponse,
} from '../ai/council-members';
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
    private readonly systemInstructions: SystemInstructionsService,
    private readonly storage: StorageService,
  ) {}

  // ============ Provider Selection ============

  private getProviderForTask(task: 'chat' | 'deep-think' | 'deep-research' | 'council'): LlmProvider {
    if (task === 'deep-research') {
      // Prefer Gemini-family for deep research (native Google Search grounding)
      if (this.llm.isProviderAvailable('vertex')) return 'vertex';
      if (this.llm.isProviderAvailable('gemini')) return 'gemini';
      if (this.llm.isProviderAvailable('anthropic')) return 'anthropic';
    } else if (task === 'chat' || task === 'deep-think') {
      // Prefer Anthropic for chat & deep thinking (best reasoning)
      if (this.llm.isProviderAvailable('anthropic')) return 'anthropic';
      if (this.llm.isProviderAvailable('vertex')) return 'vertex';
      if (this.llm.isProviderAvailable('gemini')) return 'gemini';
    }
    return this.llm.getDefaultProvider();
  }

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

    // Fetch native project chat sessions
    const projectSessions = await this.prisma.project_chat_sessions.findMany({
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

    // Fetch linked LLM chat sessions (from main chat with this project attached)
    const linkedSessions = await this.prisma.ai_chat_sessions.findMany({
      where: { projectId, userId },
      orderBy: { lastMessageAt: 'desc' },
      include: {
        ai_messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true, role: true, createdAt: true },
        },
        _count: { select: { ai_messages: true } },
      },
    });

    // Format and merge both lists
    const formatted: ProjectChatSessionResponse[] = [
      ...projectSessions.map((s: any) => this.formatSession(s, true)),
      ...linkedSessions.map((s: any) => this.formatLinkedSession(s, projectId)),
    ];

    // Sort by lastMessageAt descending
    formatted.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

    return formatted;
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

    // Try native project session first
    const session = await this.prisma.project_chat_sessions.findFirst({
      where: { id: sessionId, projectId, userId },
      include: {
        project_messages: { orderBy: { createdAt: 'asc' } },
        _count: { select: { project_messages: true } },
      },
    });

    if (session) {
      return {
        session: this.formatSession(session, true),
        messages: session.project_messages.map((m: any) => this.formatMessage(m)),
      };
    }

    // Try linked LLM chat session
    const linkedSession = await this.prisma.ai_chat_sessions.findFirst({
      where: { id: sessionId, projectId, userId },
      include: {
        ai_messages: { orderBy: { createdAt: 'asc' } },
        _count: { select: { ai_messages: true } },
      },
    });

    if (!linkedSession) {
      throw new NotFoundException('Chat session not found');
    }

    return {
      session: this.formatLinkedSession(linkedSession, projectId),
      messages: linkedSession.ai_messages.map((m: any) => this.formatMessage(m)),
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

    // Route to council mode if requested
    if (dto.councilMode) {
      this.logger.log(`[MODE] Council mode requested for project ${projectId}`);
      return this.runCouncilStreaming(project, session, dto.content || '', attachments, emitter);
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
      {
        deepThink: dto.deepThink,
        deepResearch: dto.deepResearch,
        sessionId: session.id,
      },
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
    const resourceContext = await this.projectsService.getResourceContext(projectId, dto.sessionId);

    if (!resourceContext) {
      throw new BadRequestException(
        dto.sessionId
          ? 'No resources found for this session. Upload study materials to the project or session first.'
          : 'No resources uploaded to this project yet. Upload study materials first.',
      );
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

    this.streamResponse(
      project,
      session.id,
      aiMessage.id,
      streamId,
      quizPrompt,
      undefined,
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

  async generateQuizPdf(
    projectId: string,
    userId: string,
    dto: GenerateQuizDto,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const project = await this.projectsService.verifyOwnership(projectId, userId);
    const resourceContext = await this.projectsService.getResourceContext(projectId, dto.sessionId);

    if (!resourceContext) {
      throw new BadRequestException('No resources found. Upload study materials first.');
    }

    // Generate quiz as JSON using non-streaming call
    const quizJsonPrompt = this.buildQuizJsonPrompt(dto, resourceContext);
    const systemPrompt = this.buildProjectSystemPrompt(project);

    const provider = this.getProviderForTask('chat');
    const resolved = this.llm.resolvePrompt('project-chat', undefined, provider);

    const result = await this.llm.generateWithFallback(
      [{ role: 'user', parts: [{ text: quizJsonPrompt }] }],
      {
        systemPrompt,
        generationConfig: {
          ...resolved.generationConfig,
          temperature: 0.3,
        },
        models: resolved.models,
        provider,
      },
    );

    // Parse the JSON quiz from the LLM response
    const questions = this.parseQuizJson(result.text);

    // Generate PDF
    const buffer = await this.buildQuizPdf(
      questions,
      project.title,
      dto.quizType || 'MIXED',
      dto.difficulty || 'MEDIUM',
    );

    const filename = `quiz-${project.title.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}-${Date.now()}.pdf`;
    return { buffer, filename };
  }

  private buildQuizJsonPrompt(dto: GenerateQuizDto, resourceContext: string): string {
    return [
      `Generate a quiz with exactly ${dto.questionCount || 5} questions at ${dto.difficulty || 'MEDIUM'} difficulty.`,
      `Quiz type: ${dto.quizType || 'MIXED'}`,
      '',
      'Return ONLY a valid JSON array (no markdown, no code blocks). Each item:',
      '{ "number": 1, "type": "MCQ"|"SHORT_ANSWER"|"TRUE_FALSE", "question": "...", "options": ["A","B","C","D"] (MCQ only), "answer": "..." , "explanation": "..." }',
      '',
      `Study materials:\n${resourceContext.length > 50000 ? resourceContext.slice(0, 50000) : resourceContext}`,
    ].join('\n');
  }

  private parseQuizJson(text: string): any[] {
    // Try to extract JSON array from the response
    try {
      // Remove markdown code block if present
      const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) return parsed;
      if (parsed.questions && Array.isArray(parsed.questions)) return parsed.questions;
    } catch {
      // Fallback: try to find JSON array in text
      const match = text.match(/\[[\s\S]*\]/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch {
          // ignore
        }
      }
    }
    // Last resort: return a single-item fallback
    this.logger.warn('Failed to parse quiz JSON, returning raw text');
    return [{ number: 1, type: 'SHORT_ANSWER', question: 'Quiz generation produced non-structured output. Raw content below:', answer: text, explanation: '' }];
  }

  private async buildQuizPdf(
    questions: any[],
    projectTitle: string,
    quizType: string,
    difficulty: string,
  ): Promise<Buffer> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const PDFDocument = require('pdfkit');

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const dateStr = new Date().toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      });

      // Cover
      doc.fontSize(22).font('Helvetica-Bold').text('Study Quiz', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(14).font('Helvetica').text(projectTitle, { align: 'center' });
      doc.moveDown(0.3);
      doc.fontSize(11).font('Helvetica-Oblique').text(
        `${quizType} | ${difficulty} | ${questions.length} Questions | ${dateStr}`,
        { align: 'center' },
      );
      doc.moveDown(2);

      // Questions section (no answers)
      doc.fontSize(16).font('Helvetica-Bold').text('Questions');
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#333333').lineWidth(1).stroke();
      doc.moveDown(0.8);

      questions.forEach((q, i) => {
        const num = q.number || i + 1;
        const typeLabel = q.type === 'MCQ' ? '[Multiple Choice]'
          : q.type === 'TRUE_FALSE' ? '[True/False]'
          : '[Short Answer]';

        doc.fontSize(12).font('Helvetica-Bold').text(`${num}. ${typeLabel} ${q.question}`);
        doc.moveDown(0.3);

        if (q.type === 'MCQ' && q.options) {
          const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
          q.options.forEach((opt: string, j: number) => {
            doc.fontSize(11).font('Helvetica').text(`    ${labels[j]}. ${opt}`);
          });
          doc.moveDown(0.3);
        } else if (q.type === 'TRUE_FALSE') {
          doc.fontSize(11).font('Helvetica').text('    ○ True      ○ False');
          doc.moveDown(0.3);
        } else {
          // Short answer — draw lines for writing
          doc.moveDown(0.3);
          for (let l = 0; l < 2; l++) {
            doc.moveTo(70, doc.y).lineTo(500, doc.y).strokeColor('#bbbbbb').dash(2, { space: 3 }).stroke();
            doc.undash();
            doc.moveDown(0.7);
          }
        }

        doc.moveDown(0.5);
        if (i < questions.length - 1) {
          doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#dddddd').lineWidth(0.5).stroke();
          doc.moveDown(0.5);
        }

        // Add page break if needed
        if (doc.y > 700 && i < questions.length - 1) {
          doc.addPage();
        }
      });

      // Answer key on new page
      doc.addPage();
      doc.fontSize(16).font('Helvetica-Bold').text('Answer Key');
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#333333').lineWidth(1).stroke();
      doc.moveDown(0.8);

      questions.forEach((q, i) => {
        const num = q.number || i + 1;
        doc.fontSize(11).font('Helvetica-Bold').text(`${num}. ${q.answer || 'N/A'}`);
        if (q.explanation) {
          doc.fontSize(10).font('Helvetica-Oblique').fillColor('#444444').text(q.explanation);
          doc.fillColor('#000000');
        }
        doc.moveDown(0.5);

        if (doc.y > 700 && i < questions.length - 1) {
          doc.addPage();
        }
      });

      doc.end();
    });
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
    options?: {
      deepThink?: boolean;
      deepResearch?: boolean;
      sessionId?: string;
    },
  ): Promise<void> {
    const heartbeatIntervalMs = 5000;
    let heartbeatTimer: NodeJS.Timeout | null = null;

    try {
      // Select prompt and provider based on task type
      const task = options?.deepThink ? 'deep-think' : options?.deepResearch ? 'deep-research' : 'chat';
      const promptId = task === 'deep-think'
        ? 'deep-think' as const
        : task === 'deep-research'
          ? 'deep-research' as const
          : 'project-chat' as const;

      const provider = this.getProviderForTask(task);
      const resolved = this.llm.resolvePrompt(promptId, undefined, provider);

      this.logger.log(`[project-${task}] Using provider: ${provider}, models: [${resolved.models.join(', ')}]`);

      // Build system prompt: for project-chat use project-specific prompt, for deep modes use resolved
      let systemPrompt: string;
      if (promptId === 'project-chat') {
        systemPrompt = this.buildProjectSystemPrompt(project);
      } else {
        systemPrompt = resolved.systemPrompt || '';
        // Append project context for deep modes too
        const projectCtx = this.buildProjectContextSuffix(project);
        if (projectCtx) systemPrompt += projectCtx;
      }

      // Override temperature with project's aiTemperature
      // SAP reports need more output tokens since they're long structured documents
      const isSap = this.isSapProject(project);
      const genConfig = {
        ...resolved.generationConfig,
        temperature: project.aiTemperature ?? resolved.generationConfig.temperature ?? 0.5,
        ...(isSap && { maxOutputTokens: 16384 }),
      };

      // Get conversation history
      const history = await this.getConversationHistory(sessionId, messageId);

      // Get resource context — session-scoped if sessionId provided, otherwise project-wide
      const resourceContext = await this.projectsService.getResourceContext(project.id, options?.sessionId || sessionId);

      // Build prompt parts
      const promptParts = await this.buildPromptParts(content, attachments, resourceContext);

      // For SAP projects: inject the relevant report template + demo when user requests a report
      let isSapReport = false;
      if (this.isSapProject(project) && content) {
        const sapContext = this.getSapReportContext(content);
        if (sapContext) {
          promptParts.unshift({ text: sapContext });
          isSapReport = true;
        }
      }

      // Emit start with mode-specific message
      const startMessage = options?.deepThink
        ? 'Starting deep analysis...'
        : options?.deepResearch
          ? 'Starting deep research...'
          : 'Started generating response';

      emitter.emit('chunk', {
        type: 'start',
        messageId,
        sessionId,
        projectId: project.id,
        message: startMessage,
      } as ProjectStreamChunk);

      // Emit status updates for deep modes
      if (options?.deepThink) {
        emitter.emit('chunk', {
          type: 'status',
          messageId,
          sessionId,
          projectId: project.id,
          message: 'Thinking deeply...',
        } as ProjectStreamChunk);

        const thinkPhases = [
          { delay: 3000, message: 'Analyzing the problem...' },
          { delay: 8000, message: 'Considering multiple approaches...' },
          { delay: 15000, message: 'Formulating response...' },
        ];
        for (const phase of thinkPhases) {
          setTimeout(() => {
            const sd = this.activeStreams.get(streamId);
            if (sd && !sd.complete && !sd.cancelled) {
              emitter.emit('chunk', {
                type: 'status',
                messageId,
                sessionId,
                projectId: project.id,
                message: phase.message,
              } as ProjectStreamChunk);
            }
          }, phase.delay);
        }
      }

      if (options?.deepResearch) {
        emitter.emit('chunk', {
          type: 'status',
          messageId,
          sessionId,
          projectId: project.id,
          message: 'Searching the web...',
        } as ProjectStreamChunk);

        const researchPhases = [
          { delay: 3000, message: 'Finding relevant sources...' },
          { delay: 8000, message: 'Cross-referencing information...' },
          { delay: 15000, message: 'Synthesizing findings...' },
        ];
        for (const phase of researchPhases) {
          setTimeout(() => {
            const sd = this.activeStreams.get(streamId);
            if (sd && !sd.complete && !sd.cancelled) {
              emitter.emit('chunk', {
                type: 'status',
                messageId,
                sessionId,
                projectId: project.id,
                message: phase.message,
              } as ProjectStreamChunk);
            }
          }, phase.delay);
        }
      }

      // Stream via LlmService with automatic provider/model fallback (web search enabled)
      const messages: LlmMessage[] = [
        ...history,
        { role: 'user', parts: promptParts },
      ];

      const llmStream = await this.llm.streamWithFallback(messages, {
        systemPrompt: systemPrompt || undefined,
        generationConfig: genConfig,
        models: resolved.models,
        provider,
        webSearch: true,
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

      // SAP Report: auto-generate PDF and upload to GCS
      let reportDownload: ProjectStreamChunk['reportDownload'] | undefined;
      if (isSapReport && this.looksLikeReport(fullContent)) {
        try {
          const pdfBuffer = await this.renderMarkdownToPdf(fullContent, project.title);
          const dateStr = new Date().toISOString().slice(0, 10);
          const filename = `SAP-Report-${dateStr}.pdf`;
          const gcsKey = `sap-reports/${project.id}/${messageId}/${filename}`;
          const downloadUrl = await this.storage.uploadBuffer(gcsKey, pdfBuffer, 'application/pdf');
          reportDownload = { downloadUrl, filename, messageId };
          this.logger.log(`SAP report PDF auto-generated and uploaded: ${gcsKey}`);
        } catch (pdfError: any) {
          this.logger.error(`Failed to auto-generate SAP report PDF: ${pdfError.message}`);
          // Non-fatal — the report text is still in the message, user can download via manual endpoint
        }
      }

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
        ...(reportDownload && { reportDownload }),
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

  // ============ Council Mode ============

  private async runCouncilStreaming(
    project: any,
    session: any,
    userContent: string,
    attachments: Express.Multer.File[] | undefined,
    emitter: EventEmitter,
  ): Promise<ProjectStreamingResponse> {
    const processedAttachments = await this.processAttachments(attachments);

    await this.prisma.project_messages.create({
      data: {
        sessionId: session.id,
        role: 'USER',
        content: userContent || null,
        attachments: processedAttachments.length > 0 ? (processedAttachments as any) : undefined,
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

    this.executeCouncil(
      project,
      session.id,
      aiMessage.id,
      streamId,
      userContent,
      attachments,
      emitter,
    ).catch((error) => {
      this.logger.error(`Project council error: ${error.message}`);
      emitter.emit('chunk', {
        type: 'error',
        messageId: aiMessage.id,
        sessionId: session.id,
        projectId: project.id,
        error: error.message,
      } as ProjectStreamChunk);
    });

    return { messageId: aiMessage.id, sessionId: session.id, projectId: project.id, emitter };
  }

  private async executeCouncil(
    project: any,
    sessionId: string,
    messageId: string,
    streamId: string,
    userContent: string,
    attachments: Express.Multer.File[] | undefined,
    emitter: EventEmitter,
  ): Promise<void> {
    const history = await this.getConversationHistory(sessionId, messageId);
    const resourceContext = await this.projectsService.getResourceContext(project.id, sessionId);
    const promptParts = await this.buildPromptParts(userContent, attachments, resourceContext);

    this.logger.log(`[PROJECT-COUNCIL] Starting multi-model council for project ${project.id}`);

    // Notify frontend that council analysis is starting
    emitter.emit('councilStatus', {
      type: 'councilAnalysisStart',
      sessionId,
      messageId,
      projectId: project.id,
      experts: COUNCIL_MEMBERS.map((m) => ({
        id: m.id,
        name: m.name,
        label: m.label,
        status: 'analyzing',
      })),
    });

    // Phase 1: Parallel analysis with different models
    const memberStartTime = Date.now();
    const memberResponses: CouncilMemberResponse[] = [];

    // Determine subject from project title/description
    const subject = project.title || null;

    const memberPromises = COUNCIL_MEMBERS.map(async (member, index) => {
      this.logger.log(`[PROJECT-COUNCIL] [${member.label}] ${member.name} analyzing...`);
      try {
        const rawText = await this.callCouncilMember(member, history, promptParts, subject);
        const parsed = parseCouncilResponse(rawText);
        const elapsed = Date.now() - memberStartTime;

        this.logger.log(
          `[PROJECT-COUNCIL] [${member.label}] ${member.name} completed in ${elapsed}ms (confidence: ${parsed.confidence})`,
        );

        const response: CouncilMemberResponse = {
          memberId: member.id,
          memberName: member.name,
          memberLabel: member.label,
          content: parsed.content,
          confidence: parsed.confidence,
          keyPoints: parsed.keyPoints,
        };

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
          `[PROJECT-COUNCIL] [${member.label}] ${member.name} failed after ${elapsed}ms: ${error.message}`,
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

    // Phase 2: Cross-review round
    this.logger.log(`[PROJECT-COUNCIL] Phase 2: Cross-review round starting...`);
    emitter.emit('councilStatus', {
      type: 'councilCrossReviewStart',
      sessionId,
      messageId,
      projectId: project.id,
    });

    await this.runCrossReview(memberResponses, userContent, subject);
    this.logger.log(`[PROJECT-COUNCIL] Cross-review complete.`);

    // Phase 3: Synthesis with strongest model
    this.logger.log(`[PROJECT-COUNCIL] Phase 3: Synthesis via ${SYNTHESIZER_MODEL}`);
    emitter.emit('councilSynthesisStart', { sessionId, messageId, projectId: project.id });

    // Build synthesizer prompt — include project context
    let synthesizerPrompt = this.systemInstructions.getSynthesizerPrompt(memberResponses, userContent);
    const projectCtx = this.buildProjectContextSuffix(project);
    if (projectCtx) synthesizerPrompt += projectCtx;

    await this.streamCouncilSynthesis(
      project,
      sessionId,
      messageId,
      streamId,
      synthesizerPrompt,
      memberResponses,
      userContent,
      emitter,
    );
  }

  private async callCouncilMember(
    member: CouncilMember,
    history: LlmMessage[],
    promptParts: LlmContentPart[],
    subject: string | null,
  ): Promise<string> {
    const systemPrompt = this.systemInstructions.getCouncilMemberPrompt(member, subject);

    const messages: LlmMessage[] = [
      ...history,
      { role: 'user', parts: promptParts },
    ];

    const councilProvider = this.getProviderForTask('council');
    const result = await this.withTimeout(
      this.llm.generate(councilProvider, messages, {
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

  private async runCrossReview(
    memberResponses: CouncilMemberResponse[],
    userQuestion: string,
    subject: string | null,
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
          this.llm.generate(councilProvider, messages, {
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
          `[PROJECT-COUNCIL] [REVIEW] ${member.name} reviewed peers: "${review.substring(0, 80)}..."`,
        );
      } catch (error: any) {
        this.logger.warn(`[PROJECT-COUNCIL] [REVIEW] ${member.name} review failed: ${error.message}`);
      }
    });

    await Promise.allSettled(reviewPromises);
  }

  private async streamCouncilSynthesis(
    project: any,
    sessionId: string,
    messageId: string,
    streamId: string,
    synthesizerSystemPrompt: string,
    memberResponses: CouncilMemberResponse[],
    userContent: string,
    emitter: EventEmitter,
  ): Promise<void> {
    const projectId = project.id;

    emitter.emit('chunk', {
      type: 'start',
      messageId,
      sessionId,
      projectId,
      message: 'Synthesizing perspectives...',
    } as ProjectStreamChunk);

    const messages: LlmMessage[] = [
      { role: 'user', parts: [{ text: 'Please synthesize the perspectives above into a complete answer.' }] },
    ];

    const councilProvider = this.getProviderForTask('council');
    const llmStream = await this.llm.stream(councilProvider, messages, {
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
        projectId,
        content: chunkText,
        fullContent,
      } as ProjectStreamChunk);
    }

    await this.prisma.project_messages.update({
      where: { id: messageId },
      data: {
        content: fullContent,
        isStreaming: false,
        isComplete: true,
      },
    });

    const streamData = this.activeStreams.get(streamId);
    if (streamData) streamData.complete = true;

    await this.updateSessionAfterMessage(sessionId, userContent);

    this.logger.log(`[PROJECT-COUNCIL] Synthesis complete (${fullContent.length} chars).`);

    // SAP Report: auto-generate PDF for council mode too
    let reportDownload: ProjectStreamChunk['reportDownload'] | undefined;
    const isSapReport = this.isSapProject(project) && userContent &&
      this.getSapReportContext(userContent) !== null;
    if (isSapReport && this.looksLikeReport(fullContent)) {
      try {
        const pdfBuffer = await this.renderMarkdownToPdf(fullContent, project.title);
        const dateStr = new Date().toISOString().slice(0, 10);
        const filename = `SAP-Report-${dateStr}.pdf`;
        const gcsKey = `sap-reports/${projectId}/${messageId}/${filename}`;
        const downloadUrl = await this.storage.uploadBuffer(gcsKey, pdfBuffer, 'application/pdf');
        reportDownload = { downloadUrl, filename, messageId };
        this.logger.log(`SAP report PDF auto-generated (council) and uploaded: ${gcsKey}`);
      } catch (pdfError: any) {
        this.logger.error(`Failed to auto-generate SAP report PDF (council): ${pdfError.message}`);
      }
    }

    emitter.emit('chunk', {
      type: 'end',
      messageId,
      sessionId,
      projectId,
      fullContent,
      ...(reportDownload && { reportDownload }),
    } as ProjectStreamChunk);

    setTimeout(() => this.activeStreams.delete(streamId), 60000);
  }

  // ============ SAP Report PDF Generation ============

  async generateSapReportPdf(
    projectId: string,
    messageId: string,
    userId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const project = await this.projectsService.verifyOwnership(projectId, userId);

    if (!this.isSapProject(project)) {
      throw new BadRequestException('SAP report PDF can only be generated from SAP projects');
    }

    // Fetch the AI message containing the report markdown
    const message = await this.prisma.project_messages.findFirst({
      where: { id: messageId, role: 'ASSISTANT', isComplete: true },
      include: { project_chat_sessions: true },
    });

    if (!message || message.project_chat_sessions.projectId !== projectId) {
      throw new NotFoundException('Report message not found');
    }

    if (!message.content || message.content.length < 100) {
      throw new BadRequestException('Message does not contain a valid report');
    }

    const buffer = await this.renderMarkdownToPdf(message.content, project.title);
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `SAP-Report-${dateStr}.pdf`;

    return { buffer, filename };
  }

  async renderMarkdownToPdf(markdown: string, projectTitle: string): Promise<Buffer> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const PDFDocument = require('pdfkit');

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        margin: 50,
        size: 'A4',
        bufferPages: true,
        info: {
          Title: `SAP Report — ${projectTitle}`,
          Author: 'TopTutors.ai',
          Creator: 'SAP — Self-Study Assistance Program',
        },
      });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const lines = markdown.split('\n');
      let inTable = false;
      let inBlockquote = false;
      let tableRows: string[][] = [];

      const colors = {
        heading1: '#1a1a2e',
        heading2: '#16213e',
        heading3: '#0f3460',
        text: '#333333',
        muted: '#666666',
        accent: '#0f3460',
        tableHeader: '#1a1a2e',
        tableHeaderText: '#ffffff',
        tableBorder: '#cccccc',
        tableAlt: '#f5f5f5',
        blockquoteBg: '#f0f4f8',
        blockquoteBorder: '#0f3460',
        hrColor: '#cccccc',
      };

      const pageWidth = doc.page.width - 100; // margins

      const checkPageBreak = (needed: number) => {
        if (doc.y + needed > doc.page.height - 60) {
          doc.addPage();
        }
      };

      const flushTable = () => {
        if (tableRows.length === 0) return;

        // Calculate column widths
        const numCols = Math.max(...tableRows.map(r => r.length));
        const colWidth = Math.min(pageWidth / numCols, 150);
        const tableWidth = colWidth * numCols;
        const startX = 50;

        checkPageBreak(tableRows.length * 22 + 10);

        tableRows.forEach((row, rowIdx) => {
          const isHeader = rowIdx === 0;
          const rowY = doc.y;

          // Row background
          if (isHeader) {
            doc.rect(startX, rowY, tableWidth, 20).fill(colors.tableHeader);
          } else if (rowIdx % 2 === 0) {
            doc.rect(startX, rowY, tableWidth, 20).fill(colors.tableAlt);
          }

          // Cell text
          row.forEach((cell, colIdx) => {
            const cellText = cell.replace(/\*\*/g, '').trim();
            const x = startX + colIdx * colWidth + 4;

            doc.fontSize(8)
              .font(isHeader ? 'Helvetica-Bold' : 'Helvetica')
              .fillColor(isHeader ? colors.tableHeaderText : colors.text)
              .text(cellText, x, rowY + 5, {
                width: colWidth - 8,
                height: 14,
                ellipsis: true,
                lineBreak: false,
              });
          });

          doc.y = rowY + 20;
        });

        // Bottom border
        doc.moveTo(startX, doc.y)
          .lineTo(startX + tableWidth, doc.y)
          .strokeColor(colors.tableBorder)
          .lineWidth(0.5)
          .stroke();

        doc.moveDown(0.5);
        tableRows = [];
        inTable = false;
      };

      for (const line of lines) {
        const trimmed = line.trim();

        // Skip separator rows in tables (|---|---|)
        if (/^\|[\s-|]+\|$/.test(trimmed)) continue;

        // Table row
        if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
          if (!inTable) inTable = true;
          const cells = trimmed.split('|').filter(c => c.trim() !== '');
          tableRows.push(cells.map(c => c.trim()));
          continue;
        }

        // If we were in a table but this line isn't a table row, flush it
        if (inTable) {
          flushTable();
        }

        // Horizontal rule
        if (/^---+$/.test(trimmed)) {
          checkPageBreak(15);
          doc.moveDown(0.3);
          doc.moveTo(50, doc.y)
            .lineTo(50 + pageWidth, doc.y)
            .strokeColor(colors.hrColor)
            .lineWidth(1)
            .stroke();
          doc.moveDown(0.5);
          continue;
        }

        // Heading 1
        if (trimmed.startsWith('# ')) {
          checkPageBreak(30);
          doc.moveDown(0.5);
          const text = trimmed.slice(2).replace(/\*\*/g, '');
          doc.fontSize(18).font('Helvetica-Bold').fillColor(colors.heading1).text(text);
          doc.moveDown(0.3);
          continue;
        }

        // Heading 2
        if (trimmed.startsWith('## ')) {
          checkPageBreak(25);
          doc.moveDown(0.4);
          const text = trimmed.slice(3).replace(/\*\*/g, '');
          doc.fontSize(14).font('Helvetica-Bold').fillColor(colors.heading2).text(text);
          doc.moveDown(0.2);
          continue;
        }

        // Heading 3
        if (trimmed.startsWith('### ')) {
          checkPageBreak(22);
          doc.moveDown(0.3);
          const text = trimmed.slice(4).replace(/\*\*/g, '');
          doc.fontSize(12).font('Helvetica-Bold').fillColor(colors.heading3).text(text);
          doc.moveDown(0.2);
          continue;
        }

        // Blockquote
        if (trimmed.startsWith('>')) {
          const quoteText = trimmed.slice(1).trim().replace(/\*\*/g, '').replace(/\*/g, '');
          if (!inBlockquote) {
            checkPageBreak(30);
            inBlockquote = true;
          }
          const quoteX = 58;
          // Draw left border
          doc.moveTo(54, doc.y)
            .lineTo(54, doc.y + 14)
            .strokeColor(colors.blockquoteBorder)
            .lineWidth(3)
            .stroke();
          doc.fontSize(9).font('Helvetica-Oblique').fillColor(colors.muted)
            .text(quoteText, quoteX, doc.y, { width: pageWidth - 16 });
          doc.moveDown(0.1);
          continue;
        } else if (inBlockquote) {
          inBlockquote = false;
          doc.moveDown(0.3);
        }

        // Bold line (standalone)
        if (/^\*\*.*\*\*$/.test(trimmed)) {
          checkPageBreak(18);
          const text = trimmed.replace(/\*\*/g, '');
          doc.fontSize(10).font('Helvetica-Bold').fillColor(colors.text).text(text);
          doc.moveDown(0.2);
          continue;
        }

        // Empty line
        if (trimmed === '') {
          doc.moveDown(0.3);
          continue;
        }

        // Regular text (handle inline bold/italic)
        checkPageBreak(16);
        const plainText = trimmed
          .replace(/\*\*([^*]+)\*\*/g, '$1')
          .replace(/\*([^*]+)\*/g, '$1')
          .replace(/`([^`]+)`/g, '$1');

        // Detect if this line starts with a bullet or arrow
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          doc.fontSize(9).font('Helvetica').fillColor(colors.text)
            .text(`  •  ${plainText.slice(2)}`, { width: pageWidth });
        } else if (trimmed.startsWith('→ ')) {
          doc.fontSize(9).font('Helvetica').fillColor(colors.accent)
            .text(`  →  ${plainText.slice(2)}`, { width: pageWidth });
        } else {
          doc.fontSize(9).font('Helvetica').fillColor(colors.text)
            .text(plainText, { width: pageWidth });
        }
        doc.moveDown(0.1);
      }

      // Flush any remaining table
      if (inTable) flushTable();

      // Footer on every page
      const pages = doc.bufferedPageRange();
      for (let i = 0; i < pages.count; i++) {
        doc.switchToPage(i);
        doc.fontSize(7).font('Helvetica').fillColor(colors.muted)
          .text(
            'SAP — Self-Study Assistance Program — TopTutors.ai',
            50,
            doc.page.height - 40,
            { width: pageWidth, align: 'center' },
          );
      }

      doc.end();
    });
  }

  // ============ SAP Report Context ============

  /**
   * Detects which SAP report type the user is requesting and returns
   * the relevant template + demo example to inject into the prompt.
   * Returns null if the message doesn't look like a report request.
   */
  private getSapReportContext(userMessage: string): string | null {
    const msg = userMessage.toLowerCase();

    const isReportRequest = /generate\s+report|create\s+report|make\s+report|build\s+report|report\s+for|generate\s+pdf/i.test(msg);
    if (!isReportRequest) return null;

    const parts: string[] = [
      '[SAP REPORT GENERATION CONTEXT]\n',
      'Generate a report following the EXACT structure, tone, formatting, and level of detail of the demo report below.',
      'Replace the demo data with real data from the uploaded study materials / questions.',
      'For learning streaks specifically: if no streak data is provided, keep the demo streak values as realistic placeholders.\n',
    ];

    const isTeacher = /teacher/i.test(msg);
    const isAdmin = /admin|administrator|principal/i.test(msg);
    const isAll = /\ball\b/i.test(msg);

    if (isAll) {
      parts.push('=== STUDENT REPORT DEMO ===', DEMO_STUDENT_REPORT, '');
      parts.push('=== TEACHER REPORT DEMO ===', DEMO_TEACHER_REPORT, '');
      parts.push('=== ADMIN REPORT DEMO ===', DEMO_ADMIN_REPORT, '');
    } else if (isTeacher) {
      parts.push('=== TEACHER REPORT DEMO ===', DEMO_TEACHER_REPORT, '');
    } else if (isAdmin) {
      parts.push('=== ADMIN REPORT DEMO ===', DEMO_ADMIN_REPORT, '');
    } else {
      parts.push('=== STUDENT REPORT DEMO ===', DEMO_STUDENT_REPORT, '');
    }

    parts.push('[END OF SAP CONTEXT]');
    return parts.join('\n');
  }

  // ============ Helpers ============

  private isSapProject(project: any): boolean {
    return project.title?.trim().toLowerCase() === 'sap';
  }

  /**
   * Check if the LLM response actually contains a report (not just a refusal).
   * Real reports are long and have markdown headings/tables.
   */
  private looksLikeReport(content: string): boolean {
    if (content.length < 500) return false;
    const headingCount = (content.match(/^#{1,3}\s+/gm) || []).length;
    return headingCount >= 3;
  }

  private buildProjectSystemPrompt(project: any): string {
    const isSap = this.isSapProject(project);

    const sapInstructions = isSap
      ? '\n\nThis is a SAP (School Assessment & Performance) project. When the user asks to generate a report, a demo report will be injected into the prompt — follow its exact structure, tone, and formatting. Replace demo data with real data from uploaded materials.'
      : '';

    const resolved = this.llm.resolvePrompt('project-chat', {
      title: project.title,
      description: project.description ? `Description: ${project.description}` : '',
      aiSystemPrompt: project.aiSystemPrompt
        ? `Student's custom instructions for you:\n${project.aiSystemPrompt}${sapInstructions}`
        : isSap
          ? sapInstructions
          : '',
    });

    return resolved.systemPrompt!;
  }

  private buildProjectContextSuffix(project: any): string {
    const parts: string[] = [];
    if (project.title) parts.push(`Project: "${project.title}"`);
    if (project.description) parts.push(`Description: ${project.description}`);
    if (project.aiSystemPrompt) parts.push(`Custom instructions: ${project.aiSystemPrompt}`);
    if (parts.length === 0) return '';
    return `\n\n[Project Context]\n${parts.join('\n')}`;
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

    // Add inline attachments (images/PDFs/text/docs sent with the message)
    if (attachments) {
      for (const file of attachments) {
        if (file.mimetype === 'text/plain') {
          const textContent = file.buffer.toString('utf-8');
          parts.push({ text: `[File: ${file.originalname}]\n${textContent}` });
        } else if (
          file.mimetype.startsWith('image/') ||
          file.mimetype === 'application/pdf' ||
          file.mimetype === 'application/msword' ||
          file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ) {
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
      source: 'project',
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

  private formatLinkedSession(session: any, projectId: string): ProjectChatSessionResponse {
    const result: ProjectChatSessionResponse = {
      id: session.id,
      projectId,
      title: session.title ? `${session.title}` : 'LLM Chat Session',
      lastMessageAt: session.lastMessageAt,
      createdAt: session.createdAt,
      source: 'llm-chat',
    };

    if (session._count) {
      result.messageCount = session._count.ai_messages;
    }

    if (session.ai_messages?.[0]) {
      result.lastMessage = {
        content: session.ai_messages[0].content,
        role: session.ai_messages[0].role,
        createdAt: session.ai_messages[0].createdAt,
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
