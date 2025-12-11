import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';

export interface ConversationNotificationData {
  conversationId: string;
  subject: string;
  topic?: string;
  urgency: string;
  studentName: string;
  studentId: string;
}

export interface TutorInfo {
  id: string;
  odID: string;
  name: string;
  email: string;
  isBusy: boolean;
  busyUntil?: Date;
  currentConversationId?: string | null;
}

export interface NotificationResult {
  notifiedTutors: TutorInfo[];
  allTutorsBusy: boolean;
  busyTutorsInfo: Array<{
    name: string;
    busyUntil?: Date;
    estimatedWait?: string;
  }>;
  wave: number;
}

const NOTIFICATION_BATCH_SIZE = 3;
const NOTIFICATION_WAIT_TIME_MS = 60000; // 1 minute

@Injectable()
export class TutorNotificationService {
  private readonly logger = new Logger(TutorNotificationService.name);
  private pendingNotifications: Map<string, NodeJS.Timeout> = new Map();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Start the tutor notification process for a new conversation
   * 
   * Logic:
   * 1. First notify ONLY available tutors (not busy, no active session) in waves of 3
   * 2. Wait 1 minute between waves
   * 3. After all available tutors have been notified and no response, notify busy tutors
   * 4. Busy tutors can SEE the notification but CANNOT accept until they finish their current session
   */
  async notifyTutorsForConversation(
    data: ConversationNotificationData,
    onNotify: (tutors: TutorInfo[], wave: number) => void,
    onAllBusy: (busyInfo: NotificationResult['busyTutorsInfo']) => void,
    onNoTutors: () => void,
  ): Promise<NotificationResult> {
    const { conversationId, subject } = data;

    // Get ONLY available tutors (not busy) for this subject
    const availableTutors = await this.getAvailableTutorsForSubject(subject);
    // Get busy tutors separately
    const busyTutors = await this.getBusyTutorsForSubject(subject);
    
    const totalTutors = availableTutors.length + busyTutors.length;

    if (totalTutors === 0) {
      this.logger.warn(`No tutors found for subject: ${subject}`);
      onNoTutors();
      return {
        notifiedTutors: [],
        allTutorsBusy: false,
        busyTutorsInfo: [],
        wave: 0,
      };
    }

    // If NO available tutors (all are busy with sessions)
    if (availableTutors.length === 0) {
      this.logger.log(`All ${busyTutors.length} tutors for ${subject} are busy with active sessions`);
      
      const busyInfo = busyTutors.map(t => ({
        name: t.name,
        busyUntil: t.busyUntil,
        estimatedWait: t.busyUntil ? this.formatTimeUntil(t.busyUntil) : 'Will be available after current session',
      }));

      onAllBusy(busyInfo);

      // Notify busy tutors - they can see it but cannot accept yet
      await this.notifyBusyTutorsViewOnly(conversationId, busyTutors, data);

      return {
        notifiedTutors: [],
        allTutorsBusy: true,
        busyTutorsInfo: busyInfo,
        wave: 0,
      };
    }

    this.logger.log(`Found ${availableTutors.length} available tutors, ${busyTutors.length} busy tutors for ${subject}`);

    // Start wave 1 - notify first batch of AVAILABLE tutors only
    const result = await this.sendNotificationWave(
      conversationId,
      availableTutors,
      busyTutors,
      data,
      1,
      onNotify,
      onAllBusy,
    );

    return result;
  }

  /**
   * Send a wave of notifications to tutors
   */
  private async sendNotificationWave(
    conversationId: string,
    availableTutors: TutorInfo[],
    busyTutors: TutorInfo[],
    data: ConversationNotificationData,
    wave: number,
    onNotify: (tutors: TutorInfo[], wave: number) => void,
    onAllBusy: (busyInfo: NotificationResult['busyTutorsInfo']) => void,
  ): Promise<NotificationResult> {
    // Get tutors for this wave
    const startIndex = (wave - 1) * NOTIFICATION_BATCH_SIZE;
    const endIndex = startIndex + NOTIFICATION_BATCH_SIZE;
    const tutorsToNotify = availableTutors.slice(startIndex, endIndex);

    if (tutorsToNotify.length === 0) {
      // No more available tutors to notify
      if (busyTutors.length > 0) {
        const busyInfo = busyTutors.map(t => ({
          name: t.name,
          busyUntil: t.busyUntil,
          estimatedWait: t.busyUntil ? this.formatTimeUntil(t.busyUntil) : 'Unknown',
        }));
        onAllBusy(busyInfo);

        // Notify busy tutors
        await this.notifyBusyTutors(conversationId, busyTutors, data);
      }

      return {
        notifiedTutors: [],
        allTutorsBusy: true,
        busyTutorsInfo: busyTutors.map(t => ({
          name: t.name,
          busyUntil: t.busyUntil,
          estimatedWait: t.busyUntil ? this.formatTimeUntil(t.busyUntil) : 'Unknown',
        })),
        wave,
      };
    }

    // Create notification records
    await this.createNotificationRecords(conversationId, tutorsToNotify, wave);

    // Notify the tutors
    onNotify(tutorsToNotify, wave);

    this.logger.log(
      `Wave ${wave}: Notified ${tutorsToNotify.length} tutors for conversation ${conversationId}`,
    );

    // Schedule next wave if there are more tutors
    const hasMoreTutors = endIndex < availableTutors.length;
    if (hasMoreTutors) {
      this.scheduleNextWave(
        conversationId,
        availableTutors,
        busyTutors,
        data,
        wave + 1,
        onNotify,
        onAllBusy,
      );
    } else if (busyTutors.length > 0) {
      // No more available tutors, schedule to check busy tutors
      this.scheduleNotifyBusyTutors(conversationId, busyTutors, data, onAllBusy);
    }

    return {
      notifiedTutors: tutorsToNotify,
      allTutorsBusy: false,
      busyTutorsInfo: [],
      wave,
    };
  }

  /**
   * Create notification records in database
   */
  private async createNotificationRecords(
    conversationId: string,
    tutors: TutorInfo[],
    wave: number,
  ) {
    for (const tutor of tutors) {
      await (this.prisma as any).tutor_notifications.create({
        data: {
          id: uuidv4(),
          conversationId,
          tutorId: tutor.id,
          status: 'PENDING',
          wave,
        },
      });
    }
  }

  /**
   * Schedule the next wave of notifications
   */
  private scheduleNextWave(
    conversationId: string,
    availableTutors: TutorInfo[],
    busyTutors: TutorInfo[],
    data: ConversationNotificationData,
    nextWave: number,
    onNotify: (tutors: TutorInfo[], wave: number) => void,
    onAllBusy: (busyInfo: NotificationResult['busyTutorsInfo']) => void,
  ) {
    // Clear any existing timeout
    this.clearPendingNotification(conversationId);

    const timeout = setTimeout(async () => {
      // Check if conversation was already accepted
      const conversation = await (this.prisma as any).conversations.findUnique({
        where: { id: conversationId },
      });

      if (conversation?.status === 'ASSIGNED' || conversation?.status === 'ACTIVE') {
        this.logger.log(`Conversation ${conversationId} already assigned, skipping wave ${nextWave}`);
        return;
      }

      // Re-check tutor availability (they might have become available/busy)
      const freshTutors = await this.getTutorsForSubject(data.subject);
      const freshAvailable = freshTutors.filter(t => !t.isBusy);
      const freshBusy = freshTutors.filter(t => t.isBusy);

      await this.sendNotificationWave(
        conversationId,
        freshAvailable,
        freshBusy,
        data,
        nextWave,
        onNotify,
        onAllBusy,
      );
    }, NOTIFICATION_WAIT_TIME_MS);

    this.pendingNotifications.set(conversationId, timeout);
  }

  /**
   * Schedule notification to busy tutors
   */
  private scheduleNotifyBusyTutors(
    conversationId: string,
    busyTutors: TutorInfo[],
    data: ConversationNotificationData,
    onAllBusy: (busyInfo: NotificationResult['busyTutorsInfo']) => void,
  ) {
    const timeout = setTimeout(async () => {
      const conversation = await (this.prisma as any).conversations.findUnique({
        where: { id: conversationId },
      });

      if (conversation?.status === 'ASSIGNED' || conversation?.status === 'ACTIVE') {
        return;
      }

      const busyInfo = busyTutors.map(t => ({
        name: t.name,
        busyUntil: t.busyUntil,
        estimatedWait: t.busyUntil ? this.formatTimeUntil(t.busyUntil) : 'Unknown',
      }));

      onAllBusy(busyInfo);
      await this.notifyBusyTutors(conversationId, busyTutors, data);
    }, NOTIFICATION_WAIT_TIME_MS);

    this.pendingNotifications.set(`${conversationId}-busy`, timeout);
  }

  /**
   * Notify busy tutors about a waiting student (view only - they cannot accept yet)
   */
  private async notifyBusyTutorsViewOnly(
    conversationId: string,
    busyTutors: TutorInfo[],
    data: ConversationNotificationData,
  ) {
    // Create notification records for busy tutors marked as VIEW_ONLY
    for (const tutor of busyTutors) {
      await (this.prisma as any).tutor_notifications.create({
        data: {
          id: uuidv4(),
          conversationId,
          tutorId: tutor.id,
          status: 'PENDING',
          wave: -1, // Wave -1 indicates view-only notification for busy tutor
        },
      });
    }

    this.logger.log(
      `Notified ${busyTutors.length} busy tutors (view-only) about waiting student for conversation ${conversationId}`,
    );
  }

  /**
   * Notify busy tutors about a waiting student (legacy method)
   */
  private async notifyBusyTutors(
    conversationId: string,
    busyTutors: TutorInfo[],
    data: ConversationNotificationData,
  ) {
    // Create notification records for busy tutors
    for (const tutor of busyTutors) {
      await (this.prisma as any).tutor_notifications.create({
        data: {
          id: uuidv4(),
          conversationId,
          tutorId: tutor.id,
          status: 'PENDING',
          wave: 0, // Wave 0 indicates busy tutor notification
        },
      });
    }

    this.logger.log(
      `Notified ${busyTutors.length} busy tutors about waiting student for conversation ${conversationId}`,
    );
  }

  /**
   * Check if a tutor can accept a conversation (not busy with another session)
   */
  async canTutorAccept(tutorId: string): Promise<{ canAccept: boolean; reason?: string }> {
    const tutor = await (this.prisma as any).tutors.findUnique({
      where: { id: tutorId },
    });

    if (!tutor) {
      return { canAccept: false, reason: 'Tutor not found' };
    }

    if (tutor.currentConversationId) {
      return { 
        canAccept: false, 
        reason: 'You have an active session. Please complete it before accepting a new one.' 
      };
    }

    if (tutor.isBusy) {
      return { 
        canAccept: false, 
        reason: 'You are marked as busy. Please update your availability first.' 
      };
    }

    return { canAccept: true };
  }

  /**
   * Handle tutor accepting a conversation
   */
  async handleTutorAccept(conversationId: string, tutorId: string): Promise<boolean> {
    // Clear pending notifications
    this.clearPendingNotification(conversationId);
    this.clearPendingNotification(`${conversationId}-busy`);

    // Update notification record
    await (this.prisma as any).tutor_notifications.updateMany({
      where: {
        conversationId,
        tutorId,
        status: 'PENDING',
      },
      data: {
        status: 'ACCEPTED',
        respondedAt: new Date(),
      },
    });

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

    // Mark tutor as busy
    await this.setTutorBusy(tutorId, conversationId);

    return true;
  }

  /**
   * Handle tutor rejecting a conversation
   */
  async handleTutorReject(conversationId: string, tutorId: string) {
    await (this.prisma as any).tutor_notifications.updateMany({
      where: {
        conversationId,
        tutorId,
        status: 'PENDING',
      },
      data: {
        status: 'REJECTED',
        respondedAt: new Date(),
      },
    });
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
   * Update tutor's estimated availability time
   */
  async updateTutorBusyUntil(tutorId: string, busyUntil: Date) {
    await (this.prisma as any).tutors.update({
      where: { id: tutorId },
      data: {
        busyUntil,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Get all tutors for a subject
   */
  private async getTutorsForSubject(subject: string): Promise<TutorInfo[]> {
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
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: [
        { isBusy: 'asc' }, // Available tutors first
        { rating: 'desc' },
        { experience: 'desc' },
      ],
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
   * Get ONLY available (not busy) tutors for a subject
   */
  private async getAvailableTutorsForSubject(subject: string): Promise<TutorInfo[]> {
    const tutors = await (this.prisma as any).tutors.findMany({
      where: {
        isVerified: true,
        isAvailable: true,
        isBusy: false, // ONLY not busy tutors
        currentConversationId: null, // No active session
        subjects: {
          has: subject,
        },
      },
      include: {
        users: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: [
        { rating: 'desc' },
        { experience: 'desc' },
      ],
    });

    return tutors.map((t: any) => ({
      id: t.id,
      odID: t.users.id,
      name: t.users.name || 'Tutor',
      email: t.users.email,
      isBusy: false,
      busyUntil: null,
      currentConversationId: null,
    }));
  }

  /**
   * Get busy tutors for a subject (have active sessions)
   */
  private async getBusyTutorsForSubject(subject: string): Promise<TutorInfo[]> {
    const tutors = await (this.prisma as any).tutors.findMany({
      where: {
        isVerified: true,
        isAvailable: true,
        OR: [
          { isBusy: true },
          { currentConversationId: { not: null } },
        ],
        subjects: {
          has: subject,
        },
      },
      include: {
        users: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: [
        { rating: 'desc' },
        { experience: 'desc' },
      ],
    });

    return tutors.map((t: any) => ({
      id: t.id,
      odID: t.users.id,
      name: t.users.name || 'Tutor',
      email: t.users.email,
      isBusy: true,
      busyUntil: t.busyUntil,
      currentConversationId: t.currentConversationId,
    }));
  }

  /**
   * Clear pending notification timeout
   */
  private clearPendingNotification(conversationId: string) {
    const timeout = this.pendingNotifications.get(conversationId);
    if (timeout) {
      clearTimeout(timeout);
      this.pendingNotifications.delete(conversationId);
    }
  }

  /**
   * Format time until a date
   */
  private formatTimeUntil(date: Date): string {
    const now = new Date();
    const diff = date.getTime() - now.getTime();

    if (diff <= 0) return 'Available soon';

    const minutes = Math.ceil(diff / 60000);
    if (minutes < 60) return `~${minutes} minutes`;

    const hours = Math.ceil(minutes / 60);
    return `~${hours} hour${hours > 1 ? 's' : ''}`;
  }
}

