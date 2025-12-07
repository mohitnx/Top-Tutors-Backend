import { Injectable, Logger, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { TutorMatchingService } from './tutor-matching.service';
import { MessagesGateway } from './messages.gateway';
import { CreateMessageDto } from './dto';
import { 
  MessageType, 
  SenderType, 
  ConversationStatus,
  Subject,
} from '@prisma/client';

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    private readonly tutorMatchingService: TutorMatchingService,
    @Inject(forwardRef(() => MessagesGateway))
    private readonly messagesGateway: MessagesGateway,
  ) {}

  /**
   * Send a text message (student or tutor)
   */
  async sendMessage(
    senderId: string,
    senderType: SenderType,
    dto: CreateMessageDto,
  ) {
    if (!dto.content && dto.messageType === MessageType.TEXT) {
      throw new BadRequestException('Text message must have content');
    }

    let conversation;

    // If continuing existing conversation
    if (dto.conversationId) {
      conversation = await this.prisma.conversation.findUnique({
        where: { id: dto.conversationId },
        include: { 
          student: { include: { user: { select: { name: true } } } }, 
          tutor: { include: { user: { select: { name: true } } } },
        },
      });

      if (!conversation) {
        throw new NotFoundException('Conversation not found');
      }
    } else {
      // New conversation - only students can start
      if (senderType !== SenderType.STUDENT) {
        throw new BadRequestException('Only students can start new conversations');
      }

      // Get student profile
      const student = await this.prisma.student.findFirst({
        where: { userId: senderId },
      });

      if (!student) {
        throw new NotFoundException('Student profile not found');
      }

      // Classify the message using AI
      const classification = await this.aiService.classifyMessage(dto.content || '');
      this.logger.log(`Message classified: ${classification.subject} - ${classification.topic}`);

      // Find best matching tutor
      const matchedTutor = await this.tutorMatchingService.findBestTutor(
        classification.subject,
        classification.urgency,
      );

      // Create new conversation
      conversation = await this.prisma.conversation.create({
        data: {
          studentId: student.id,
          tutorId: matchedTutor?.id || null,
          subject: classification.subject,
          topic: classification.topic,
          keywords: classification.keywords,
          urgency: classification.urgency,
          status: matchedTutor ? ConversationStatus.ASSIGNED : ConversationStatus.PENDING,
        },
        include: { 
          student: { include: { user: { select: { name: true } } } }, 
          tutor: { include: { user: { select: { name: true } } } },
        },
      });

      // 🔴 Notify tutor about new assignment via WebSocket
      if (matchedTutor) {
        this.messagesGateway.notifyNewAssignment(matchedTutor.userId, conversation);
        this.logger.log(`WebSocket: Notified tutor ${matchedTutor.name} (${matchedTutor.userId}) about new assignment`);
      }

      this.logger.log(`New conversation created: ${conversation.id}, assigned to tutor: ${matchedTutor?.name || 'none'}`);
    }

    // Create the message
    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId,
        senderType,
        content: dto.content,
        messageType: dto.messageType,
      },
    });

    // Update conversation status if tutor is responding
    if (senderType === SenderType.TUTOR && conversation.status === ConversationStatus.ASSIGNED) {
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { status: ConversationStatus.ACTIVE },
      });
    }

    // 🔴 REAL-TIME: Notify all users in the conversation via WebSocket
    // Pass senderId so frontend can filter out duplicates (sender already has the message from API response)
    this.messagesGateway.sendNewMessage(conversation.id, {
      ...message,
      senderName: senderType === SenderType.STUDENT 
        ? conversation.student?.user?.name 
        : conversation.tutor?.user?.name,
    }, senderId);
    this.logger.log(`WebSocket: Sent newMessage to conversation ${conversation.id}`);

    return {
      message,
      conversation: await this.getConversation(conversation.id),
    };
  }

  /**
   * Send an audio message with transcription and classification
   */
  async sendAudioMessage(
    senderId: string,
    senderType: SenderType,
    audioBuffer: Buffer,
    mimeType: string,
    audioDuration: number,
    audioUrl: string,
    conversationId?: string,
  ) {
    let conversation;

    // Transcribe and classify the audio using AI
    const audioClassification = await this.aiService.transcribeAndClassifyAudio(audioBuffer, mimeType);
    this.logger.log(`Audio transcribed: "${audioClassification.transcription.substring(0, 50)}..." (${audioClassification.detectedLanguage})`);

    if (conversationId) {
      conversation = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
      });

      if (!conversation) {
        throw new NotFoundException('Conversation not found');
      }
    } else {
      // New conversation with audio - only students can start
      if (senderType !== SenderType.STUDENT) {
        throw new BadRequestException('Only students can start new conversations');
      }

      const student = await this.prisma.student.findFirst({
        where: { userId: senderId },
      });

      if (!student) {
        throw new NotFoundException('Student profile not found');
      }

      // Find best matching tutor based on audio classification
      const matchedTutor = await this.tutorMatchingService.findBestTutor(
        audioClassification.subject,
        audioClassification.urgency,
      );

      // Create new conversation with AI classification
      conversation = await this.prisma.conversation.create({
        data: {
          studentId: student.id,
          tutorId: matchedTutor?.id || null,
          subject: audioClassification.subject,
          topic: audioClassification.topic,
          keywords: audioClassification.keywords,
          urgency: audioClassification.urgency,
          status: matchedTutor ? ConversationStatus.ASSIGNED : ConversationStatus.PENDING,
        },
        include: { 
          student: { include: { user: { select: { name: true } } } }, 
          tutor: { include: { user: { select: { name: true } } } },
        },
      });

      // 🔴 Notify tutor about new assignment via WebSocket
      if (matchedTutor) {
        this.messagesGateway.notifyNewAssignment(matchedTutor.userId, conversation);
        this.logger.log(`WebSocket: Notified tutor ${matchedTutor.name} (${matchedTutor.userId}) about new assignment`);
      }

      this.logger.log(`Audio conversation created: ${conversation.id}, subject: ${audioClassification.subject}, tutor: ${matchedTutor?.name || 'none'}`);
    }

    // Create audio message with transcription
    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId,
        senderType,
        messageType: MessageType.AUDIO,
        audioUrl,
        audioDuration,
        transcription: audioClassification.transcription,
        content: audioClassification.summary, // Store summary as content for easy display
      },
    });

    // 🔴 REAL-TIME: Notify all users in the conversation via WebSocket
    const fullConversation = await this.getConversation(conversation.id);
    this.messagesGateway.sendNewMessage(conversation.id, {
      ...message,
      transcription: audioClassification.transcription,
    }, senderId);
    this.logger.log(`WebSocket: Sent newMessage (audio) to conversation ${conversation.id}`);

    return {
      message,
      conversation: fullConversation,
      classification: {
        transcription: audioClassification.transcription,
        detectedLanguage: audioClassification.detectedLanguage,
        subject: audioClassification.subject,
        topic: audioClassification.topic,
        keywords: audioClassification.keywords,
        urgency: audioClassification.urgency,
      },
    };
  }

  /**
   * Get a single conversation with messages
   */
  async getConversation(conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        student: {
          include: {
            user: {
              select: { name: true, email: true },
            },
          },
        },
        tutor: {
          include: {
            user: {
              select: { name: true, email: true },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    return conversation;
  }

  /**
   * Get conversations for a student
   */
  async getStudentConversations(userId: string, page = 1, limit = 10) {
    const student = await this.prisma.student.findFirst({
      where: { userId },
    });

    if (!student) {
      throw new NotFoundException('Student profile not found');
    }

    const skip = (page - 1) * limit;

    const [conversations, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where: { studentId: student.id },
        include: {
          tutor: {
            include: {
              user: { select: { name: true, email: true } },
            },
          },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1, // Only get last message
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.conversation.count({
        where: { studentId: student.id },
      }),
    ]);

    return {
      data: conversations,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get conversations for a tutor
   */
  async getTutorConversations(userId: string, page = 1, limit = 10, status?: ConversationStatus) {
    const tutor = await this.prisma.tutor.findFirst({
      where: { userId },
    });

    if (!tutor) {
      throw new NotFoundException('Tutor profile not found');
    }

    const skip = (page - 1) * limit;
    const whereClause: any = { tutorId: tutor.id };
    
    if (status) {
      whereClause.status = status;
    }

    const [conversations, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where: whereClause,
        include: {
          student: {
            include: {
              user: { select: { name: true, email: true } },
            },
          },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: [
          { urgency: 'desc' },
          { updatedAt: 'desc' },
        ],
        skip,
        take: limit,
      }),
      this.prisma.conversation.count({
        where: whereClause,
      }),
    ]);

    return {
      data: conversations,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get pending conversations (for admin or tutor assignment)
   */
  async getPendingConversations(page = 1, limit = 10) {
    const skip = (page - 1) * limit;

    const [conversations, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where: { status: ConversationStatus.PENDING },
        include: {
          student: {
            include: {
              user: { select: { name: true, email: true } },
            },
          },
          messages: {
            orderBy: { createdAt: 'asc' },
            take: 1,
          },
        },
        orderBy: [
          { urgency: 'desc' },
          { createdAt: 'asc' },
        ],
        skip,
        take: limit,
      }),
      this.prisma.conversation.count({
        where: { status: ConversationStatus.PENDING },
      }),
    ]);

    return {
      data: conversations,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Assign a tutor to a conversation
   */
  async assignTutor(conversationId: string, tutorId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const tutor = await this.prisma.tutor.findUnique({
      where: { id: tutorId },
    });

    if (!tutor) {
      throw new NotFoundException('Tutor not found');
    }

    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        tutorId,
        status: ConversationStatus.ASSIGNED,
      },
      include: {
        student: {
          include: { user: { select: { name: true, email: true } } },
        },
        tutor: {
          include: { user: { select: { name: true, email: true } } },
        },
      },
    });
  }

  /**
   * Close/resolve a conversation
   */
  async closeConversation(conversationId: string, status: ConversationStatus) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: { status },
    });
  }

  /**
   * Mark messages as read
   */
  async markMessagesAsRead(conversationId: string, userId: string) {
    // Get all unread messages not sent by this user
    await this.prisma.message.updateMany({
      where: {
        conversationId,
        senderId: { not: userId },
        isRead: false,
      },
      data: { isRead: true },
    });

    return { success: true };
  }
}

