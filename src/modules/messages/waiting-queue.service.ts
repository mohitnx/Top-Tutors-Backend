import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';

export interface TutorAvailabilityResponse {
  tutorId: string;
  responseType: 'MINUTES_5' | 'MINUTES_10' | 'NOT_ANYTIME_SOON' | 'CUSTOM';
  customMinutes?: number;
}

export interface WaitingQueueInfo {
  id: string;
  conversationId: string;
  studentId: string;
  subject: string;
  status: string;
  waitStartedAt: Date;
  shortestWaitMinutes: number | null;
  tutorResponses: Array<{
    tutorId: string;
    tutorName: string;
    responseType: string;
    freeAt: Date;
    minutesUntilFree: number;
  }>;
}

// 2 minutes waiting threshold before notifying busy tutors
const WAITING_THRESHOLD_MS = 2 * 60 * 1000;
// How often to check for waiting queue timeouts
const CHECK_INTERVAL_MS = 30 * 1000;

@Injectable()
export class WaitingQueueService {
  private readonly logger = new Logger(WaitingQueueService.name);
  private checkInterval: NodeJS.Timeout | null = null;
  private reminderTimeouts: Map<string, NodeJS.Timeout> = new Map();

  // Callbacks for WebSocket notifications
  private onNotifyBusyTutors: ((conversationId: string, tutors: any[], waitingQueue: any) => void) | null = null;
  private onNotifyStudent: ((studentUserId: string, shortestWait: number, tutorResponses: any[]) => void) | null = null;
  private onRemindTutor: ((tutorUserId: string, conversationId: string, waitingQueueId: string) => void) | null = null;
  private onSessionTaken: ((tutorUserId: string, conversationId: string) => void) | null = null;

  constructor(private readonly prisma: PrismaService) {
    // Start checking for waiting queue timeouts
    this.startWaitingQueueCheck();
  }

  /**
   * Register callback handlers for WebSocket notifications
   */
  registerCallbacks(handlers: {
    onNotifyBusyTutors: (conversationId: string, tutors: any[], waitingQueue: any) => void;
    onNotifyStudent: (studentUserId: string, shortestWait: number, tutorResponses: any[]) => void;
    onRemindTutor: (tutorUserId: string, conversationId: string, waitingQueueId: string) => void;
    onSessionTaken: (tutorUserId: string, conversationId: string) => void;
  }) {
    this.onNotifyBusyTutors = handlers.onNotifyBusyTutors;
    this.onNotifyStudent = handlers.onNotifyStudent;
    this.onRemindTutor = handlers.onRemindTutor;
    this.onSessionTaken = handlers.onSessionTaken;
  }

  /**
   * Start a student in the waiting queue (called when conversation is created)
   */
  async addToWaitingQueue(conversationId: string, studentId: string, subject: string): Promise<string> {
    const waitingQueue = await (this.prisma as any).waiting_queue.create({
      data: {
        id: uuidv4(),
        conversationId,
        studentId,
        subject,
        status: 'WAITING',
        waitStartedAt: new Date(),
      },
    });

    this.logger.log(`Added conversation ${conversationId} to waiting queue`);
    return waitingQueue.id;
  }

  /**
   * Check if a conversation is already in the waiting queue
   */
  async isInWaitingQueue(conversationId: string): Promise<boolean> {
    const existing = await (this.prisma as any).waiting_queue.findUnique({
      where: { conversationId },
    });
    return !!existing;
  }

  /**
   * Get waiting queue entry for a conversation
   */
  async getWaitingQueue(conversationId: string): Promise<WaitingQueueInfo | null> {
    const queue = await (this.prisma as any).waiting_queue.findUnique({
      where: { conversationId },
      include: {
        tutor_availability_responses: {
          include: {
            tutors: {
              include: {
                users: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    if (!queue) return null;

    return {
      id: queue.id,
      conversationId: queue.conversationId,
      studentId: queue.studentId,
      subject: queue.subject,
      status: queue.status,
      waitStartedAt: queue.waitStartedAt,
      shortestWaitMinutes: queue.shortestWaitMinutes,
      tutorResponses: queue.tutor_availability_responses.map((r: any) => ({
        tutorId: r.tutorId,
        tutorName: r.tutors?.users?.name || 'Tutor',
        responseType: r.responseType,
        freeAt: r.freeAt,
        minutesUntilFree: Math.max(0, Math.ceil((new Date(r.freeAt).getTime() - Date.now()) / 60000)),
      })),
    };
  }

  /**
   * Record a tutor's availability response
   */
  async recordTutorAvailability(
    conversationId: string,
    tutorId: string,
    response: TutorAvailabilityResponse,
  ): Promise<{ success: boolean; freeAt: Date; minutesUntilFree: number }> {
    // Get the waiting queue entry
    const queue = await (this.prisma as any).waiting_queue.findUnique({
      where: { conversationId },
    });

    if (!queue) {
      throw new Error('Conversation not in waiting queue');
    }

    // Check if conversation is still pending
    const conversation = await (this.prisma as any).conversations.findUnique({
      where: { id: conversationId },
    });

    if (conversation?.status !== 'PENDING') {
      throw new Error('Conversation is no longer available');
    }

    // Calculate freeAt time based on response type
    let minutesUntilFree: number;
    switch (response.responseType) {
      case 'MINUTES_5':
        minutesUntilFree = 5;
        break;
      case 'MINUTES_10':
        minutesUntilFree = 10;
        break;
      case 'NOT_ANYTIME_SOON':
        minutesUntilFree = 60; // 1 hour
        break;
      case 'CUSTOM':
        minutesUntilFree = response.customMinutes || 15;
        break;
      default:
        minutesUntilFree = 15;
    }

    const freeAt = new Date(Date.now() + minutesUntilFree * 60000);

    // Upsert the availability response
    await (this.prisma as any).tutor_availability_responses.upsert({
      where: {
        waitingQueueId_tutorId: {
          waitingQueueId: queue.id,
          tutorId,
        },
      },
      update: {
        responseType: response.responseType,
        customMinutes: response.customMinutes,
        freeAt,
        sessionTaken: false,
      },
      create: {
        id: uuidv4(),
        waitingQueueId: queue.id,
        tutorId,
        conversationId,
        responseType: response.responseType,
        customMinutes: response.customMinutes,
        freeAt,
      },
    });

    this.logger.log(`Tutor ${tutorId} responded with availability: ${response.responseType} (${minutesUntilFree} minutes)`);

    // Schedule reminder for this tutor
    this.scheduleReminder(queue.id, tutorId, conversationId, freeAt);

    // Update the queue with shortest wait time
    await this.updateShortestWaitTime(queue.id, conversationId);

    return { success: true, freeAt, minutesUntilFree };
  }

  /**
   * Update the shortest wait time in the queue and notify student
   */
  private async updateShortestWaitTime(waitingQueueId: string, conversationId: string) {
    // Get all responses for this queue
    const responses = await (this.prisma as any).tutor_availability_responses.findMany({
      where: { waitingQueueId },
      orderBy: { freeAt: 'asc' },
      include: {
        tutors: {
          include: {
            users: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (responses.length === 0) return;

    // Find shortest wait time
    const now = Date.now();
    const shortestResponse = responses[0];
    const shortestWaitMinutes = Math.max(0, Math.ceil((new Date(shortestResponse.freeAt).getTime() - now) / 60000));

    // Update queue
    await (this.prisma as any).waiting_queue.update({
      where: { id: waitingQueueId },
      data: {
        shortestWaitMinutes,
        status: 'AVAILABILITY_COLLECTED',
      },
    });

    // Get student info to notify
    const queue = await (this.prisma as any).waiting_queue.findUnique({
      where: { id: waitingQueueId },
      include: {
        conversations: {
          include: {
            students: {
              include: {
                users: { select: { id: true } },
              },
            },
          },
        },
      },
    });

    const studentUserId = queue?.conversations?.students?.users?.id;

    // Notify student about the shortest wait time
    if (studentUserId && this.onNotifyStudent) {
      const tutorResponses = responses.map((r: any) => ({
        tutorId: r.tutorId,
        tutorName: r.tutors?.users?.name || 'Tutor',
        freeAt: r.freeAt,
        minutesUntilFree: Math.max(0, Math.ceil((new Date(r.freeAt).getTime() - now) / 60000)),
      }));

      this.onNotifyStudent(studentUserId, shortestWaitMinutes, tutorResponses);
    }
  }

  /**
   * Schedule a reminder for a tutor when their availability time expires
   */
  private scheduleReminder(waitingQueueId: string, tutorId: string, conversationId: string, freeAt: Date) {
    const key = `${waitingQueueId}-${tutorId}`;
    
    // Clear any existing reminder
    const existingTimeout = this.reminderTimeouts.get(key);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const delay = Math.max(0, freeAt.getTime() - Date.now());
    
    const timeout = setTimeout(async () => {
      this.reminderTimeouts.delete(key);
      await this.sendTutorReminder(waitingQueueId, tutorId, conversationId);
    }, delay);

    this.reminderTimeouts.set(key, timeout);
    this.logger.log(`Scheduled reminder for tutor ${tutorId} in ${Math.ceil(delay / 60000)} minutes`);
  }

  /**
   * Send reminder to tutor that their availability time has come
   */
  private async sendTutorReminder(waitingQueueId: string, tutorId: string, conversationId: string) {
    // Check if conversation is still pending
    const conversation = await (this.prisma as any).conversations.findUnique({
      where: { id: conversationId },
    });

    if (conversation?.status !== 'PENDING') {
      this.logger.log(`Conversation ${conversationId} no longer pending, skipping reminder`);
      return;
    }

    // Check if another tutor has taken this session
    const response = await (this.prisma as any).tutor_availability_responses.findFirst({
      where: {
        waitingQueueId,
        tutorId,
      },
    });

    if (response?.sessionTaken) {
      this.logger.log(`Session already taken, skipping reminder for tutor ${tutorId}`);
      return;
    }

    // Get tutor info
    const tutor = await (this.prisma as any).tutors.findUnique({
      where: { id: tutorId },
      include: {
        users: { select: { id: true } },
      },
    });

    if (!tutor) return;

    // Mark reminder as sent
    await (this.prisma as any).tutor_availability_responses.updateMany({
      where: {
        waitingQueueId,
        tutorId,
      },
      data: {
        reminderSent: true,
        reminderSentAt: new Date(),
      },
    });

    // Send reminder via WebSocket
    if (this.onRemindTutor) {
      this.onRemindTutor(tutor.users.id, conversationId, waitingQueueId);
      this.logger.log(`Sent reminder to tutor ${tutorId} for conversation ${conversationId}`);
    }
  }

  /**
   * Mark conversation as taken (called when a tutor accepts)
   * This will notify all other tutors who were waiting
   */
  async markConversationTaken(conversationId: string, acceptedTutorId: string) {
    const queue = await (this.prisma as any).waiting_queue.findUnique({
      where: { conversationId },
    });

    if (!queue) return;

    // Mark queue as matched
    await (this.prisma as any).waiting_queue.update({
      where: { id: queue.id },
      data: {
        status: 'MATCHED',
        matchedTutorId: acceptedTutorId,
        matchedAt: new Date(),
      },
    });

    // Get all other tutors who responded and mark session as taken
    const responses = await (this.prisma as any).tutor_availability_responses.findMany({
      where: {
        waitingQueueId: queue.id,
        tutorId: { not: acceptedTutorId },
      },
      include: {
        tutors: {
          include: {
            users: { select: { id: true } },
          },
        },
      },
    });

    // Mark all responses as session taken
    await (this.prisma as any).tutor_availability_responses.updateMany({
      where: {
        waitingQueueId: queue.id,
        tutorId: { not: acceptedTutorId },
      },
      data: {
        sessionTaken: true,
      },
    });

    // Cancel any pending reminders
    for (const response of responses) {
      const key = `${queue.id}-${response.tutorId}`;
      const timeout = this.reminderTimeouts.get(key);
      if (timeout) {
        clearTimeout(timeout);
        this.reminderTimeouts.delete(key);
      }

      // Notify tutor that session was taken
      if (this.onSessionTaken && response.tutors?.users?.id) {
        this.onSessionTaken(response.tutors.users.id, conversationId);
      }
    }

    this.logger.log(`Marked conversation ${conversationId} as taken by tutor ${acceptedTutorId}`);
  }

  /**
   * Cancel a waiting queue entry (student cancelled, conversation closed, etc.)
   */
  async cancelWaitingQueue(conversationId: string) {
    const queue = await (this.prisma as any).waiting_queue.findUnique({
      where: { conversationId },
    });

    if (!queue) return;

    // Get all responses to cancel reminders
    const responses = await (this.prisma as any).tutor_availability_responses.findMany({
      where: { waitingQueueId: queue.id },
    });

    // Cancel all pending reminders
    for (const response of responses) {
      const key = `${queue.id}-${response.tutorId}`;
      const timeout = this.reminderTimeouts.get(key);
      if (timeout) {
        clearTimeout(timeout);
        this.reminderTimeouts.delete(key);
      }
    }

    // Update status
    await (this.prisma as any).waiting_queue.update({
      where: { id: queue.id },
      data: { status: 'CANCELLED' },
    });

    this.logger.log(`Cancelled waiting queue for conversation ${conversationId}`);
  }

  /**
   * Start periodic check for conversations that have been waiting more than 2 minutes
   */
  private startWaitingQueueCheck() {
    if (this.checkInterval) return;

    this.checkInterval = setInterval(async () => {
      await this.checkWaitingConversations();
    }, CHECK_INTERVAL_MS);

    this.logger.log('Started waiting queue check interval');
  }

  /**
   * Check for conversations that have been waiting more than 2 minutes
   * and notify busy tutors
   */
  private async checkWaitingConversations() {
    const threshold = new Date(Date.now() - WAITING_THRESHOLD_MS);

    // Find conversations waiting more than 2 minutes that haven't been notified yet
    const waitingQueues = await (this.prisma as any).waiting_queue.findMany({
      where: {
        status: 'WAITING',
        waitStartedAt: { lte: threshold },
        tutorsNotifiedAt: null,
      },
      include: {
        conversations: {
          select: {
            id: true,
            subject: true,
            topic: true,
            status: true,
            students: {
              include: {
                users: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    for (const queue of waitingQueues) {
      // Skip if conversation is no longer pending
      if (queue.conversations?.status !== 'PENDING') {
        await (this.prisma as any).waiting_queue.update({
          where: { id: queue.id },
          data: { status: 'CANCELLED' },
        });
        continue;
      }

      // Get busy tutors for this subject
      const busyTutors = await this.getBusyTutorsForSubject(queue.subject);

      if (busyTutors.length > 0) {
        // Mark as notified
        await (this.prisma as any).waiting_queue.update({
          where: { id: queue.id },
          data: {
            status: 'TUTORS_NOTIFIED',
            tutorsNotifiedAt: new Date(),
          },
        });

        // Notify busy tutors via WebSocket
        if (this.onNotifyBusyTutors) {
          this.onNotifyBusyTutors(queue.conversationId, busyTutors, {
            id: queue.id,
            subject: queue.subject,
            topic: queue.conversations?.topic,
            studentName: queue.conversations?.students?.users?.name || 'Student',
            waitingSince: queue.waitStartedAt,
          });
        }

        this.logger.log(
          `Notified ${busyTutors.length} busy tutors for conversation ${queue.conversationId} (waiting ${Math.ceil((Date.now() - queue.waitStartedAt.getTime()) / 60000)} minutes)`,
        );
      }
    }
  }

  /**
   * Get busy tutors for a subject
   */
  private async getBusyTutorsForSubject(subject: string) {
    const tutors = await (this.prisma as any).tutors.findMany({
      where: {
        isVerified: true,
        isAvailable: true,
        OR: [
          { isBusy: true },
          { currentConversationId: { not: null } },
        ],
        subjects: { has: subject },
      },
      include: {
        users: { select: { id: true, name: true, email: true } },
      },
    });

    return tutors.map((t: any) => ({
      id: t.id,
      odID: t.users.id,
      name: t.users.name || 'Tutor',
      email: t.users.email,
      isBusy: t.isBusy,
      busyUntil: t.busyUntil,
      currentConversationId: t.currentConversationId,
    }));
  }

  /**
   * Cleanup on module destroy
   */
  onModuleDestroy() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
    
    // Clear all pending reminders
    for (const timeout of this.reminderTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.reminderTimeouts.clear();
  }
}




