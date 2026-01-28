import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { GeminiChatService } from './gemini-chat.service';
import { TutorSessionGateway } from './tutor-session.gateway';
import { v4 as uuidv4 } from 'uuid';

export interface TutorSessionSummary {
  sessionId: string;
  aiSessionId: string;
  summary: string;
  topic: string;
  subject: string;
  keywords: string[];
  messageCount: number;
  student: {
    id: string;
    name: string;
    avatar?: string;
  };
  createdAt: Date;
  liveSharingEnabled: boolean;
}

export interface ChatMessage {
  id: string;
  role: string;
  content: string;
  attachments?: any[];
  createdAt: Date;
}

@Injectable()
export class TutorSessionService {
  private readonly logger = new Logger(TutorSessionService.name);
  private readonly dailyApiKey: string | undefined;
  private readonly dailyDomain: string | undefined;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly geminiChatService: GeminiChatService,
    @Optional() @Inject(TutorSessionGateway) private readonly tutorSessionGateway?: TutorSessionGateway,
  ) {
    this.dailyApiKey = this.configService.get<string>('DAILY_API_KEY');
    this.dailyDomain = this.configService.get<string>('DAILY_DOMAIN');
  }

  // ============ Request Tutor with Full Chat Analysis ============

  /**
   * Request a tutor - analyzes entire AI conversation to generate summary
   */
  async requestTutorWithFullAnalysis(
    userId: string,
    aiSessionId: string,
    urgency: string = 'NORMAL',
  ): Promise<{
    success: boolean;
    tutorSessionId: string;
    summary: string;
    topic: string;
    subject: string;
  }> {
    // Get the AI session with all messages
    const aiSession = await this.prisma.ai_chat_sessions.findFirst({
      where: { id: aiSessionId, userId },
      include: {
        ai_messages: {
          orderBy: { createdAt: 'asc' },
          where: { role: { in: ['USER', 'ASSISTANT'] } },
        },
        users: {
          select: { name: true, email: true },
        },
      },
    });

    if (!aiSession) {
      throw new NotFoundException('AI session not found');
    }

    if (aiSession.tutorRequestStatus && 
        !['NONE', 'CANCELLED'].includes(aiSession.tutorRequestStatus)) {
      throw new BadRequestException('Tutor already requested for this session');
    }

    // Get student profile
    const student = await this.prisma.students.findUnique({
      where: { userId },
    });

    if (!student) {
      throw new BadRequestException('Student profile required');
    }

    // Generate comprehensive summary from all messages
    const analysis = await this.analyzeFullConversation(aiSession.ai_messages);

    // Create message snapshot
    const messageSnapshot = aiSession.ai_messages.map((m: any) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      attachments: m.attachments,
      createdAt: m.createdAt,
    }));

    // Create tutor session
    const tutorSession = await this.prisma.tutor_sessions.create({
      data: {
        id: uuidv4(),
        aiSessionId,
        // tutorId is null until a tutor accepts
        studentId: student.id,
        status: 'PENDING',
        summary: analysis.summary,
        detectedTopic: analysis.topic,
        detectedSubject: analysis.subject as any,
        keywords: analysis.keywords,
        messageSnapshot,
        snapshotMessageCount: aiSession.ai_messages.length,
      },
    });

    // Update AI session
    await this.prisma.ai_chat_sessions.update({
      where: { id: aiSessionId },
      data: {
        tutorRequestStatus: 'REQUESTED',
        tutorRequestedAt: new Date(),
        tutorSummary: analysis.summary,
        tutorSummaryGeneratedAt: new Date(),
        messageSnapshotCount: aiSession.ai_messages.length,
        subject: analysis.subject as any,
      },
    });

    // Create conversation for tutor matching (existing flow)
    const conversation = await this.prisma.conversations.create({
      data: {
        id: uuidv4(),
        studentId: student.id,
        subject: analysis.subject as any,
        topic: analysis.topic,
        keywords: analysis.keywords,
        urgency: urgency as any,
        status: 'PENDING',
        updatedAt: new Date(),
      },
    });

    // Link conversation to AI session
    await this.prisma.ai_chat_sessions.update({
      where: { id: aiSessionId },
      data: { linkedConversationId: conversation.id },
    });

    // Create initial message with context for tutors
    await this.prisma.messages.create({
      data: {
        id: uuidv4(),
        conversationId: conversation.id,
        senderId: student.id,
        senderType: 'STUDENT',
        content: `📚 **Help Request from AI Chat**\n\n**Topic:** ${analysis.topic}\n**Subject:** ${analysis.subject}\n\n**Summary:**\n${analysis.summary}\n\n---\n*This student has been chatting with AI and needs human tutor assistance.*`,
        messageType: 'TEXT',
      },
    });

    // Notify tutors about the new request
    if (this.tutorSessionGateway) {
      await this.notifyTutorsOfNewRequest(tutorSession.id, analysis, student);
    }

    this.logger.log(`Tutor session created: ${tutorSession.id} for AI session: ${aiSessionId}`);

    return {
      success: true,
      tutorSessionId: tutorSession.id,
      summary: analysis.summary,
      topic: analysis.topic,
      subject: analysis.subject,
    };
  }

  /**
   * Analyze full conversation using Gemini
   */
  private async analyzeFullConversation(messages: any[]): Promise<{
    summary: string;
    topic: string;
    subject: string;
    keywords: string[];
  }> {
    if (!messages || messages.length === 0) {
      return {
        summary: 'No conversation history available.',
        topic: 'General Help',
        subject: 'GENERAL',
        keywords: [],
      };
    }

    // Format messages for analysis
    const conversationText = messages
      .map((m: any) => `[${m.role}]: ${m.content || '[attachment]'}`)
      .join('\n\n');

    try {
      // Use the GeminiChatService's model detection
      const model = await (this.geminiChatService as any).getWorkingModel();

      const prompt = `Analyze this student-AI conversation and provide:
1. A comprehensive summary (2-3 paragraphs) explaining what the student is struggling with
2. The main topic they need help with (concise, 5-10 words)
3. The academic subject (one of: MATHEMATICS, PHYSICS, CHEMISTRY, BIOLOGY, ENGLISH, HISTORY, GEOGRAPHY, COMPUTER_SCIENCE, ECONOMICS, SOCIAL, HUMANITIES, ARTS, ACCOUNTING, GENERAL)
4. Key keywords/concepts mentioned (up to 5)

Conversation:
${conversationText.slice(0, 10000)}

Respond in JSON format:
{
  "summary": "detailed summary here",
  "topic": "main topic",
  "subject": "SUBJECT_NAME",
  "keywords": ["keyword1", "keyword2"]
}`;

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();
      
      // Parse JSON response
      const cleanedResponse = responseText.replace(/```json\n?|\n?```/g, '').trim();
      const parsed = JSON.parse(cleanedResponse);

      const validSubjects = [
        'MATHEMATICS', 'PHYSICS', 'CHEMISTRY', 'BIOLOGY', 'ENGLISH',
        'HISTORY', 'GEOGRAPHY', 'COMPUTER_SCIENCE', 'ECONOMICS', 'SOCIAL', 'HUMANITIES', 'ARTS', 'ACCOUNTING', 'GENERAL',
      ];

      return {
        summary: parsed.summary || 'Unable to generate summary.',
        topic: parsed.topic || 'General Help Request',
        subject: validSubjects.includes(parsed.subject?.toUpperCase()) 
          ? parsed.subject.toUpperCase() 
          : 'GENERAL',
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 5) : [],
      };
    } catch (error: any) {
      this.logger.error(`Failed to analyze conversation: ${error.message}`);
      
      // Fallback to basic analysis
      return {
        summary: `Student has been discussing topics with AI assistant and needs human tutor help. The conversation includes ${messages.length} messages.`,
        topic: 'Help Request',
        subject: 'GENERAL',
        keywords: [],
      };
    }
  }

  // ============ Tutor Accepts Session ============

  /**
   * Tutor accepts a session - gets summary and chat access
   */
  async tutorAcceptSession(
    tutorUserId: string,
    tutorSessionId: string,
  ): Promise<{
    session: any;
    summary: TutorSessionSummary;
    chatHistory: ChatMessage[];
    dailyRoom?: { url: string; token: string };
  }> {
    // Get tutor profile
    const tutor = await this.prisma.tutors.findUnique({
      where: { userId: tutorUserId },
    });

    if (!tutor) {
      throw new NotFoundException('Tutor profile not found');
    }

    // Get tutor session
    const session = await this.prisma.tutor_sessions.findUnique({
      where: { id: tutorSessionId },
      include: {
        ai_chat_sessions: {
          include: {
            users: { select: { id: true, name: true, avatar: true } },
          },
        },
        students: {
          include: {
            users: { select: { id: true, name: true, avatar: true } },
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('Tutor session not found');
    }

    if (session.status !== 'PENDING') {
      throw new BadRequestException('Session is no longer available');
    }

    // Create Daily.co room for the session
    this.logger.log('Creating Daily.co room...');
    const dailyRoom = await this.createDailyRoom(tutorSessionId);
    this.logger.log(`Daily.co room created: ${!!dailyRoom}, URL: ${dailyRoom?.url}`);

    // Update session with tutor info
    await this.prisma.tutor_sessions.update({
      where: { id: tutorSessionId },
      data: {
        tutorId: tutor.id,
        status: 'ACCEPTED',
        acceptedAt: new Date(),
        dailyRoomName: dailyRoom?.name,
        dailyRoomUrl: dailyRoom?.url,
        dailyRoomToken: dailyRoom?.token,
        whiteboardRoomId: uuidv4(), // Generate whiteboard room ID
      },
    });

    // Update AI session status
    await this.prisma.ai_chat_sessions.update({
      where: { id: session.aiSessionId },
      data: {
        tutorRequestStatus: 'TUTOR_CONNECTED',
      },
    });

    // Mark tutor as busy
    await this.prisma.tutors.update({
      where: { id: tutor.id },
      data: {
        isBusy: true,
        currentConversationId: session.ai_chat_sessions.linkedConversationId,
      },
    });

    // Notify student about tutor acceptance
    this.logger.log(`Tutor session gateway available: ${!!this.tutorSessionGateway}`);
    if (this.tutorSessionGateway) {
      this.logger.log('Emitting tutorAccepted event...');
      const tutorUser = await this.prisma.user.findUnique({
        where: { id: tutor.userId },
        select: { name: true, avatar: true },
      });

      // Get student userId from the AI session
      const aiSession = await this.prisma.ai_chat_sessions.findUnique({
        where: { id: session.aiSessionId },
        select: { userId: true },
      });

      await this.tutorSessionGateway.notifyTutorAccepted(
        session.aiSessionId,
        {
          id: tutor.id, // Include tutor ID
          name: tutorUser?.name || tutor.bio || 'Tutor',
          avatar: tutorUser?.avatar || undefined,
        },
        tutorSessionId,
        dailyRoom?.url,
        aiSession?.userId, // ⭐ NEW: Pass student userId for direct notification
      );
      this.logger.log(`Emitted tutorAccepted to ai:${session.aiSessionId}`);

      // Notify about session status change
      await this.tutorSessionGateway.notifySessionStatusChanged(
        tutorSessionId,
        session.aiSessionId,
        'ACCEPTED',
      );
      this.logger.log(`Emitted sessionStatusChanged for session ${tutorSessionId}`);
    } else {
      this.logger.error('TutorSessionGateway not available - events not emitted!');
    }

    // Get chat history (snapshot or live based on consent)
    const chatHistory = this.formatChatHistory((session.messageSnapshot as any[]) || []);

    return {
      session: this.formatSession(session),
      summary: {
        sessionId: session.id,
        aiSessionId: session.aiSessionId,
        summary: session.summary || '',
        topic: session.detectedTopic || '',
        subject: session.detectedSubject || '',
        keywords: session.keywords,
        messageCount: session.snapshotMessageCount || 0,
        student: {
          id: session.students?.id,
          name: session.students?.users?.name || 'Student',
          avatar: session.students?.users?.avatar || undefined,
        },
        createdAt: session.createdAt,
        liveSharingEnabled: session.liveSharingConsent,
      },
      chatHistory,
      dailyRoom: dailyRoom ? { url: dailyRoom.url, token: dailyRoom.token } : undefined,
    };
  }

  // ============ Live Chat Access ============

  /**
   * Get current AI chat history (respects consent)
   */
  async getChatHistoryForTutor(
    tutorUserId: string,
    tutorSessionId: string,
  ): Promise<{
    messages: ChatMessage[];
    liveSharingEnabled: boolean;
    lastUpdated: Date;
  }> {
    const tutor = await this.prisma.tutors.findUnique({
      where: { userId: tutorUserId },
    });

    if (!tutor) {
      throw new NotFoundException('Tutor not found');
    }

    const session = await this.prisma.tutor_sessions.findFirst({
      where: { id: tutorSessionId, tutorId: tutor.id },
      include: {
        ai_chat_sessions: {
          include: {
            ai_messages: {
              orderBy: { createdAt: 'asc' },
              where: { role: { in: ['USER', 'ASSISTANT'] } },
            },
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    // If live sharing is enabled, return live messages
    if (session.liveSharingConsent) {
      const liveMessages = session.ai_chat_sessions.ai_messages.map((m: any) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        attachments: m.attachments,
        createdAt: m.createdAt,
      }));

      return {
        messages: liveMessages,
        liveSharingEnabled: true,
        lastUpdated: new Date(),
      };
    }

    // Otherwise return snapshot
    return {
      messages: (session.messageSnapshot as any as ChatMessage[]) || [],
      liveSharingEnabled: false,
      lastUpdated: session.createdAt,
    };
  }

  // ============ Student Consent Management ============

  /**
   * Student updates live sharing consent
   */
  async updateLiveSharingConsent(
    userId: string,
    aiSessionId: string,
    enabled: boolean,
  ): Promise<{ success: boolean; liveSharingEnabled: boolean }> {
    const session = await this.prisma.ai_chat_sessions.findFirst({
      where: { id: aiSessionId, userId },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    // Update AI session
    await this.prisma.ai_chat_sessions.update({
      where: { id: aiSessionId },
      data: {
        liveSharingEnabled: enabled,
        liveSharingEnabledAt: enabled ? new Date() : null,
      },
    });

    // Also update any active tutor session
    await this.prisma.tutor_sessions.updateMany({
      where: { 
        aiSessionId,
        status: { in: ['ACCEPTED', 'ACTIVE'] },
      },
      data: {
        liveSharingConsent: enabled,
        liveSharingConsentAt: enabled ? new Date() : null,
      },
    });

    this.logger.log(`Live sharing ${enabled ? 'enabled' : 'disabled'} for session ${aiSessionId}`);

    return { success: true, liveSharingEnabled: enabled };
  }

  /**
   * Get consent status for a session
   */
  async getConsentStatus(
    userId: string,
    aiSessionId: string,
  ): Promise<{
    liveSharingEnabled: boolean;
    tutorConnected: boolean;
    tutorName?: string;
  }> {
    const session = await this.prisma.ai_chat_sessions.findFirst({
      where: { id: aiSessionId, userId },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    // Check for active tutor session
    const tutorSession = await this.prisma.tutor_sessions.findFirst({
      where: {
        aiSessionId,
        status: { in: ['ACCEPTED', 'ACTIVE'] },
      },
      include: {
        tutors: {
          include: {
            users: { select: { name: true } },
          },
        },
      },
    });

    return {
      liveSharingEnabled: session.liveSharingEnabled,
      tutorConnected: !!tutorSession,
      tutorName: tutorSession?.tutors?.users?.name || undefined,
    };
  }

  // ============ PDF Generation ============

  /**
   * Generate PDF of chat history
   */
  async generateChatPDF(
    tutorUserId: string,
    tutorSessionId: string,
  ): Promise<{
    content: string;
    filename: string;
    mimeType: string;
  }> {
    const tutor = await this.prisma.tutors.findUnique({
      where: { userId: tutorUserId },
    });

    if (!tutor) {
      throw new NotFoundException('Tutor not found');
    }

    const session = await this.prisma.tutor_sessions.findFirst({
      where: { id: tutorSessionId, tutorId: tutor.id },
      include: {
        students: {
          include: {
            users: { select: { name: true } },
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    // Get messages (respects consent)
    const { messages } = await this.getChatHistoryForTutor(tutorUserId, tutorSessionId);

    // Generate markdown content (can be converted to PDF by frontend)
    const content = this.generateMarkdownContent(session, messages);

    return {
      content,
      filename: `chat-session-${tutorSessionId.slice(0, 8)}.md`,
      mimeType: 'text/markdown',
    };
  }

  private generateMarkdownContent(session: any, messages: ChatMessage[]): string {
    const studentName = session.students?.users?.name || 'Student';
    const date = new Date(session.createdAt).toLocaleDateString();

    let content = `# AI Chat Session Summary\n\n`;
    content += `**Student:** ${studentName}\n`;
    content += `**Date:** ${date}\n`;
    content += `**Topic:** ${session.detectedTopic || 'N/A'}\n`;
    content += `**Subject:** ${session.detectedSubject || 'General'}\n\n`;
    content += `---\n\n`;
    content += `## Summary\n\n${session.summary || 'No summary available.'}\n\n`;
    content += `---\n\n`;
    content += `## Conversation History\n\n`;

    for (const msg of messages) {
      const role = msg.role === 'USER' ? '👤 Student' : '🤖 AI Assistant';
      const time = new Date(msg.createdAt).toLocaleTimeString();
      content += `### ${role} (${time})\n\n`;
      content += `${msg.content || '[Attachment]'}\n\n`;
    }

    return content;
  }

  // ============ Daily.co Room Management ============

  /**
   * Create a Daily.co room for the session
   */
  private async createDailyRoom(sessionId: string): Promise<{
    name: string;
    url: string;
    token: string;
  } | null> {
    if (!this.dailyApiKey || !this.dailyDomain) {
      this.logger.warn('Daily.co not configured, skipping room creation');
      return null;
    }

    try {
      const roomName = `tutor-${sessionId.slice(0, 8)}-${Date.now()}`;

      this.logger.log(`Creating Daily.co room: ${roomName}`);

      // Create room via Daily.co API
      const response = await fetch('https://api.daily.co/v1/rooms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.dailyApiKey}`,
        },
        body: JSON.stringify({
          name: roomName,
          privacy: 'private',
          properties: {
            enable_chat: true,
            enable_screenshare: true,
            enable_recording: 'local',
            exp: Math.floor(Date.now() / 1000) + 7200, // 2 hours
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Daily.co room creation failed: ${response.status} - ${errorText}`);
        throw new Error(`Daily.co API error: ${response.status}`);
      }

      const room = await response.json();
      this.logger.log(`Daily.co room created successfully: ${room.name} - ${room.url}`);

      // Create meeting token for tutor (host privileges)
      const tokenResponse = await fetch('https://api.daily.co/v1/meeting-tokens', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.dailyApiKey}`,
        },
        body: JSON.stringify({
          properties: {
            room_name: roomName,
            is_owner: true,
            enable_screenshare: true,
            start_video_off: false,
            start_audio_off: false,
          },
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error(`Daily.co token error: ${tokenResponse.status}`);
      }

      const tokenData = await tokenResponse.json();

      return {
        name: roomName,
        url: room.url,
        token: tokenData.token,
      };
    } catch (error: any) {
      this.logger.error(`Failed to create Daily.co room: ${error.message}`);
      return null;
    }
  }

  /**
   * Get room token for student
   */
  async getStudentRoomToken(
    userId: string,
    tutorSessionId: string,
  ): Promise<{ url: string; token: string } | null> {
    if (!this.dailyApiKey) {
      return null;
    }

    const student = await this.prisma.students.findUnique({
      where: { userId },
    });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    const session = await this.prisma.tutor_sessions.findFirst({
      where: { id: tutorSessionId, studentId: student.id },
    });

    if (!session || !session.dailyRoomName) {
      throw new NotFoundException('Session or room not found');
    }

    try {
      const tokenResponse = await fetch('https://api.daily.co/v1/meeting-tokens', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.dailyApiKey}`,
        },
        body: JSON.stringify({
          properties: {
            room_name: session.dailyRoomName,
            is_owner: false,
            enable_screenshare: true,
          },
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error(`Daily.co token error: ${tokenResponse.status}`);
      }

      const tokenData = await tokenResponse.json();

      return {
        url: session.dailyRoomUrl!,
        token: tokenData.token,
      };
    } catch (error: any) {
      this.logger.error(`Failed to get student token: ${error.message}`);
      return null;
    }
  }

  // ============ Session Management ============

  /**
   * Start a session (tutor clicks start)
   */
  async startSession(
    tutorUserId: string,
    tutorSessionId: string,
  ): Promise<any> {
    const tutor = await this.prisma.tutors.findUnique({
      where: { userId: tutorUserId },
    });

    if (!tutor) {
      throw new NotFoundException('Tutor not found');
    }

    const session = await this.prisma.tutor_sessions.findFirst({
      where: { id: tutorSessionId, tutorId: tutor.id },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (session.status !== 'ACCEPTED') {
      throw new BadRequestException('Session must be accepted first');
    }

    await this.prisma.tutor_sessions.update({
      where: { id: tutorSessionId },
      data: {
        status: 'ACTIVE',
        startedAt: new Date(),
        callStartedAt: new Date(),
      },
    });

    // Notify about session status change
    if (this.tutorSessionGateway) {
      await this.tutorSessionGateway.notifySessionStatusChanged(
        tutorSessionId,
        session.aiSessionId,
        'ACTIVE',
      );
    }

    return { success: true, status: 'ACTIVE' };
  }

  /**
   * End a session
   */
  async endSession(
    tutorUserId: string,
    tutorSessionId: string,
  ): Promise<any> {
    const tutor = await this.prisma.tutors.findUnique({
      where: { userId: tutorUserId },
    });

    if (!tutor) {
      throw new NotFoundException('Tutor not found');
    }

    const session = await this.prisma.tutor_sessions.findFirst({
      where: { id: tutorSessionId, tutorId: tutor.id },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    const callDuration = session.callStartedAt
      ? Math.floor((Date.now() - new Date(session.callStartedAt).getTime()) / 1000)
      : 0;

    await this.prisma.tutor_sessions.update({
      where: { id: tutorSessionId },
      data: {
        status: 'COMPLETED',
        endedAt: new Date(),
        callEndedAt: new Date(),
        callDuration,
      },
    });

    // Update AI session
    await this.prisma.ai_chat_sessions.updateMany({
      where: { id: session.aiSessionId },
      data: {
        tutorRequestStatus: 'NONE',
      },
    });

    // Notify about session status change
    if (this.tutorSessionGateway) {
      await this.tutorSessionGateway.notifySessionStatusChanged(
        tutorSessionId,
        session.aiSessionId,
        'COMPLETED',
      );
    }

    // Mark tutor as available
    await this.prisma.tutors.update({
      where: { id: tutor.id },
      data: {
        isBusy: false,
        currentConversationId: null,
      },
    });

    return { success: true, status: 'COMPLETED', duration: callDuration };
  }

  /**
   * Save whiteboard data
   */
  async saveWhiteboardData(
    tutorUserId: string,
    tutorSessionId: string,
    whiteboardData: any,
  ): Promise<{ success: boolean }> {
    const tutor = await this.prisma.tutors.findUnique({
      where: { userId: tutorUserId },
    });

    if (!tutor) {
      throw new NotFoundException('Tutor not found');
    }

    await this.prisma.tutor_sessions.updateMany({
      where: { id: tutorSessionId, tutorId: tutor.id },
      data: {
        whiteboardData,
        whiteboardEnabled: true,
      },
    });

    return { success: true };
  }

  /**
   * Get pending sessions for tutor
   */
  async getPendingSessions(tutorUserId: string): Promise<any[]> {
    const tutor = await this.prisma.tutors.findUnique({
      where: { userId: tutorUserId },
      select: { id: true, subjects: true },
    });

    if (!tutor) {
      return [];
    }

    const sessions = await this.prisma.tutor_sessions.findMany({
      where: {
        status: 'PENDING',
        detectedSubject: { in: tutor.subjects },
      },
      include: {
        students: {
          include: {
            users: { select: { name: true, avatar: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return sessions.map((s: any) => ({
      id: s.id,
      topic: s.detectedTopic,
      subject: s.detectedSubject,
      summary: s.summary?.slice(0, 200) + (s.summary?.length > 200 ? '...' : ''),
      messageCount: s.snapshotMessageCount,
      student: {
        name: s.students?.users?.name,
        avatar: s.students?.users?.avatar,
      },
      createdAt: s.createdAt,
    }));
  }

  // ============ Tutor Notification ============

  /**
   * Notify available tutors about the new tutor session request
   */
  private async notifyTutorsOfNewRequest(
    tutorSessionId: string,
    analysis: { topic: string; subject: string; summary: string },
    student: any,
  ) {
    try {
      // Get available tutors for this subject
      const availableTutors = await this.prisma.tutors.findMany({
        where: {
          isAvailable: true,
          isVerified: true,
          isBusy: false,
          subjects: {
            has: analysis.subject as any,
          },
        },
        select: {
          id: true,
          userId: true,
        },
      });

      if (availableTutors.length === 0) {
        this.logger.warn(`No available tutors found for subject: ${analysis.subject}`);
        return;
      }

      const tutorIds = availableTutors.map((t: any) => t.userId);

      // Get student name
      const studentUser = await this.prisma.user.findUnique({
        where: { id: student.userId },
        select: { name: true },
      });

      const studentName = studentUser?.name || 'Student';

      // Notify tutors via WebSocket
      if (this.tutorSessionGateway) {
        await this.tutorSessionGateway.notifyTutorsOfNewRequest(tutorIds, {
          tutorSessionId,
          topic: analysis.topic,
          subject: analysis.subject as any,
          summary: analysis.summary,
          studentName,
        });
      }

      this.logger.log(`Notified ${tutorIds.length} tutors about session ${tutorSessionId}`);
    } catch (error: any) {
      this.logger.error(`Failed to notify tutors: ${error.message}`);
    }
  }

  // ============ Admin/Debug Methods ============

  /**
   * Fix tutor busy status inconsistencies
   * Marks tutors as available if they have no active sessions
   */
  async fixTutorStatusInconsistencies(): Promise<{ fixed: number; total: number }> {
    // Find tutors marked as busy
    const busyTutors = await this.prisma.tutors.findMany({
      where: {
        isBusy: true,
      },
      select: {
        id: true,
        userId: true,
      },
    });

    let fixed = 0;

    for (const tutor of busyTutors) {
      // Check if tutor has any active sessions
      const activeSessions = await this.prisma.tutor_sessions.findMany({
        where: {
          tutorId: tutor.id,
          status: { in: ['ACCEPTED', 'ACTIVE'] },
        },
      });

      // If no active sessions, mark as available
      if (activeSessions.length === 0) {
        await this.prisma.tutors.update({
          where: { id: tutor.id },
          data: {
            isBusy: false,
            currentConversationId: null,
          },
        });
        fixed++;
        this.logger.log(`Fixed tutor ${tutor.userId} - marked as available`);
      }
    }

    return { fixed, total: busyTutors.length };
  }

  // ============ Daily.co Meeting Data Management ============

  /**
   * Save Daily.co meeting data (chat messages, recording, participants) when meeting ends
   */
  async saveDailyMeetingData(
    sessionId: string,
    meetingData: {
      roomUrl?: string;
      chatMessages?: any[];
      recordingUrl?: string;
      duration?: number;
      participants?: any[];
    }
  ): Promise<{ success: boolean }> {
    try {
      // Find the tutor session by ID
      const session = await this.prisma.tutor_sessions.findUnique({
        where: { id: sessionId },
      });

      if (!session) {
        throw new NotFoundException('Tutor session not found');
      }

      // Update the session with meeting data
      await this.prisma.tutor_sessions.update({
        where: { id: sessionId },
        data: {
          dailyChatMessages: meetingData.chatMessages || undefined,
          dailyRecordingUrl: meetingData.recordingUrl || undefined,
          dailyParticipants: meetingData.participants || undefined,
          // Update duration if provided and not already set
          callDuration: meetingData.duration || session.callDuration,
          // Update call end time if not already set
          callEndedAt: session.callEndedAt || new Date(),
        },
      });

      this.logger.log(`Daily.co meeting data saved for session ${sessionId}`);
      return { success: true };
    } catch (error: any) {
      this.logger.error(`Failed to save Daily.co meeting data: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get Daily.co meeting data for a session
   */
  async getDailyMeetingData(
    userId: string,
    sessionId: string,
  ): Promise<{
    chatMessages: any[];
    recordingUrl?: string;
    participants: any[];
    duration?: number;
    roomUrl?: string;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Find session based on user role
    let session: any;
    if (user.role === 'TUTOR') {
      const tutor = await this.prisma.tutors.findUnique({
        where: { userId },
        select: { id: true },
      });
      session = await this.prisma.tutor_sessions.findFirst({
        where: { id: sessionId, tutorId: tutor?.id },
      });
    } else {
      const student = await this.prisma.students.findUnique({
        where: { userId },
        select: { id: true },
      });
      session = await this.prisma.tutor_sessions.findFirst({
        where: { id: sessionId, studentId: student?.id },
      });
    }

    if (!session) {
      throw new NotFoundException('Session not found or access denied');
    }

    return {
      chatMessages: (session.dailyChatMessages as any[]) || [],
      recordingUrl: session.dailyRecordingUrl || undefined,
      participants: (session.dailyParticipants as any[]) || [],
      duration: session.callDuration || undefined,
      roomUrl: session.dailyRoomUrl || undefined,
    };
  }

  // ============ Helper Methods ============

  private formatSession(session: any): any {
    return {
      id: session.id,
      aiSessionId: session.aiSessionId,
      status: session.status,
      topic: session.detectedTopic,
      subject: session.detectedSubject,
      summary: session.summary,
      keywords: session.keywords,
      messageCount: session.snapshotMessageCount,
      liveSharingEnabled: session.liveSharingConsent,
      dailyRoomUrl: session.dailyRoomUrl,
      whiteboardRoomId: session.whiteboardRoomId,
      createdAt: session.createdAt,
      acceptedAt: session.acceptedAt,
    };
  }

  private formatChatHistory(messages: any[]): ChatMessage[] {
    return messages.map((m: any) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      attachments: m.attachments,
      createdAt: m.createdAt,
    }));
  }
}

