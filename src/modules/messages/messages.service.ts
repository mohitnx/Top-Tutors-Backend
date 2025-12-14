import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { PrismaService } from '../../prisma/prisma.service';
import {
  SendTextMessageDto,
  ClassificationResult,
  ConversationQueryDto,
  CloseConversationDto,
} from './dto/send-message.dto';
import { v4 as uuidv4 } from 'uuid';

// Processing status for frontend loading states
export enum ProcessingStatus {
  RECEIVING = 'RECEIVING',
  TRANSCRIBING = 'TRANSCRIBING',
  CLASSIFYING = 'CLASSIFYING',
  CREATING_CONVERSATION = 'CREATING_CONVERSATION',
  NOTIFYING_TUTORS = 'NOTIFYING_TUTORS',
  WAITING_FOR_TUTOR = 'WAITING_FOR_TUTOR',
  TUTOR_ASSIGNED = 'TUTOR_ASSIGNED',
  ALL_TUTORS_BUSY = 'ALL_TUTORS_BUSY',
  COMPLETE = 'COMPLETE',
  ERROR = 'ERROR',
}

export interface ProcessingUpdate {
  status: ProcessingStatus;
  message: string;
  progress?: number; // 0-100
  data?: any;
}

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);
  private genAI: GoogleGenerativeAI | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey.trim());
    }
  }

  /**
   * Send a text message - creates conversation if needed
   */
  async sendTextMessage(
    userId: string,
    userRole: string,
    dto: SendTextMessageDto,
    onStatusUpdate?: (update: ProcessingUpdate) => void,
  ) {
    const emitStatus = (status: ProcessingStatus, message: string, progress?: number, data?: any) => {
      if (onStatusUpdate) {
        onStatusUpdate({ status, message, progress, data });
      }
    };

    try {
      emitStatus(ProcessingStatus.RECEIVING, 'Receiving your message...', 10);

      // Get student/tutor profile
      const profileInfo = await this.getUserProfileInfo(userId, userRole);

      let conversation: any;
      let isNewConversation = false;

      if (dto.conversationId) {
        // Use existing conversation
        conversation = await this.getConversationById(dto.conversationId, userId, userRole);
      } else {
        // Create new conversation - classify the message first
        if (userRole !== 'STUDENT') {
          throw new BadRequestException('Only students can start new conversations');
        }

        emitStatus(ProcessingStatus.CLASSIFYING, 'Analyzing your question...', 30);
        const classification = await this.classifyMessage(dto.content);

        emitStatus(ProcessingStatus.CREATING_CONVERSATION, 'Creating your help session...', 50);
        conversation = await this.createConversation(profileInfo.profileId, classification);
        isNewConversation = true;
      }

      // Create the message
      const message = await this.createMessage({
        conversationId: conversation.id,
        senderId: profileInfo.profileId,
        senderType: this.getSenderType(userRole),
        content: dto.content,
        messageType: dto.messageType || 'TEXT',
      });

      // Update conversation status if tutor sends message
      if (userRole === 'TUTOR' && conversation.status === 'ASSIGNED') {
        await (this.prisma as any).conversations.update({
          where: { id: conversation.id },
          data: { status: 'ACTIVE', updatedAt: new Date() },
        });
        conversation.status = 'ACTIVE';

        // Mark tutor as busy
        await this.setTutorBusy(profileInfo.profileId, conversation.id);
      }

      // Fetch full conversation with relations
      const fullConversation = await this.getConversationWithRelations(conversation.id);

      if (isNewConversation) {
        emitStatus(ProcessingStatus.NOTIFYING_TUTORS, 'Finding the best tutor for you...', 70);
      }

      emitStatus(ProcessingStatus.COMPLETE, 'Message sent successfully!', 100);

      return {
        message,
        conversation: fullConversation,
        isNewConversation,
      };
    } catch (error: any) {
      emitStatus(ProcessingStatus.ERROR, error.message || 'An error occurred', 0);
      throw error;
    }
  }

  /**
   * Send an audio message with transcription and classification
   */
  async sendAudioMessage(
    userId: string,
    userRole: string,
    file: Express.Multer.File,
    conversationId?: string,
    onStatusUpdate?: (update: ProcessingUpdate) => void,
  ) {
    const emitStatus = (status: ProcessingStatus, message: string, progress?: number, data?: any) => {
      if (onStatusUpdate) {
        onStatusUpdate({ status, message, progress, data });
      }
    };

    try {
      emitStatus(ProcessingStatus.RECEIVING, 'Receiving your audio...', 10);

      const profileInfo = await this.getUserProfileInfo(userId, userRole);

      emitStatus(ProcessingStatus.TRANSCRIBING, 'Transcribing your voice message...', 25);

      // Transcribe the audio using Gemini
      const transcription = await this.transcribeAudio(file);

      let conversation: any;
      let isNewConversation = false;
      let classification: ClassificationResult | null = null;

      if (conversationId) {
        conversation = await this.getConversationById(conversationId, userId, userRole);
      } else {
        if (userRole !== 'STUDENT') {
          throw new BadRequestException('Only students can start new conversations');
        }

        emitStatus(ProcessingStatus.CLASSIFYING, 'Understanding your question...', 45);
        classification = await this.classifyMessage(transcription);

        emitStatus(
          ProcessingStatus.CREATING_CONVERSATION,
          `Found topic: ${classification.topic}. Creating help session...`,
          60,
          { classification },
        );
        conversation = await this.createConversation(profileInfo.profileId, classification);
        isNewConversation = true;
      }

      // Store audio file
      const audioUrl = await this.storeAudioFile(file);

      // Create the message
      const message = await this.createMessage({
        conversationId: conversation.id,
        senderId: profileInfo.profileId,
        senderType: this.getSenderType(userRole),
        content: null,
        messageType: 'AUDIO',
        audioUrl,
        audioDuration: Math.ceil(file.size / 16000),
        transcription,
      });

      const fullConversation = await this.getConversationWithRelations(conversation.id);

      if (isNewConversation) {
        emitStatus(ProcessingStatus.NOTIFYING_TUTORS, 'Connecting you with available tutors...', 80);
      }

      emitStatus(ProcessingStatus.COMPLETE, 'Audio message sent!', 100);

      return {
        message,
        classification,
        conversation: fullConversation,
        isNewConversation,
        transcription,
      };
    } catch (error: any) {
      emitStatus(ProcessingStatus.ERROR, error.message || 'Failed to process audio', 0);
      throw error;
    }
  }

  /**
   * Get available tutors for a subject with busy status info
   */
  async getAvailableTutorsForSubject(subject: string) {
    const tutors = await (this.prisma as any).tutors.findMany({
      where: {
        isVerified: true,
        isAvailable: true,
        subjects: {
          has: subject,
        },
      },
      include: {
        users: {
          select: { id: true, name: true, email: true, avatar: true },
        },
      },
      orderBy: [
        { isBusy: 'asc' },
        { rating: 'desc' },
        { experience: 'desc' },
      ],
    });

    const available = tutors.filter((t: any) => !t.isBusy);
    const busy = tutors.filter((t: any) => t.isBusy);

    return {
      available: available.map((t: any) => ({
        id: t.id,
        odID: t.users.id,
        name: t.users.name,
        avatar: t.users.avatar,
        rating: t.rating,
        subjects: t.subjects,
      })),
      busy: busy.map((t: any) => ({
        id: t.id,
        odID: t.users.id,
        name: t.users.name,
        busyUntil: t.busyUntil,
        estimatedWait: t.busyUntil ? this.formatTimeUntil(t.busyUntil) : 'Unknown',
      })),
      totalAvailable: available.length,
      totalBusy: busy.length,
    };
  }

  /**
   * Set tutor as busy
   */
  async setTutorBusy(tutorId: string, conversationId: string, busyUntil?: Date) {
    await (this.prisma as any).tutors.update({
      where: { id: tutorId },
      data: {
        isBusy: true,
        currentConversationId: conversationId,
        busyUntil: busyUntil || null,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Set tutor as available
   */
  async setTutorAvailable(tutorId: string) {
    await (this.prisma as any).tutors.update({
      where: { id: tutorId },
      data: {
        isBusy: false,
        currentConversationId: null,
        busyUntil: null,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Get pending conversations that match tutor's subjects
   * Used for tutor dashboard to show conversations they can potentially accept
   */
  async getPendingConversationsForTutor(userId: string) {
    // Get tutor profile with subjects
    const tutor = await (this.prisma as any).tutors.findFirst({
      where: {
        users: { id: userId },
      },
      select: {
        id: true,
        subjects: true,
        isBusy: true,
        currentConversationId: true,
      },
    });

    if (!tutor) {
      throw new BadRequestException('Tutor profile not found');
    }

    // Get pending conversations matching tutor's subjects
    const conversations = await (this.prisma as any).conversations.findMany({
      where: {
        status: 'PENDING',
        tutorId: null,
        subject: { in: tutor.subjects },
      },
      include: {
        students: {
          include: {
            users: { select: { id: true, name: true, email: true, avatar: true } },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Determine if tutor can currently accept
    const canAccept = !tutor.isBusy && !tutor.currentConversationId;

    return {
      conversations: conversations.map((c: any) => ({
        id: c.id,
        subject: c.subject,
        topic: c.topic,
        urgency: c.urgency,
        status: c.status,
        createdAt: c.createdAt,
        student: {
          id: c.students?.id,
          name: c.students?.users?.name,
          avatar: c.students?.users?.avatar,
        },
        lastMessage: c.messages[0]?.content || null,
        canAccept, // Whether tutor can accept right now
      })),
      tutorStatus: {
        isBusy: tutor.isBusy,
        hasActiveSession: !!tutor.currentConversationId,
        canAcceptNew: canAccept,
      },
    };
  }

  /**
   * Update tutor's busy until time
   */
  async updateTutorBusyUntil(tutorId: string, busyUntil: Date) {
    await (this.prisma as any).tutors.update({
      where: { id: tutorId },
      data: {
        busyUntil,
        updatedAt: new Date(),
      },
    });

    return { success: true, busyUntil };
  }

  /**
   * Get user's conversations
   */
  async getMyConversations(userId: string, userRole: string, query: ConversationQueryDto) {
    const profileInfo = await this.getUserProfileInfo(userId, userRole);
    const { page = 1, limit = 10, status } = query;
    const skip = (page - 1) * limit;

    const whereClause: any = {};

    if (userRole === 'STUDENT') {
      whereClause.studentId = profileInfo.profileId;
    } else if (userRole === 'TUTOR') {
      whereClause.tutorId = profileInfo.profileId;
    }

    if (status) {
      whereClause.status = status;
    }

    const [conversations, total] = await Promise.all([
      (this.prisma as any).conversations.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          students: {
            include: {
              users: {
                select: { name: true, email: true, avatar: true },
              },
            },
          },
          tutors: {
            include: {
              users: {
                select: { name: true, email: true, avatar: true },
              },
            },
          },
          messages: {
            take: 1,
            orderBy: { createdAt: 'desc' },
          },
        },
      }),
      (this.prisma as any).conversations.count({ where: whereClause }),
    ]);

    return {
      data: conversations.map((c: any) => this.formatConversation(c)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get pending conversations (admin only)
   */
  async getPendingConversations(query: ConversationQueryDto) {
    const { page = 1, limit = 10 } = query;
    const skip = (page - 1) * limit;

    const [conversations, total] = await Promise.all([
      (this.prisma as any).conversations.findMany({
        where: { status: 'PENDING' },
        skip,
        take: limit,
        orderBy: [
          { urgency: 'desc' },
          { createdAt: 'asc' },
        ],
        include: {
          students: {
            include: {
              users: {
                select: { name: true, email: true, avatar: true },
              },
            },
          },
          messages: {
            take: 1,
            orderBy: { createdAt: 'asc' },
          },
        },
      }),
      (this.prisma as any).conversations.count({ where: { status: 'PENDING' } }),
    ]);

    return {
      data: conversations.map((c: any) => this.formatConversation(c)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get single conversation with all messages
   */
  async getConversation(conversationId: string, userId: string, userRole: string) {
    const conversation = await this.getConversationById(conversationId, userId, userRole);

    const fullConversation = await (this.prisma as any).conversations.findUnique({
      where: { id: conversationId },
      include: {
        students: {
          include: {
            users: {
              select: { name: true, email: true, avatar: true },
            },
          },
        },
        tutors: {
          include: {
            users: {
              select: { name: true, email: true, avatar: true },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    return this.formatConversation(fullConversation, true);
  }

  /**
   * Assign tutor to conversation
   */
  async assignTutor(conversationId: string, tutorId: string) {
    const conversation = await (this.prisma as any).conversations.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (conversation.status !== 'PENDING') {
      throw new BadRequestException('Can only assign tutors to pending conversations');
    }

    // Verify tutor exists and get details
    const tutor = await (this.prisma as any).tutors.findUnique({
      where: { id: tutorId },
      include: {
        users: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!tutor) {
      throw new NotFoundException('Tutor not found');
    }

    // Update conversation
    const updatedConversation = await (this.prisma as any).conversations.update({
      where: { id: conversationId },
      data: {
        tutorId,
        status: 'ASSIGNED',
        updatedAt: new Date(),
      },
      include: {
        students: {
          include: {
            users: {
              select: { name: true, email: true, avatar: true },
            },
          },
        },
        tutors: {
          include: {
            users: {
              select: { name: true, email: true, avatar: true },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    // Mark tutor as busy
    await this.setTutorBusy(tutorId, conversationId);

    return {
      conversation: this.formatConversation(updatedConversation, true),
      tutor: {
        id: tutor.id,
        odID: tutor.users.id,
        name: tutor.users.name,
        email: tutor.users.email,
      },
    };
  }

  /**
   * Tutor accepts a conversation (self-assignment)
   */
  async tutorAcceptConversation(conversationId: string, tutorId: string, tutorUserId: string) {
    const conversation = await (this.prisma as any).conversations.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (conversation.status !== 'PENDING') {
      throw new BadRequestException('This conversation is no longer available');
    }

    // Verify tutor
    const tutor = await (this.prisma as any).tutors.findUnique({
      where: { id: tutorId },
      include: {
        users: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!tutor) {
      throw new NotFoundException('Tutor not found');
    }

    if (tutor.isBusy) {
      throw new BadRequestException('You are currently busy with another session');
    }

    // Assign tutor
    const updatedConversation = await (this.prisma as any).conversations.update({
      where: { id: conversationId },
      data: {
        tutorId,
        status: 'ASSIGNED',
        updatedAt: new Date(),
      },
      include: {
        students: {
          include: {
            users: {
              select: { id: true, name: true, email: true, avatar: true },
            },
          },
        },
        tutors: {
          include: {
            users: {
              select: { name: true, email: true, avatar: true },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    // Mark tutor as busy
    await this.setTutorBusy(tutorId, conversationId);

    // Expire other notifications for this conversation
    await (this.prisma as any).tutor_notifications.updateMany({
      where: {
        conversationId,
        tutorId: { not: tutorId },
        status: 'PENDING',
      },
      data: {
        status: 'EXPIRED',
      },
    });

    return {
      conversation: this.formatConversation(updatedConversation, true),
      student: {
        id: updatedConversation.students.id,
        odID: updatedConversation.students.users.id,
        name: updatedConversation.students.users.name,
        email: updatedConversation.students.users.email,
      },
    };
  }

  /**
   * Close conversation
   */
  async closeConversation(
    conversationId: string,
    userId: string,
    userRole: string,
    dto: CloseConversationDto,
  ) {
    const conversation = await this.getConversationById(conversationId, userId, userRole);

    if (!['ACTIVE', 'ASSIGNED'].includes(conversation.status)) {
      throw new BadRequestException('Can only close active or assigned conversations');
    }

    // If tutor is closing, mark them as available
    if (userRole === 'TUTOR' && conversation.tutorId) {
      await this.setTutorAvailable(conversation.tutorId);
    }

    const updatedConversation = await (this.prisma as any).conversations.update({
      where: { id: conversationId },
      data: {
        status: dto.status,
        updatedAt: new Date(),
      },
      include: {
        students: {
          include: {
            users: {
              select: { name: true, email: true, avatar: true },
            },
          },
        },
        tutors: {
          include: {
            users: {
              select: { name: true, email: true, avatar: true },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    return this.formatConversation(updatedConversation, true);
  }

  /**
   * Mark conversation as read
   */
  async markAsRead(conversationId: string, userId: string, userRole: string) {
    await this.getConversationById(conversationId, userId, userRole);
    const profileInfo = await this.getUserProfileInfo(userId, userRole);

    await (this.prisma as any).messages.updateMany({
      where: {
        conversationId,
        senderId: { not: profileInfo.profileId },
        isRead: false,
      },
      data: { isRead: true },
    });

    return { success: true };
  }

  /**
   * Find available tutors for a subject
   */
  async findAvailableTutors(subject: string) {
    const tutors = await (this.prisma as any).tutors.findMany({
      where: {
        isAvailable: true,
        isVerified: true,
        isBusy: false,
        subjects: {
          has: subject,
        },
      },
      include: {
        users: {
          select: { name: true, email: true, avatar: true },
        },
      },
      orderBy: [
        { rating: 'desc' },
        { experience: 'desc' },
      ],
      take: 10,
    });

    return tutors;
  }

  /**
   * Get tutor profile by user ID (for accepting conversations)
   */
  async getTutorByUserId(userId: string) {
    const tutor = await (this.prisma as any).tutors.findUnique({
      where: { userId },
      include: {
        users: {
          select: { id: true, name: true, email: true, avatar: true },
        },
      },
    });
    return tutor;
  }

  // ============ Private Helper Methods ============

  private async getUserProfileInfo(userId: string, userRole: string) {
    if (userRole === 'STUDENT') {
      const student = await (this.prisma as any).students.findUnique({
        where: { userId },
      });
      if (!student) {
        throw new NotFoundException('Student profile not found');
      }
      return { profileId: student.id, type: 'STUDENT' };
    } else if (userRole === 'TUTOR') {
      const tutor = await (this.prisma as any).tutors.findUnique({
        where: { userId },
      });
      if (!tutor) {
        throw new NotFoundException('Tutor profile not found');
      }
      return { profileId: tutor.id, type: 'TUTOR' };
    } else if (userRole === 'ADMIN') {
      return { profileId: userId, type: 'SYSTEM' };
    }
    throw new BadRequestException('Invalid user role');
  }

  private getSenderType(role: string): string {
    if (role === 'STUDENT') return 'STUDENT';
    if (role === 'TUTOR') return 'TUTOR';
    return 'SYSTEM';
  }

  private async getConversationById(conversationId: string, userId: string, userRole: string) {
    const conversation = await (this.prisma as any).conversations.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (userRole === 'ADMIN') {
      return conversation;
    }

    const profileInfo = await this.getUserProfileInfo(userId, userRole);

    if (
      userRole === 'STUDENT' &&
      conversation.studentId !== profileInfo.profileId
    ) {
      throw new ForbiddenException('Access denied to this conversation');
    }

    if (
      userRole === 'TUTOR' &&
      conversation.tutorId !== profileInfo.profileId
    ) {
      throw new ForbiddenException('Access denied to this conversation');
    }

    return conversation;
  }

  private async getConversationWithRelations(conversationId: string) {
    const conversation = await (this.prisma as any).conversations.findUnique({
      where: { id: conversationId },
      include: {
        students: {
          include: {
            users: {
              select: { id: true, name: true, email: true, avatar: true },
            },
          },
        },
        tutors: {
          include: {
            users: {
              select: { id: true, name: true, email: true, avatar: true },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    return this.formatConversation(conversation);
  }

  private async createConversation(studentId: string, classification: ClassificationResult) {
    const conversation = await (this.prisma as any).conversations.create({
      data: {
        id: uuidv4(),
        studentId,
        subject: classification.subject || 'GENERAL',
        topic: classification.topic,
        keywords: classification.keywords || [],
        urgency: classification.urgency || 'NORMAL',
        status: 'PENDING',
        updatedAt: new Date(),
      },
    });

    return conversation;
  }

  private async createMessage(data: {
    conversationId: string;
    senderId: string;
    senderType: string;
    content: string | null;
    messageType: string;
    audioUrl?: string;
    audioDuration?: number;
    transcription?: string;
  }) {
    const message = await (this.prisma as any).messages.create({
      data: {
        id: uuidv4(),
        ...data,
      },
    });

    await (this.prisma as any).conversations.update({
      where: { id: data.conversationId },
      data: { updatedAt: new Date() },
    });

    return message;
  }

  private formatConversation(conversation: any, includeAllMessages = false) {
    if (!conversation) return null;

    return {
      id: conversation.id,
      studentId: conversation.studentId,
      tutorId: conversation.tutorId,
      subject: conversation.subject,
      topic: conversation.topic,
      keywords: conversation.keywords,
      urgency: conversation.urgency,
      status: conversation.status,
      student: conversation.students ? {
        id: conversation.students.id,
        user: {
          id: conversation.students.users?.id,
          name: conversation.students.users?.name,
          email: conversation.students.users?.email,
          avatar: conversation.students.users?.avatar,
        },
      } : null,
      tutor: conversation.tutors ? {
        id: conversation.tutors.id,
        user: {
          id: conversation.tutors.users?.id,
          name: conversation.tutors.users?.name,
          email: conversation.tutors.users?.email,
          avatar: conversation.tutors.users?.avatar,
        },
      } : null,
      messages: conversation.messages || [],
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }

  private formatTimeUntil(date: Date): string {
    const now = new Date();
    const diff = date.getTime() - now.getTime();

    if (diff <= 0) return 'Available soon';

    const minutes = Math.ceil(diff / 60000);
    if (minutes < 60) return `~${minutes} minutes`;

    const hours = Math.ceil(minutes / 60);
    return `~${hours} hour${hours > 1 ? 's' : ''}`;
  }

  /**
   * Classify message using Gemini with fallback models
   */
  async classifyMessage(text: string): Promise<ClassificationResult> {
    if (!this.genAI) {
      this.logger.warn('GEMINI_API_KEY not configured, using keyword-based classification');
      return this.keywordBasedClassification(text);
    }

    // Models to try in order - use correct model names (Dec 2024)
    const modelsToTry = [
      'gemini-1.5-flash',
      'gemini-1.5-pro',
      'gemini-2.0-flash-exp',
    ];

    const prompt = `You are an educational assistant. Analyze this student question and classify it.

Student's question: "${text}"

Respond with ONLY a valid JSON object (no markdown, no code blocks) in this exact format:
{
  "detectedLanguage": "en",
  "subject": "MATHEMATICS",
  "topic": "Brief topic description",
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "urgency": "NORMAL"
}

IMPORTANT RULES:
- subject MUST be EXACTLY one of these values: MATHEMATICS, PHYSICS, CHEMISTRY, BIOLOGY, ENGLISH, HISTORY, GEOGRAPHY, COMPUTER_SCIENCE, ECONOMICS, ACCOUNTING, GENERAL
- For questions about computers, programming, coding, software, LLM, AI, machine learning, algorithms, data structures → use COMPUTER_SCIENCE
- For questions about math, calculus, algebra, geometry, statistics → use MATHEMATICS
- For questions about physics, mechanics, electricity, waves → use PHYSICS
- For questions about chemistry, molecules, reactions, elements → use CHEMISTRY
- For questions about biology, cells, organisms, genetics → use BIOLOGY
- For questions about English, writing, grammar, literature → use ENGLISH
- For questions about history, wars, civilizations, historical events → use HISTORY
- For questions about geography, maps, countries, climate → use GEOGRAPHY
- For questions about economics, markets, trade, macroeconomics → use ECONOMICS
- For questions about accounting, finance, bookkeeping → use ACCOUNTING
- Only use GENERAL if the question doesn't fit any other category
- urgency MUST be one of: LOW, NORMAL, HIGH, URGENT (HIGH if student mentions exam/test/deadline, URGENT if very immediate)
- keywords should be 3-5 relevant terms
- topic should be a brief 2-5 word description`;

    for (const modelName of modelsToTry) {
      try {
        const model = this.genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        const responseText = result.response?.text?.();

        if (!responseText) {
          this.logger.warn(`Empty response from ${modelName} for classification`);
          continue;
        }

        const cleanedResponse = responseText.replace(/```json\n?|\n?```/g, '').trim();
        const parsed = JSON.parse(cleanedResponse);

        this.logger.log(`Classification successful using model: ${modelName}`);
        
        return {
          transcription: text,
          detectedLanguage: parsed.detectedLanguage || 'en',
          subject: this.validateSubject(parsed.subject),
          topic: parsed.topic || 'General Question',
          keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
          urgency: this.validateUrgency(parsed.urgency),
        };
      } catch (error: any) {
        this.logger.warn(`Classification with ${modelName} failed: ${error.message}`);
        continue;
      }
    }

    // All models failed, use keyword-based classification
    this.logger.warn('All Gemini models failed, using keyword-based classification');
    return this.keywordBasedClassification(text);
  }

  /**
   * Keyword-based classification fallback - robust with typo handling
   */
  private keywordBasedClassification(text: string): ClassificationResult {
    const lowerText = text.toLowerCase();
    
    // Subject detection based on keywords and partial matches
    const subjectKeywords: Record<string, string[]> = {
      COMPUTER_SCIENCE: [
        'computer', 'comput', 'pc', 'laptop', 'desktop', 'ram', 'memory', 'cpu', 'gpu', 'hardware', 'software',
        'programming', 'program', 'code', 'coding', 'script', 'algorithm', 'data structure',
        'llm', 'ai', 'artificial intelligence', 'machine learning', 'ml', 'deep learning', 'neural',
        'python', 'javascript', 'java', 'c++', 'rust', 'golang', 'typescript', 'react', 'node',
        'web', 'website', 'app', 'application', 'mobile', 'android', 'ios',
        'database', 'sql', 'mongodb', 'server', 'api', 'rest', 'graphql',
        'frontend', 'backend', 'fullstack', 'dev', 'developer', 'engineer',
        'linux', 'windows', 'mac', 'os', 'operating system', 'terminal', 'command',
        'install', 'setup', 'configure', 'debug', 'error', 'bug', 'fix',
        'network', 'internet', 'wifi', 'router', 'ip', 'dns', 'http',
        'storage', 'ssd', 'hdd', 'drive', 'boot', 'bios',
      ],
      MATHEMATICS: [
        'math', 'maths', 'calculus', 'algebra', 'geometry', 'trigonometry', 'trig',
        'equation', 'formula', 'statistics', 'probability', 'integral', 'derivative',
        'matrix', 'matrices', 'vector', 'linear', 'quadratic', 'polynomial',
        'number', 'calculate', 'calculation', 'solve', 'proof', 'theorem',
        'fraction', 'decimal', 'percentage', 'ratio', 'proportion',
        'sine', 'cosine', 'tangent', 'logarithm', 'exponent',
      ],
      PHYSICS: [
        'physics', 'physical', 'force', 'energy', 'motion', 'velocity', 'speed',
        'acceleration', 'gravity', 'mass', 'weight', 'momentum', 'inertia',
        'electricity', 'electric', 'current', 'voltage', 'resistance', 'circuit',
        'magnetism', 'magnetic', 'wave', 'frequency', 'wavelength', 'light', 'optics',
        'quantum', 'relativity', 'thermodynamics', 'heat', 'temperature',
        'mechanics', 'kinetic', 'potential', 'newton', 'joule', 'watt',
      ],
      CHEMISTRY: [
        'chemistry', 'chemical', 'molecule', 'atom', 'atomic', 'element',
        'reaction', 'compound', 'bond', 'ionic', 'covalent',
        'acid', 'base', 'ph', 'solution', 'solvent', 'solute',
        'organic', 'inorganic', 'carbon', 'hydrogen', 'oxygen', 'nitrogen',
        'periodic table', 'electron', 'proton', 'neutron', 'ion',
        'oxidation', 'reduction', 'catalyst', 'equilibrium',
      ],
      BIOLOGY: [
        'biology', 'biological', 'cell', 'cells', 'organism', 'species',
        'genetics', 'gene', 'dna', 'rna', 'chromosome', 'mutation',
        'evolution', 'natural selection', 'darwin', 'adaptation',
        'ecosystem', 'ecology', 'environment', 'habitat', 'biodiversity',
        'anatomy', 'physiology', 'organ', 'tissue', 'muscle', 'bone',
        'plant', 'animal', 'bacteria', 'virus', 'fungi', 'microbe',
        'photosynthesis', 'respiration', 'metabolism', 'enzyme', 'protein',
      ],
      ENGLISH: [
        'english', 'grammar', 'writing', 'write', 'essay', 'composition',
        'literature', 'poem', 'poetry', 'novel', 'story', 'fiction',
        'vocabulary', 'word', 'sentence', 'paragraph', 'punctuation',
        'reading', 'comprehension', 'spelling', 'pronunciation',
        'verb', 'noun', 'adjective', 'adverb', 'preposition',
        'shakespeare', 'author', 'literary', 'metaphor', 'simile',
      ],
      HISTORY: [
        'history', 'historical', 'war', 'battle', 'conflict',
        'civilization', 'empire', 'dynasty', 'kingdom', 'republic',
        'century', 'ancient', 'medieval', 'modern', 'contemporary',
        'revolution', 'independence', 'colonial', 'world war',
        'president', 'king', 'queen', 'emperor', 'leader',
      ],
      GEOGRAPHY: [
        'geography', 'geographic', 'map', 'atlas', 'globe',
        'country', 'nation', 'continent', 'region', 'territory',
        'climate', 'weather', 'temperature', 'rainfall', 'season',
        'population', 'demographic', 'urban', 'rural', 'city',
        'terrain', 'landscape', 'mountain', 'river', 'ocean', 'lake',
        'latitude', 'longitude', 'equator', 'hemisphere',
      ],
      ECONOMICS: [
        'economics', 'economy', 'economic', 'market', 'stock',
        'supply', 'demand', 'price', 'cost', 'profit', 'loss',
        'gdp', 'inflation', 'deflation', 'recession', 'growth',
        'trade', 'import', 'export', 'tariff', 'commerce',
        'fiscal', 'monetary', 'policy', 'bank', 'interest', 'loan',
        'investment', 'capital', 'asset', 'liability',
      ],
      ACCOUNTING: [
        'accounting', 'accountant', 'finance', 'financial',
        'bookkeeping', 'ledger', 'journal', 'entry',
        'balance sheet', 'income statement', 'cash flow',
        'tax', 'taxes', 'revenue', 'expense', 'debit', 'credit',
        'audit', 'auditor', 'budget', 'forecast',
        'asset', 'liability', 'equity', 'depreciation',
      ],
    };

    let detectedSubject = 'GENERAL';
    let maxMatches = 0;
    const foundKeywords: string[] = [];

    for (const [subject, keywords] of Object.entries(subjectKeywords)) {
      let matches = 0;
      for (const keyword of keywords) {
        // Check for exact match or partial match (for typos like "comptuer")
        if (lowerText.includes(keyword) || this.fuzzyMatch(lowerText, keyword)) {
          matches++;
          if (!foundKeywords.includes(keyword)) {
            foundKeywords.push(keyword);
          }
        }
      }
      if (matches > maxMatches) {
        maxMatches = matches;
        detectedSubject = subject;
      }
    }

    // Urgency detection
    let urgency = 'NORMAL';
    if (lowerText.includes('urgent') || lowerText.includes('asap') || lowerText.includes('immediately')) {
      urgency = 'URGENT';
    } else if (lowerText.includes('exam') || lowerText.includes('test') || lowerText.includes('deadline') || lowerText.includes('tomorrow')) {
      urgency = 'HIGH';
    }

    // Generate topic
    const words = text.split(' ').filter(w => w.length > 3).slice(0, 5);
    const topic = words.length > 0 ? words.join(' ').substring(0, 50) : 'General Question';

    this.logger.log(`Keyword-based classification: ${detectedSubject} (${maxMatches} keyword matches: ${foundKeywords.join(', ')})`);

    return {
      transcription: text,
      detectedLanguage: 'en',
      subject: detectedSubject,
      topic,
      keywords: foundKeywords.slice(0, 5),
      urgency,
    };
  }

  /**
   * Simple fuzzy matching for typos - checks if characters are similar
   */
  private fuzzyMatch(text: string, keyword: string): boolean {
    // For short keywords (<=3 chars), require exact match
    if (keyword.length <= 3) {
      return text.includes(keyword);
    }

    // Check if most characters of keyword appear in text in similar positions
    // This catches typos like "comptuer" for "computer"
    const words = text.split(/\s+/);
    for (const word of words) {
      if (word.length < keyword.length - 2 || word.length > keyword.length + 2) {
        continue;
      }
      
      let matchCount = 0;
      const keyChars = keyword.split('');
      const wordChars = word.split('');
      
      for (let i = 0; i < Math.min(keyChars.length, wordChars.length); i++) {
        if (keyChars[i] === wordChars[i]) {
          matchCount++;
        }
      }
      
      // If 70% of characters match, consider it a match
      if (matchCount / keyword.length >= 0.7) {
        return true;
      }
      
      // Also check if keyword is a substring with 1 char difference
      if (keyword.length >= 5) {
        const keyStart = keyword.substring(0, 4);
        if (word.startsWith(keyStart)) {
          return true;
        }
      }
    }
    
    return false;
  }

  private getDefaultClassification(text: string): ClassificationResult {
    return {
      transcription: text,
      detectedLanguage: 'en',
      subject: 'GENERAL',
      topic: 'General Question',
      keywords: text.split(' ').slice(0, 5).filter(w => w.length > 3),
      urgency: 'NORMAL',
    };
  }

  private validateSubject(subject: string): string {
    const validSubjects = [
      'MATHEMATICS', 'PHYSICS', 'CHEMISTRY', 'BIOLOGY', 'ENGLISH',
      'HISTORY', 'GEOGRAPHY', 'COMPUTER_SCIENCE', 'ECONOMICS', 'ACCOUNTING', 'GENERAL',
    ];
    return validSubjects.includes(subject?.toUpperCase()) ? subject.toUpperCase() : 'GENERAL';
  }

  private validateUrgency(urgency: string): string {
    const validUrgencies = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
    return validUrgencies.includes(urgency?.toUpperCase()) ? urgency.toUpperCase() : 'NORMAL';
  }

  /**
   * Transcribe audio using Gemini with fallback models
   */
  async transcribeAudio(file: Express.Multer.File): Promise<string> {
    if (!this.genAI) {
      // No API key - return placeholder
      this.logger.warn('GEMINI_API_KEY not configured, returning placeholder transcription');
      return '[Audio message - transcription unavailable]';
    }

    // Models that support audio transcription (in order of preference - Dec 2024)
    // Try multiple variations as Google frequently changes model names
    const modelsToTry = [
      'models/gemini-1.5-flash',
      'models/gemini-1.5-pro', 
      'gemini-1.5-flash-latest',
      'gemini-1.5-pro-latest',
      'gemini-1.5-flash',
      'gemini-1.5-pro',
      'gemini-pro-vision',
      'models/gemini-pro-vision',
    ];

    const base64Audio = file.buffer.toString('base64');
    
    // Determine correct MIME type
    let mimeType = file.mimetype || 'audio/webm';
    if (mimeType === 'application/octet-stream') {
      // Try to detect from filename
      const ext = file.originalname?.split('.').pop()?.toLowerCase();
      const mimeMap: Record<string, string> = {
        'webm': 'audio/webm',
        'mp3': 'audio/mp3',
        'wav': 'audio/wav',
        'm4a': 'audio/m4a',
        'ogg': 'audio/ogg',
        'aac': 'audio/aac',
      };
      mimeType = mimeMap[ext || ''] || 'audio/webm';
    }

    for (const modelName of modelsToTry) {
      try {
        const model = this.genAI.getGenerativeModel({ model: modelName });

        const result = await model.generateContent([
          {
            inlineData: {
              mimeType,
              data: base64Audio,
            },
          },
          {
            text: 'Transcribe this audio message. The user is likely a student asking for help with their studies. Return only the transcription text, nothing else. If you cannot understand the audio, return "UNABLE_TO_TRANSCRIBE".',
          },
        ]);

        const transcription = result.response?.text?.()?.trim();

        if (!transcription || transcription === 'UNABLE_TO_TRANSCRIBE') {
          this.logger.warn(`Model ${modelName} could not transcribe audio`);
          continue;
        }

        this.logger.log(`Audio transcription successful using model: ${modelName}`);
        return transcription;
      } catch (error: any) {
        this.logger.warn(`Audio transcription with ${modelName} failed: ${error.message}`);
        continue;
      }
    }

    // All models failed - return placeholder so message can still be sent
    this.logger.warn('All Gemini models failed for audio transcription, using placeholder');
    return '[Audio message - transcription pending]';
  }

  /**
   * Store audio file
   */
  private async storeAudioFile(file: Express.Multer.File): Promise<string> {
    const filename = `${uuidv4()}-${file.originalname || 'audio.webm'}`;
    return `/uploads/audio/${filename}`;
  }

  /**
   * Store attachment file (image or PDF)
   */
  private async storeAttachmentFile(file: Express.Multer.File): Promise<{
    url: string;
    name: string;
    type: string;
    size: number;
  }> {
    const ext = file.originalname?.split('.').pop() || 'bin';
    const filename = `${uuidv4()}.${ext}`;
    const folder = file.mimetype.startsWith('image/') ? 'images' : 'documents';
    
    // TODO: In production, upload to cloud storage (S3, GCS, etc.)
    // For now, return a placeholder URL
    return {
      url: `/uploads/${folder}/${filename}`,
      name: file.originalname || filename,
      type: file.mimetype,
      size: file.size,
    };
  }

  /**
   * Send a message with attachments (images/PDFs)
   */
  async sendMessageWithAttachments(
    userId: string,
    userRole: string,
    conversationId: string,
    content: string,
    files: Express.Multer.File[],
  ) {
    // Verify access to conversation
    const conversation = await this.getConversationById(conversationId, userId, userRole);
    const profileInfo = await this.getUserProfileInfo(userId, userRole);

    // Validate attachments
    const pdfFiles = files.filter(f => f.mimetype === 'application/pdf');
    const imageFiles = files.filter(f => f.mimetype.startsWith('image/'));

    if (pdfFiles.length > 3) {
      throw new BadRequestException('Maximum 3 PDF files allowed');
    }

    if (imageFiles.length > 1) {
      throw new BadRequestException('Maximum 1 image file allowed per message');
    }

    // Store all files and get their metadata
    const attachments = await Promise.all(
      files.map(file => this.storeAttachmentFile(file))
    );

    // Determine message type
    let messageType = 'TEXT';
    if (imageFiles.length > 0) {
      messageType = 'IMAGE';
    } else if (pdfFiles.length > 0) {
      messageType = 'FILE';
    }

    // Create the message
    const message = await (this.prisma as any).messages.create({
      data: {
        id: uuidv4(),
        conversationId,
        senderId: profileInfo.profileId,
        senderType: this.getSenderType(userRole),
        content: content || null,
        messageType,
        attachments: attachments,
      },
    });

    // Update conversation timestamp
    await (this.prisma as any).conversations.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    const fullConversation = await this.getConversationWithRelations(conversationId);

    return {
      message: {
        ...message,
        attachments,
      },
      conversation: fullConversation,
    };
  }

  // ============ Call History Methods ============

  /**
   * Get call history for a specific conversation
   */
  async getConversationCalls(conversationId: string, userId: string, userRole: string) {
    // Verify access to conversation
    await this.getConversationById(conversationId, userId, userRole);

    const calls = await (this.prisma as any).call_logs.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      include: {
        conversations: {
          include: {
            students: {
              include: {
                users: { select: { id: true, name: true, email: true, avatar: true } },
              },
            },
            tutors: {
              include: {
                users: { select: { id: true, name: true, email: true, avatar: true } },
              },
            },
          },
        },
      },
    });

    return calls.map((call: any) => this.formatCallLog(call, userId));
  }

  /**
   * Get all call history for a user
   */
  async getUserCallHistory(userId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    // Get user's profile info to find their calls
    const user = await (this.prisma as any).users.findUnique({
      where: { id: userId },
      include: {
        students: true,
        tutors: true,
      },
    });

    const studentId = user?.students?.id;
    const tutorId = user?.tutors?.id;

    // Find all conversations this user is part of
    const conversationIds = await (this.prisma as any).conversations.findMany({
      where: {
        OR: [
          ...(studentId ? [{ studentId }] : []),
          ...(tutorId ? [{ tutorId }] : []),
        ],
      },
      select: { id: true },
    });

    const ids = conversationIds.map((c: any) => c.id);

    const [calls, total] = await Promise.all([
      (this.prisma as any).call_logs.findMany({
        where: {
          conversationId: { in: ids },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          conversations: {
            include: {
              students: {
                include: {
                  users: { select: { id: true, name: true, email: true, avatar: true } },
                },
              },
              tutors: {
                include: {
                  users: { select: { id: true, name: true, email: true, avatar: true } },
                },
              },
            },
          },
        },
      }),
      (this.prisma as any).call_logs.count({
        where: {
          conversationId: { in: ids },
        },
      }),
    ]);

    return {
      calls: calls.map((call: any) => this.formatCallLog(call, userId)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Format call log for response
   */
  private formatCallLog(call: any, userId: string) {
    const conversation = call.conversations;
    const studentUser = conversation?.students?.users;
    const tutorUser = conversation?.tutors?.users;

    // Determine if this user was the caller or receiver
    const isCaller = call.callerId === userId;
    const otherParty = isCaller ? tutorUser || studentUser : (call.callerId === studentUser?.id ? studentUser : tutorUser);

    return {
      id: call.id,
      conversationId: call.conversationId,
      callType: call.callType,
      status: call.status,
      direction: isCaller ? 'OUTGOING' : 'INCOMING',
      duration: call.duration,
      endReason: call.endReason,
      startedAt: call.startedAt,
      answeredAt: call.answeredAt,
      endedAt: call.endedAt,
      otherParty: otherParty ? {
        id: otherParty.id,
        name: otherParty.name,
        email: otherParty.email,
        avatar: otherParty.avatar,
      } : null,
      createdAt: call.createdAt,
    };
  }

  // ============ Message Reactions ============

  /**
   * Add or update a reaction to a message
   */
  async addReaction(messageId: string, userId: string, type: 'LIKE' | 'DISLIKE') {
    // Check if message exists
    const message = await (this.prisma as any).messages.findUnique({
      where: { id: messageId },
      include: {
        conversations: {
          select: { studentId: true, tutorId: true },
        },
      },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    // Check if user has access to this conversation
    const conversation = message.conversations;
    // For now, allow any authenticated user to react (for shared conversations)
    // In the future, could restrict to conversation participants

    // Check for existing reaction
    const existingReaction = await (this.prisma as any).message_reactions.findUnique({
      where: {
        messageId_userId: { messageId, userId },
      },
    });

    if (existingReaction) {
      if (existingReaction.type === type) {
        // Same reaction - remove it (toggle off)
        await (this.prisma as any).message_reactions.delete({
          where: { id: existingReaction.id },
        });

        // Update counts
        await this.updateReactionCounts(messageId);
        
        return { removed: true, type };
      } else {
        // Different reaction - update it
        await (this.prisma as any).message_reactions.update({
          where: { id: existingReaction.id },
          data: { type },
        });

        // Update counts
        await this.updateReactionCounts(messageId);
        
        return { updated: true, type };
      }
    }

    // Create new reaction
    const reaction = await (this.prisma as any).message_reactions.create({
      data: {
        messageId,
        userId,
        type,
      },
    });

    // Update counts
    await this.updateReactionCounts(messageId);

    return { added: true, type, reaction };
  }

  /**
   * Remove a reaction from a message
   */
  async removeReaction(messageId: string, userId: string) {
    const existingReaction = await (this.prisma as any).message_reactions.findUnique({
      where: {
        messageId_userId: { messageId, userId },
      },
    });

    if (!existingReaction) {
      throw new NotFoundException('Reaction not found');
    }

    await (this.prisma as any).message_reactions.delete({
      where: { id: existingReaction.id },
    });

    // Update counts
    await this.updateReactionCounts(messageId);

    return { success: true };
  }

  /**
   * Get reaction summary for a message
   */
  async getMessageReactions(messageId: string, userId?: string) {
    const message = await (this.prisma as any).messages.findUnique({
      where: { id: messageId },
      select: { likeCount: true, dislikeCount: true },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    let userReaction = null;
    if (userId) {
      const reaction = await (this.prisma as any).message_reactions.findUnique({
        where: {
          messageId_userId: { messageId, userId },
        },
      });
      userReaction = reaction?.type || null;
    }

    return {
      messageId,
      likeCount: message.likeCount,
      dislikeCount: message.dislikeCount,
      userReaction,
    };
  }

  /**
   * Update reaction counts on message (denormalized)
   */
  private async updateReactionCounts(messageId: string) {
    const [likeCount, dislikeCount] = await Promise.all([
      (this.prisma as any).message_reactions.count({
        where: { messageId, type: 'LIKE' },
      }),
      (this.prisma as any).message_reactions.count({
        where: { messageId, type: 'DISLIKE' },
      }),
    ]);

    await (this.prisma as any).messages.update({
      where: { id: messageId },
      data: { likeCount, dislikeCount },
    });
  }

  // ============ Conversation Sharing ============

  /**
   * Generate a share token for a conversation
   */
  async shareConversation(conversationId: string, userId: string, userRole: string) {
    const conversation = await (this.prisma as any).conversations.findUnique({
      where: { id: conversationId },
      include: {
        students: { select: { userId: true } },
        tutors: { select: { userId: true } },
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    // Only conversation participants can share
    const isStudent = conversation.students?.userId === userId;
    const isTutor = conversation.tutors?.userId === userId;
    const isAdmin = userRole === 'ADMIN';

    if (!isStudent && !isTutor && !isAdmin) {
      throw new ForbiddenException('Only conversation participants can share');
    }

    // Generate unique share token
    const shareToken = this.generateShareToken();

    const updatedConversation = await (this.prisma as any).conversations.update({
      where: { id: conversationId },
      data: {
        isShared: true,
        shareToken,
        sharedAt: new Date(),
        sharedBy: userId,
      },
    });

    return {
      conversationId,
      isShared: true,
      shareToken,
      shareUrl: `/shared/${shareToken}`,
      sharedAt: updatedConversation.sharedAt,
    };
  }

  /**
   * Disable sharing for a conversation
   */
  async unshareConversation(conversationId: string, userId: string, userRole: string) {
    const conversation = await (this.prisma as any).conversations.findUnique({
      where: { id: conversationId },
      include: {
        students: { select: { userId: true } },
        tutors: { select: { userId: true } },
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    // Only conversation participants can unshare
    const isStudent = conversation.students?.userId === userId;
    const isTutor = conversation.tutors?.userId === userId;
    const isAdmin = userRole === 'ADMIN';

    if (!isStudent && !isTutor && !isAdmin) {
      throw new ForbiddenException('Only conversation participants can modify sharing');
    }

    await (this.prisma as any).conversations.update({
      where: { id: conversationId },
      data: {
        isShared: false,
        shareToken: null,
        sharedAt: null,
        sharedBy: null,
      },
    });

    return {
      conversationId,
      isShared: false,
    };
  }

  /**
   * Get a shared conversation by share token (public view)
   */
  async getSharedConversation(shareToken: string) {
    const conversation = await (this.prisma as any).conversations.findUnique({
      where: { shareToken },
      include: {
        students: {
          include: {
            users: { select: { name: true } },
          },
        },
        tutors: {
          include: {
            users: { select: { name: true } },
          },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            senderType: true,
            content: true,
            messageType: true,
            likeCount: true,
            dislikeCount: true,
            createdAt: true,
          },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException('Shared conversation not found');
    }

    if (!conversation.isShared) {
      throw new ForbiddenException('This conversation is no longer shared');
    }

    // Return anonymized view
    return {
      id: conversation.id,
      subject: conversation.subject,
      topic: conversation.topic,
      studentName: this.anonymizeName(conversation.students?.users?.name || 'Student'),
      tutorName: conversation.tutors?.users?.name || null,
      status: conversation.status,
      createdAt: conversation.createdAt,
      messages: conversation.messages.map((msg: any) => ({
        id: msg.id,
        senderType: msg.senderType,
        content: msg.content,
        messageType: msg.messageType,
        likeCount: msg.likeCount,
        dislikeCount: msg.dislikeCount,
        createdAt: msg.createdAt,
      })),
    };
  }

  /**
   * Get share status for a conversation
   */
  async getShareStatus(conversationId: string, userId: string, userRole: string) {
    const conversation = await (this.prisma as any).conversations.findUnique({
      where: { id: conversationId },
      select: {
        isShared: true,
        shareToken: true,
        sharedAt: true,
        sharedBy: true,
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    return {
      conversationId,
      isShared: conversation.isShared,
      shareToken: conversation.shareToken,
      shareUrl: conversation.shareToken ? `/shared/${conversation.shareToken}` : null,
      sharedAt: conversation.sharedAt,
    };
  }

  /**
   * Generate a unique share token
   */
  private generateShareToken(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < 12; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  }

  /**
   * Anonymize a name for shared view (show first name only or initials)
   */
  private anonymizeName(name: string): string {
    if (!name) return 'Anonymous';
    const parts = name.split(' ');
    if (parts.length > 1) {
      return `${parts[0]} ${parts[1].charAt(0)}.`;
    }
    return parts[0];
  }
}
