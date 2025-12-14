import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { TutorNotificationService, ConversationNotificationData, TutorInfo } from './tutor-notification.service';
import { WaitingQueueService, TutorAvailabilityResponse } from './waiting-queue.service';
import { ProcessingStatus, ProcessingUpdate } from './messages.service';

interface AuthenticatedSocket extends Socket {
  user?: {
    id: string;
    email: string;
    role: string;
    profileId?: string;
  };
}

@WebSocketGateway({
  namespace: '/messages',
  cors: {
    origin: '*',
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class MessagesGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(MessagesGateway.name);
  private userSockets: Map<string, Set<string>> = new Map();
  private tutorSockets: Map<string, string> = new Map();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly tutorNotificationService: TutorNotificationService,
    private readonly waitingQueueService: WaitingQueueService,
  ) {}

  afterInit() {
    // Register callbacks for WaitingQueueService
    this.waitingQueueService.registerCallbacks({
      onNotifyBusyTutors: (conversationId, tutors, waitingQueue) => {
        this.handleNotifyBusyTutors(conversationId, tutors, waitingQueue);
      },
      onNotifyStudent: (studentUserId, shortestWait, tutorResponses) => {
        this.handleNotifyStudentWaitTime(studentUserId, shortestWait, tutorResponses);
      },
      onRemindTutor: (tutorUserId, conversationId, waitingQueueId) => {
        this.handleRemindTutor(tutorUserId, conversationId, waitingQueueId);
      },
      onSessionTaken: (tutorUserId, conversationId) => {
        this.handleSessionTaken(tutorUserId, conversationId);
      },
    });
    this.logger.log('Waiting queue callbacks registered');
  }

  async handleConnection(socket: AuthenticatedSocket) {
    try {
      const token = socket.handshake.auth?.token || 
                    socket.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        this.logger.warn(`Socket ${socket.id} connection rejected: No token`);
        socket.disconnect();
        return;
      }

      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });

      let profileId: string | undefined;
      if (payload.role === 'STUDENT') {
        const student = await (this.prisma as any).students.findUnique({
          where: { userId: payload.sub },
        });
        profileId = student?.id;
      } else if (payload.role === 'TUTOR') {
        const tutor = await (this.prisma as any).tutors.findUnique({
          where: { userId: payload.sub },
        });
        profileId = tutor?.id;
        if (profileId) {
          this.tutorSockets.set(profileId, socket.id);
        }
      }

      socket.user = {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
        profileId,
      };

      if (!this.userSockets.has(payload.sub)) {
        this.userSockets.set(payload.sub, new Set());
      }
      this.userSockets.get(payload.sub)!.add(socket.id);

      socket.join(`user:${payload.sub}`);
      if (profileId) {
        socket.join(`profile:${profileId}`);
      }

      // Log the rooms this socket joined
      const rooms = Array.from(socket.rooms);
      this.logger.log(`Client connected: ${socket.id} (User: ${payload.email}, Role: ${payload.role})`);
      this.logger.log(`  - Joined rooms: ${rooms.join(', ')}`);
      this.logger.log(`  - User ID: ${payload.sub}`);
      this.logger.log(`  - Profile ID: ${profileId || 'none'}`);
    } catch (error: any) {
      this.logger.warn(`Socket ${socket.id} authentication failed: ${error.message}`);
      socket.disconnect();
    }
  }

  handleDisconnect(socket: AuthenticatedSocket) {
    if (socket.user) {
      const userSockets = this.userSockets.get(socket.user.id);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          this.userSockets.delete(socket.user.id);
        }
      }

      if (socket.user.profileId && socket.user.role === 'TUTOR') {
        this.tutorSockets.delete(socket.user.profileId);
      }
    }
    this.logger.log(`Client disconnected: ${socket.id}`);
  }

  @SubscribeMessage('joinConversation')
  async handleJoinConversation(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() conversationId: string,
  ) {
    if (!socket.user) {
      return { error: 'Not authenticated' };
    }

    const roomName = `conversation:${conversationId}`;
    
    // Check if already in the room to prevent duplicates
    if (socket.rooms.has(roomName)) {
      return { success: true, conversationId, alreadyJoined: true };
    }

    const hasAccess = await this.verifyConversationAccess(
      conversationId,
      socket.user.id,
      socket.user.role,
      socket.user.profileId,
    );

    if (!hasAccess) {
      return { error: 'Access denied' };
    }

    socket.join(roomName);
    this.logger.log(`User ${socket.user.email} joined conversation ${conversationId}`);

    return { success: true, conversationId };
  }

  @SubscribeMessage('leaveConversation')
  handleLeaveConversation(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() conversationId: string,
  ) {
    socket.leave(`conversation:${conversationId}`);
    this.logger.log(`User ${socket.user?.email} left conversation ${conversationId}`);
    return { success: true };
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string; isTyping: boolean },
  ) {
    if (!socket.user) return;

    socket.to(`conversation:${data.conversationId}`).emit('userTyping', {
      conversationId: data.conversationId,
      userId: socket.user.id,
      profileId: socket.user.profileId,
      isTyping: data.isTyping,
    });
  }

  // ============ Send Message via WebSocket ============

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string; content: string; messageType?: string },
  ) {
    if (!socket.user) return { error: 'Not authenticated' };

    this.logger.log(`💬 Message from ${socket.user.email} in conversation ${data.conversationId}`);

    try {
      // Verify access to conversation
      const hasAccess = await this.verifyConversationAccess(
        data.conversationId,
        socket.user.id,
        socket.user.role,
        socket.user.profileId,
      );

      if (!hasAccess) {
        return { error: 'Access denied' };
      }

      // Create the message in database
      const message = await (this.prisma as any).messages.create({
        data: {
          conversationId: data.conversationId,
          senderId: socket.user.profileId,
          senderType: socket.user.role === 'TUTOR' ? 'TUTOR' : 'STUDENT',
          content: data.content,
          messageType: data.messageType || 'TEXT',
        },
      });

      // Update conversation timestamp
      await (this.prisma as any).conversations.update({
        where: { id: data.conversationId },
        data: { updatedAt: new Date() },
      });

      const messagePayload = {
        ...message,
        senderName: socket.user.email,
        senderRole: socket.user.role,
      };

      this.logger.log(`💬 Broadcasting message to conversation:${data.conversationId}`);

      // Broadcast to all in conversation room EXCEPT the sender
      socket.to(`conversation:${data.conversationId}`).emit('newMessage', messagePayload);

      // Return success with the created message (sender gets this as response)
      return { success: true, message: messagePayload };
    } catch (error) {
      this.logger.error(`Failed to send message: ${error.message}`);
      return { error: 'Failed to send message' };
    }
  }

  // ============ Tutor Accepts/Rejects Conversation ============

  @SubscribeMessage('acceptConversation')
  async handleAcceptConversation(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ) {
    if (!socket.user || socket.user.role !== 'TUTOR') {
      return { error: 'Only tutors can accept conversations' };
    }

    try {
      // Check if tutor can accept (not busy with another session)
      const canAccept = await this.tutorNotificationService.canTutorAccept(socket.user.profileId!);
      if (!canAccept.canAccept) {
        this.logger.warn(`Tutor ${socket.user.email} cannot accept: ${canAccept.reason}`);
        return { error: canAccept.reason };
      }

      await this.tutorNotificationService.handleTutorAccept(
        data.conversationId,
        socket.user.profileId!,
      );

      // Mark conversation as taken in waiting queue (notifies other waiting tutors)
      await this.waitingQueueService.markConversationTaken(
        data.conversationId,
        socket.user.profileId!,
      );

      // Get conversation details
      const conversation = await (this.prisma as any).conversations.findUnique({
        where: { id: data.conversationId },
        include: {
          students: {
            include: {
              users: { select: { id: true, name: true } },
            },
          },
        },
      });

      // Notify student that tutor accepted
      if (conversation?.students?.users?.id) {
        this.server.to(`user:${conversation.students.users.id}`).emit('tutorAccepted', {
          conversationId: data.conversationId,
          tutorId: socket.user.profileId,
          tutorName: socket.user.email,
        });
      }

      // Notify other tutors that this conversation is taken
      this.server.to(`subject:${conversation?.subject}`).emit('conversationTaken', {
        conversationId: data.conversationId,
      });

      return { success: true };
    } catch (error: any) {
      return { error: error.message };
    }
  }

  @SubscribeMessage('rejectConversation')
  async handleRejectConversation(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ) {
    if (!socket.user || socket.user.role !== 'TUTOR') {
      return { error: 'Only tutors can reject conversations' };
    }

    await this.tutorNotificationService.handleTutorReject(
      data.conversationId,
      socket.user.profileId!,
    );

    return { success: true };
  }

  // ============ Tutor Busy Status ============

  @SubscribeMessage('setAvailability')
  async handleSetAvailability(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { available: boolean; busyUntil?: string },
  ) {
    if (!socket.user || socket.user.role !== 'TUTOR') {
      return { error: 'Only tutors can set availability' };
    }

    if (data.available) {
      await this.tutorNotificationService.setTutorAvailable(socket.user.profileId!);
    } else {
      await this.tutorNotificationService.setTutorBusy(
        socket.user.profileId!,
        '',
        data.busyUntil ? new Date(data.busyUntil) : undefined,
      );
    }

    return { success: true };
  }

  @SubscribeMessage('updateBusyUntil')
  async handleUpdateBusyUntil(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { busyUntil: string; conversationId?: string },
  ) {
    if (!socket.user || socket.user.role !== 'TUTOR') {
      return { error: 'Only tutors can update busy status' };
    }

    await this.tutorNotificationService.updateTutorBusyUntil(
      socket.user.profileId!,
      new Date(data.busyUntil),
    );

    // If there's a conversation, notify the waiting student
    if (data.conversationId) {
      const conversation = await (this.prisma as any).conversations.findUnique({
        where: { id: data.conversationId },
        include: {
          students: {
            include: { users: { select: { id: true } } },
          },
        },
      });

      if (conversation?.students?.users?.id) {
        this.server.to(`user:${conversation.students.users.id}`).emit('tutorBusyUpdate', {
          tutorId: socket.user.profileId,
          busyUntil: data.busyUntil,
          estimatedWait: this.formatTimeUntil(new Date(data.busyUntil)),
        });
      }
    }

    return { success: true };
  }

  // ============ Waiting Queue & Tutor Availability Response ============

  /**
   * Tutor responds with their estimated availability time
   * Called when busy tutor receives a waiting student notification
   */
  @SubscribeMessage('respondAvailability')
  async handleRespondAvailability(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: {
      conversationId: string;
      responseType: 'MINUTES_5' | 'MINUTES_10' | 'NOT_ANYTIME_SOON' | 'CUSTOM';
      customMinutes?: number;
    },
  ) {
    if (!socket.user || socket.user.role !== 'TUTOR') {
      return { error: 'Only tutors can respond to availability requests' };
    }

    try {
      const result = await this.waitingQueueService.recordTutorAvailability(
        data.conversationId,
        socket.user.profileId!,
        {
          tutorId: socket.user.profileId!,
          responseType: data.responseType,
          customMinutes: data.customMinutes,
        },
      );

      this.logger.log(
        `Tutor ${socket.user.email} responded with availability: ${data.responseType} (free at ${result.freeAt.toISOString()})`,
      );

      return {
        success: true,
        freeAt: result.freeAt,
        minutesUntilFree: result.minutesUntilFree,
        message: `You will be reminded in ${result.minutesUntilFree} minutes to take this session`,
      };
    } catch (error: any) {
      this.logger.error(`Failed to record availability: ${error.message}`);
      return { error: error.message };
    }
  }

  /**
   * Get waiting queue status for a conversation
   */
  @SubscribeMessage('getWaitingQueueStatus')
  async handleGetWaitingQueueStatus(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ) {
    if (!socket.user) {
      return { error: 'Not authenticated' };
    }

    try {
      const queueInfo = await this.waitingQueueService.getWaitingQueue(data.conversationId);

      if (!queueInfo) {
        return { inQueue: false };
      }

      return {
        inQueue: true,
        status: queueInfo.status,
        waitStartedAt: queueInfo.waitStartedAt,
        shortestWaitMinutes: queueInfo.shortestWaitMinutes,
        tutorResponses: queueInfo.tutorResponses,
      };
    } catch (error: any) {
      return { error: error.message };
    }
  }

  // ============ Waiting Queue Callback Handlers (called by WaitingQueueService) ============

  /**
   * Handle notification to busy tutors when student has been waiting 2+ minutes
   */
  private async handleNotifyBusyTutors(
    conversationId: string,
    tutors: any[],
    waitingQueue: any,
  ) {
    // Get full conversation data
    const conversation = await (this.prisma as any).conversations.findUnique({
      where: { id: conversationId },
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
    });

    if (!conversation) return;

    const payload = {
      type: 'WAITING_STUDENT',
      conversation: {
        id: conversation.id,
        subject: conversation.subject,
        topic: conversation.topic,
        urgency: conversation.urgency,
        status: conversation.status,
        createdAt: conversation.createdAt,
        student: {
          id: conversation.students?.id,
          name: conversation.students?.users?.name || 'Student',
          avatar: conversation.students?.users?.avatar,
        },
        lastMessage: conversation.messages[0]?.content || null,
      },
      waitingQueue: {
        id: waitingQueue.id,
        waitingSince: waitingQueue.waitingSince,
        waitingMinutes: Math.ceil((Date.now() - new Date(waitingQueue.waitingSince).getTime()) / 60000),
      },
      requiresAvailabilityResponse: true,
    };

    // Notify each busy tutor
    for (const tutor of tutors) {
      this.server.to(`user:${tutor.odID}`).emit('waitingStudentNotification', payload);
      this.logger.log(`Sent waiting student notification to busy tutor ${tutor.email}`);
    }
  }

  /**
   * Notify student about shortest wait time from tutor responses
   */
  private handleNotifyStudentWaitTime(
    studentUserId: string,
    shortestWait: number,
    tutorResponses: any[],
  ) {
    const payload = {
      shortestWaitMinutes: shortestWait,
      message: shortestWait <= 5
        ? 'A tutor will be available very soon!'
        : `A tutor will be available in approximately ${shortestWait} minutes`,
      tutorResponses: tutorResponses.map(r => ({
        tutorName: r.tutorName,
        minutesUntilFree: r.minutesUntilFree,
      })),
    };

    this.server.to(`user:${studentUserId}`).emit('tutorAvailabilityUpdate', payload);
    this.logger.log(`Notified student ${studentUserId} about wait time: ${shortestWait} minutes`);
  }

  /**
   * Remind tutor that their availability time has come
   */
  private async handleRemindTutor(
    tutorUserId: string,
    conversationId: string,
    waitingQueueId: string,
  ) {
    // Get conversation details
    const conversation = await (this.prisma as any).conversations.findUnique({
      where: { id: conversationId },
      include: {
        students: {
          include: {
            users: { select: { id: true, name: true, avatar: true } },
          },
        },
      },
    });

    if (!conversation || conversation.status !== 'PENDING') {
      return;
    }

    const payload = {
      type: 'AVAILABILITY_REMINDER',
      conversationId,
      waitingQueueId,
      message: 'You said you would be free by now. A student is still waiting for help!',
      conversation: {
        id: conversation.id,
        subject: conversation.subject,
        topic: conversation.topic,
        student: {
          id: conversation.students?.id,
          name: conversation.students?.users?.name || 'Student',
          avatar: conversation.students?.users?.avatar,
        },
      },
      canAcceptNow: true,
    };

    this.server.to(`user:${tutorUserId}`).emit('availabilityReminder', payload);
    this.logger.log(`Sent availability reminder to tutor ${tutorUserId} for conversation ${conversationId}`);
  }

  /**
   * Notify tutor that the session they were waiting for has been taken by another tutor
   */
  private handleSessionTaken(tutorUserId: string, conversationId: string) {
    const payload = {
      conversationId,
      message: 'This session has been taken by another tutor',
    };

    this.server.to(`user:${tutorUserId}`).emit('sessionTaken', payload);
    this.logger.log(`Notified tutor ${tutorUserId} that session ${conversationId} was taken`);
  }

  // ============ WebRTC Signaling for Audio/Video Calls ============
  
  // Track active calls to prevent duplicates
  private activeCalls: Map<string, { callerId: string; timestamp: number }> = new Map();

  @SubscribeMessage('callInitiate')
  async handleCallInitiate(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string; callType: 'audio' | 'video' },
  ) {
    if (!socket.user) return { error: 'Not authenticated' };

    // Prevent duplicate call initiation
    const existingCall = this.activeCalls.get(data.conversationId);
    if (existingCall && Date.now() - existingCall.timestamp < 30000) {
      this.logger.warn(`📞 Duplicate call prevented for conversation ${data.conversationId}`);
      return { error: 'Call already in progress' };
    }

    // Mark call as active
    this.activeCalls.set(data.conversationId, {
      callerId: socket.user.id,
      timestamp: Date.now(),
    });

    this.logger.log(`📞 Call initiated by ${socket.user.email} for conversation ${data.conversationId}`);

    // Get the other participant in the conversation
    const conversation = await (this.prisma as any).conversations.findUnique({
      where: { id: data.conversationId },
      include: {
        students: { include: { users: { select: { id: true } } } },
        tutors: { include: { users: { select: { id: true } } } },
      },
    });

    if (!conversation) {
      return { error: 'Conversation not found' };
    }

    // Determine who to notify (the other person)
    const studentUserId = conversation.students?.users?.id;
    const tutorUserId = conversation.tutors?.users?.id;
    const targetUserId = socket.user.id === studentUserId ? tutorUserId : studentUserId;

    if (!targetUserId) {
      return { error: 'No recipient found for call' };
    }

    this.logger.log(`📞 Notifying user ${targetUserId} about incoming call`);

    // Log call initiation
    const callType = data.callType?.toUpperCase() === 'VIDEO' ? 'VIDEO' : 'AUDIO';
    await this.logCallEvent(data.conversationId, socket.user.id, 'INITIATED', undefined, callType);

    // Emit ONLY to the target user's room (not conversation room to avoid duplicates)
    this.server.to(`user:${targetUserId}`).emit('incomingCall', {
      conversationId: data.conversationId,
      callerId: socket.user.id,
      callerProfileId: socket.user.profileId,
      callType: data.callType,
    });

    return { success: true, message: 'Call initiated' };
  }

  @SubscribeMessage('callAccept')
  async handleCallAccept(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string; callerId?: string },
  ) {
    if (!socket.user) return { error: 'Not authenticated' };

    // Get caller ID from the active calls map if not provided
    let callerId = data.callerId;
    if (!callerId) {
      const activeCall = this.activeCalls.get(data.conversationId);
      callerId = activeCall?.callerId;
      this.logger.log(`📞 CallerId not in payload, got from activeCalls: ${callerId}`);
    }

    // If still no callerId, get the other participant from conversation
    if (!callerId) {
      const conversation = await (this.prisma as any).conversations.findUnique({
        where: { id: data.conversationId },
        include: {
          students: { include: { users: { select: { id: true } } } },
          tutors: { include: { users: { select: { id: true } } } },
        },
      });

      const studentUserId = conversation?.students?.users?.id;
      const tutorUserId = conversation?.tutors?.users?.id;
      callerId = socket.user.id === studentUserId ? tutorUserId : studentUserId;
      this.logger.log(`📞 CallerId from conversation: ${callerId}`);
    }

    this.logger.log(`📞 Call accepted by ${socket.user.email}, notifying caller: ${callerId}`);

    const acceptPayload = {
      conversationId: data.conversationId,
      acceptedBy: socket.user.id,
      acceptedByProfileId: socket.user.profileId,
      accepterName: socket.user.email,
    };

    // Emit to caller's user room
    if (callerId) {
      this.server.to(`user:${callerId}`).emit('callAccepted', acceptPayload);
      this.logger.log(`📞 Emitted callAccepted to user:${callerId}`);
    }

    // Also emit to conversation room as backup
    this.server.to(`conversation:${data.conversationId}`).emit('callAccepted', acceptPayload);
    this.logger.log(`📞 Emitted callAccepted to conversation:${data.conversationId}`);

    // Log call answered event
    await this.logCallEvent(data.conversationId, socket.user.id, 'ANSWERED');

    return { success: true, message: 'Call accepted', callerId };
  }

  @SubscribeMessage('callReject')
  async handleCallReject(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string; callerId?: string; reason?: string },
  ) {
    if (!socket.user) return { error: 'Not authenticated' };

    this.logger.log(`📞 Call rejected by ${socket.user.email}, reason: ${data.reason || 'declined'}`);

    // Get caller ID from active calls if not provided
    let callerId = data.callerId;
    if (!callerId) {
      const activeCall = this.activeCalls.get(data.conversationId);
      callerId = activeCall?.callerId;
    }

    // If still no callerId, get from conversation
    if (!callerId) {
      callerId = await this.getOtherParticipant(data.conversationId, socket.user.id);
    }

    // Clear active call
    this.activeCalls.delete(data.conversationId);

    const rejectPayload = {
      conversationId: data.conversationId,
      rejecterId: socket.user.id,
      rejectedBy: socket.user.id,
      rejectedByName: socket.user.email,
      reason: data.reason || 'declined',
    };

    // Emit to caller's user room
    if (callerId) {
      this.server.to(`user:${callerId}`).emit('callRejected', rejectPayload);
      this.logger.log(`📞 Emitted callRejected to user:${callerId} with reason: ${data.reason || 'declined'}`);
    }

    // Also emit to conversation room as backup
    socket.to(`conversation:${data.conversationId}`).emit('callRejected', rejectPayload);

    // Log the call rejection in database
    await this.logCallEvent(data.conversationId, socket.user.id, 'REJECTED', data.reason);

    return { success: true, reason: data.reason };
  }

  @SubscribeMessage('callEnd')
  async handleCallEnd(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string; reason?: string },
  ) {
    if (!socket.user) return { error: 'Not authenticated' };

    this.logger.log(`📞 Call ended by ${socket.user.email}`);

    // Log call ended event
    await this.logCallEvent(data.conversationId, socket.user.id, 'ENDED', data.reason);

    // Clear active call
    this.activeCalls.delete(data.conversationId);

    // Get the other participant
    const targetUserId = await this.getOtherParticipant(data.conversationId, socket.user.id);

    if (targetUserId) {
      this.server.to(`user:${targetUserId}`).emit('callEnded', {
        conversationId: data.conversationId,
        endedBy: socket.user.id,
        reason: data.reason || 'completed',
      });
    }

    // Also emit to conversation room
    socket.to(`conversation:${data.conversationId}`).emit('callEnded', {
      conversationId: data.conversationId,
      endedBy: socket.user.id,
      reason: data.reason || 'completed',
    });

    return { success: true };
  }

  @SubscribeMessage('webrtcOffer')
  async handleWebRTCOffer(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string; targetUserId?: string; offer: any },
  ) {
    if (!socket.user) return { error: 'Not authenticated' };

    // Get target user from conversation if not provided
    let targetUserId = data.targetUserId;
    if (!targetUserId) {
      targetUserId = await this.getOtherParticipant(data.conversationId, socket.user.id);
    }

    this.logger.log(`🔗 WebRTC offer from ${socket.user.email} to ${targetUserId}`);

    if (targetUserId) {
      this.server.to(`user:${targetUserId}`).emit('webrtcOffer', {
        conversationId: data.conversationId,
        fromUserId: socket.user.id,
        offer: data.offer,
      });
    }

    // Also emit to conversation room as backup
    socket.to(`conversation:${data.conversationId}`).emit('webrtcOffer', {
      conversationId: data.conversationId,
      fromUserId: socket.user.id,
      offer: data.offer,
    });

    return { success: true };
  }

  @SubscribeMessage('webrtcAnswer')
  async handleWebRTCAnswer(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string; targetUserId?: string; answer: any },
  ) {
    if (!socket.user) return { error: 'Not authenticated' };

    // Get target user from conversation if not provided
    let targetUserId = data.targetUserId;
    if (!targetUserId) {
      targetUserId = await this.getOtherParticipant(data.conversationId, socket.user.id);
    }

    this.logger.log(`🔗 WebRTC answer from ${socket.user.email} to ${targetUserId}`);

    if (targetUserId) {
      this.server.to(`user:${targetUserId}`).emit('webrtcAnswer', {
        conversationId: data.conversationId,
        fromUserId: socket.user.id,
        answer: data.answer,
      });
    }

    // Also emit to conversation room as backup
    socket.to(`conversation:${data.conversationId}`).emit('webrtcAnswer', {
      conversationId: data.conversationId,
      fromUserId: socket.user.id,
      answer: data.answer,
    });

    return { success: true };
  }

  // Helper to get the other participant in a conversation
  private async getOtherParticipant(conversationId: string, currentUserId: string): Promise<string | undefined> {
    const conversation = await (this.prisma as any).conversations.findUnique({
      where: { id: conversationId },
      include: {
        students: { include: { users: { select: { id: true } } } },
        tutors: { include: { users: { select: { id: true } } } },
      },
    });

    const studentUserId = conversation?.students?.users?.id;
    const tutorUserId = conversation?.tutors?.users?.id;
    
    return currentUserId === studentUserId ? tutorUserId : studentUserId;
  }

  // Track active call log IDs
  private activeCallLogIds: Map<string, string> = new Map();

  // Log call events to database
  private async logCallEvent(
    conversationId: string,
    userId: string,
    event: 'INITIATED' | 'ANSWERED' | 'REJECTED' | 'ENDED' | 'MISSED',
    reason?: string,
    callType: 'AUDIO' | 'VIDEO' = 'AUDIO',
  ): Promise<string | null> {
    try {
      const receiverId = await this.getOtherParticipant(conversationId, userId);

      if (event === 'INITIATED') {
        // Create a new call log
        const callLog = await (this.prisma as any).call_logs.create({
          data: {
            conversationId,
            callerId: userId,
            receiverId,
            callType,
            status: 'INITIATED',
            startedAt: new Date(),
          },
        });
        this.activeCallLogIds.set(conversationId, callLog.id);
        this.logger.log(`📞 Call log created: ${callLog.id}`);

        // Also create a system message in the conversation
        await this.createCallSystemMessage(conversationId, userId, 'INITIATED', callType);

        return callLog.id;
      }

      // Get the active call log for this conversation
      const callLogId = this.activeCallLogIds.get(conversationId);
      if (!callLogId) {
        this.logger.warn(`No active call log found for conversation ${conversationId}`);
        return null;
      }

      if (event === 'ANSWERED') {
        await (this.prisma as any).call_logs.update({
          where: { id: callLogId },
          data: {
            status: 'ANSWERED',
            answeredAt: new Date(),
          },
        });
        await this.createCallSystemMessage(conversationId, userId, 'ANSWERED', callType);
      } else if (event === 'REJECTED') {
        await (this.prisma as any).call_logs.update({
          where: { id: callLogId },
          data: {
            status: 'REJECTED',
            endedAt: new Date(),
            endReason: reason || 'declined',
          },
        });
        await this.createCallSystemMessage(conversationId, userId, 'REJECTED', callType, reason);
        this.activeCallLogIds.delete(conversationId);
      } else if (event === 'ENDED') {
        const callLog = await (this.prisma as any).call_logs.findUnique({
          where: { id: callLogId },
        });
        
        const duration = callLog?.answeredAt 
          ? Math.floor((Date.now() - new Date(callLog.answeredAt).getTime()) / 1000)
          : 0;

        await (this.prisma as any).call_logs.update({
          where: { id: callLogId },
          data: {
            status: 'ENDED',
            endedAt: new Date(),
            duration,
            endReason: reason || 'completed',
          },
        });
        await this.createCallSystemMessage(conversationId, userId, 'ENDED', callType, undefined, duration);
        this.activeCallLogIds.delete(conversationId);
      } else if (event === 'MISSED') {
        await (this.prisma as any).call_logs.update({
          where: { id: callLogId },
          data: {
            status: 'MISSED',
            endedAt: new Date(),
            endReason: 'no answer',
          },
        });
        await this.createCallSystemMessage(conversationId, userId, 'MISSED', callType);
        this.activeCallLogIds.delete(conversationId);
      }

      return callLogId;
    } catch (error) {
      this.logger.error(`Failed to log call event: ${error.message}`);
      return null;
    }
  }

  // Create a system message for call events
  private async createCallSystemMessage(
    conversationId: string,
    userId: string,
    event: string,
    callType: string,
    reason?: string,
    duration?: number,
  ) {
    try {
      let content = '';
      
      switch (event) {
        case 'INITIATED':
          content = `📞 ${callType} call started`;
          break;
        case 'ANSWERED':
          content = `📞 ${callType} call connected`;
          break;
        case 'REJECTED':
          content = reason 
            ? `📞 ${callType} call declined: "${reason}"`
            : `📞 ${callType} call declined`;
          break;
        case 'ENDED':
          content = duration && duration > 0
            ? `📞 ${callType} call ended (${this.formatDuration(duration)})`
            : `📞 ${callType} call ended`;
          break;
        case 'MISSED':
          content = `📞 Missed ${callType} call`;
          break;
      }

      const message = await (this.prisma as any).messages.create({
        data: {
          id: require('uuid').v4(),
          conversationId,
          senderId: userId,
          senderType: 'SYSTEM',
          content,
          messageType: 'TEXT',
        },
      });

      // Broadcast the system message
      this.server.to(`conversation:${conversationId}`).emit('newMessage', {
        ...message,
        isSystemMessage: true,
        callEvent: event,
      });

      return message;
    } catch (error) {
      this.logger.error(`Failed to create call system message: ${error.message}`);
      return null;
    }
  }

  private formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  }

  @SubscribeMessage('webrtcIceCandidate')
  async handleICECandidate(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string; targetUserId?: string; candidate: any },
  ) {
    if (!socket.user) return { error: 'Not authenticated' };

    // Get target user from conversation if not provided
    let targetUserId = data.targetUserId;
    if (!targetUserId) {
      targetUserId = await this.getOtherParticipant(data.conversationId, socket.user.id);
    }

    this.logger.log(`🔗 ICE candidate from ${socket.user.email} to ${targetUserId}`);

    if (targetUserId) {
      this.server.to(`user:${targetUserId}`).emit('webrtcIceCandidate', {
        conversationId: data.conversationId,
        fromUserId: socket.user.id,
        candidate: data.candidate,
      });
    }

    // Also emit to conversation room as backup
    socket.to(`conversation:${data.conversationId}`).emit('webrtcIceCandidate', {
      conversationId: data.conversationId,
      fromUserId: socket.user.id,
      candidate: data.candidate,
    });

    return { success: true };
  }

  @SubscribeMessage('inviteToCall')
  async handleInviteToCall(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string; inviteUserId: string },
  ) {
    if (!socket.user) return;

    if (socket.user.role !== 'TUTOR') {
      return { error: 'Only tutors can invite others to calls' };
    }

    this.server.to(`user:${data.inviteUserId}`).emit('callInvitation', {
      conversationId: data.conversationId,
      invitedBy: socket.user.id,
      inviterProfileId: socket.user.profileId,
    });

    return { success: true };
  }

  // ============ Server-side emit methods ============

  /**
   * Emit processing status update to student
   */
  emitProcessingStatus(studentUserId: string, update: ProcessingUpdate) {
    this.server.to(`user:${studentUserId}`).emit('processingStatus', update);
  }

  /**
   * Emit new message to conversation participants
   * The sender already gets the message from the HTTP response
   */
  async emitNewMessage(conversationId: string, message: any, senderUserId?: string) {
    this.logger.log(`💬 Emitting newMessage to conversation ${conversationId}`);
    
    // Get all sockets in the conversation room for debugging
    const socketsInRoom = await this.server.in(`conversation:${conversationId}`).fetchSockets();
    this.logger.log(`💬 Found ${socketsInRoom.length} sockets in conversation room`);
    
    // Emit to the conversation room
    this.server.to(`conversation:${conversationId}`).emit('newMessage', message);

    // ALSO emit to user rooms as backup (in case they haven't joined conversation room)
    try {
      const conversation = await (this.prisma as any).conversations.findUnique({
        where: { id: conversationId },
        include: {
          students: { include: { users: { select: { id: true } } } },
          tutors: { include: { users: { select: { id: true } } } },
        },
      });

      const studentUserId = conversation?.students?.users?.id;
      const tutorUserId = conversation?.tutors?.users?.id;

      // Emit to student's user room (if not the sender)
      if (studentUserId && studentUserId !== senderUserId) {
        this.server.to(`user:${studentUserId}`).emit('newMessage', message);
        this.logger.log(`💬 Also emitted to user:${studentUserId}`);
      }

      // Emit to tutor's user room (if not the sender)
      if (tutorUserId && tutorUserId !== senderUserId) {
        this.server.to(`user:${tutorUserId}`).emit('newMessage', message);
        this.logger.log(`💬 Also emitted to user:${tutorUserId}`);
      }
    } catch (error) {
      this.logger.error(`Failed to emit to user rooms: ${error.message}`);
    }
  }

  // Track recently notified conversations to prevent duplicates
  private recentlyNotifiedConversations: Set<string> = new Set();

  /**
   * Start the smart tutor notification process - emits newPendingConversation to tutors
   */
  async startTutorNotification(
    data: ConversationNotificationData,
    studentUserId: string,
    fullConversation: any, // Full conversation object from controller
  ) {
    // Prevent duplicate notifications for the same conversation
    if (this.recentlyNotifiedConversations.has(data.conversationId)) {
      this.logger.warn(`Duplicate notification prevented for conversation ${data.conversationId}`);
      return null;
    }

    // Mark as notified (clear after 5 seconds to allow retries if needed)
    this.recentlyNotifiedConversations.add(data.conversationId);
    setTimeout(() => {
      this.recentlyNotifiedConversations.delete(data.conversationId);
    }, 5000);

    // Add to waiting queue for 2-minute timeout tracking
    const isInQueue = await this.waitingQueueService.isInWaitingQueue(data.conversationId);
    if (!isInQueue) {
      await this.waitingQueueService.addToWaitingQueue(
        data.conversationId,
        data.studentId,
        data.subject,
      );
    }

    // Emit initial status to student
    this.emitProcessingStatus(studentUserId, {
      status: ProcessingStatus.NOTIFYING_TUTORS,
      message: 'Finding available tutors for you...',
      progress: 75,
    });

    // Broadcast to tutors with matching subject (SINGLE notification)
    const tutorsNotified = await this.broadcastNewPendingConversation(data.subject, fullConversation);

    // Start the smart notification service for wave management
    const result = await this.tutorNotificationService.notifyTutorsForConversation(
      data,
      // onNotify callback - called for each wave (updates student status only)
      (tutors: TutorInfo[], wave: number) => {
        this.logger.log(`Wave ${wave}: ${tutors.length} tutors for conversation ${data.conversationId}`);
        
        // Update student status
        this.emitProcessingStatus(studentUserId, {
          status: ProcessingStatus.WAITING_FOR_TUTOR,
          message: `Notified ${tutors.length} tutor${tutors.length > 1 ? 's' : ''}. Waiting for response...`,
          progress: 85,
          data: { tutorsNotified: tutors.length, wave },
        });

        // For subsequent waves, emit notification again
        if (wave > 1) {
          for (const tutor of tutors) {
            this.server.to(`user:${tutor.odID}`).emit('newPendingConversation', {
              conversation: fullConversation,
              wave,
            });
          }
        }
      },
      // onAllBusy callback
      (busyInfo) => {
        this.emitProcessingStatus(studentUserId, {
          status: ProcessingStatus.ALL_TUTORS_BUSY,
          message: 'All tutors are currently busy. We\'ve notified them about your request.',
          progress: 90,
          data: {
            busyTutors: busyInfo,
            estimatedWaitTime: busyInfo[0]?.estimatedWait || 'Unknown',
          },
        });

        this.server.to(`user:${studentUserId}`).emit('allTutorsBusy', {
          conversationId: data.conversationId,
          busyTutors: busyInfo,
          message: 'All tutors are currently helping other students. You\'ve been added to the queue.',
        });
      },
      // onNoTutors callback
      () => {
        this.emitProcessingStatus(studentUserId, {
          status: ProcessingStatus.ERROR,
          message: `No tutors available for ${data.subject}. Please try again later or choose a different subject.`,
          progress: 0,
        });
      },
    );

    return result;
  }

  /**
   * Broadcast newPendingConversation to AVAILABLE tutors with matching subject
   * ONLY notifies tutors who are NOT busy and have no active session
   * Uses SINGLE emit to avoid duplicates
   */
  async broadcastNewPendingConversation(subject: string, conversation: any) {
    this.logger.log(`🚀 Broadcasting newPendingConversation for ${subject}, conv: ${conversation.id}`);

    // Find ONLY AVAILABLE tutors (not busy, no active session) with matching subject
    const tutors = await (this.prisma as any).tutors.findMany({
      where: {
        isVerified: true,
        isAvailable: true,
        isBusy: false,  // NOT busy
        currentConversationId: null,  // No active session
        subjects: { has: subject },
      },
      select: {
        id: true,
        userId: true,
        users: { select: { email: true } }
      },
    });

    this.logger.log(`📋 Found ${tutors.length} AVAILABLE tutors with subject ${subject}`);

    // If no available tutors, don't broadcast (TutorNotificationService will handle busy tutors)
    if (tutors.length === 0) {
      this.logger.log(`⏳ No available tutors for ${subject} - busy tutors will be notified later`);
      return 0;
    }

    const payload = { conversation, wave: 1 };
    const notifiedTutorIds = new Set<string>();

    // Emit ONLY to AVAILABLE tutors with matching subject (to their user room)
    for (const tutor of tutors) {
      if (!notifiedTutorIds.has(tutor.userId)) {
        this.server.to(`user:${tutor.userId}`).emit('newPendingConversation', payload);
        notifiedTutorIds.add(tutor.userId);
        this.logger.log(`📢 Notified AVAILABLE tutor: ${tutor.users?.email}`);
      }
    }

    this.logger.log(`✅ Broadcast complete - notified ${notifiedTutorIds.size} available tutors`);
    return tutors.length;
  }

  /**
   * Debug endpoint - get connected clients count
   */
  @SubscribeMessage('debug')
  async handleDebug(@ConnectedSocket() socket: AuthenticatedSocket) {
    const allSockets = await this.server.fetchSockets();
    const connectedClients = allSockets.map(s => ({
      id: s.id,
      rooms: Array.from(s.rooms),
    }));
    
    this.logger.log(`🔍 DEBUG: ${allSockets.length} connected clients`);
    
    return {
      connectedClients: allSockets.length,
      clients: connectedClients,
      yourSocketId: socket.id,
      yourRooms: Array.from(socket.rooms),
    };
  }

  /**
   * Debug - test emit to specific socket
   */
  @SubscribeMessage('testNotification')
  async handleTestNotification(@ConnectedSocket() socket: AuthenticatedSocket) {
    this.logger.log(`🧪 TEST: Sending test notification to socket ${socket.id}`);
    
    const testPayload = {
      conversation: {
        id: 'test-' + Date.now(),
        subject: 'TEST',
        topic: 'Test Notification',
        status: 'PENDING',
        student: {
          id: 'test-student',
          user: {
            name: 'Test Student',
            email: 'test@test.com',
          },
        },
        messages: [],
        createdAt: new Date().toISOString(),
      },
    };

    // Emit directly to this socket
    socket.emit('newPendingConversation', testPayload);
    
    // Also broadcast to all
    this.server.emit('newPendingConversation', testPayload);
    
    this.logger.log('🧪 TEST: Notification sent');
    
    return { success: true, message: 'Test notification sent' };
  }

  /**
   * Get connected sockets info (for debugging via HTTP)
   */
  async getConnectedSocketsInfo() {
    const allSockets = await this.server.fetchSockets();
    const socketInfo = allSockets.map(s => {
      const data = (s as any).data || {};
      return {
        id: s.id,
        rooms: Array.from(s.rooms),
        user: data.user || null,
      };
    });

    return {
      namespace: '/messages',
      totalConnected: allSockets.length,
      sockets: socketInfo,
    };
  }

  /**
   * Simple emit test (for debugging via HTTP) - sends SINGLE notification
   */
  async simpleEmitTest() {
    const allSockets = await this.server.fetchSockets();
    this.logger.log(`🧪 Test emit to ${allSockets.length} sockets`);

    const testPayload = {
      conversation: {
        id: 'test-' + Date.now(),
        subject: 'TEST',
        topic: 'Test Notification',
        status: 'PENDING',
        student: {
          id: 'test-student',
          user: { name: 'Test User', email: 'test@test.com' },
        },
        messages: [],
        createdAt: new Date().toISOString(),
      },
    };

    // Single global emit (not to each socket individually)
    this.server.emit('newPendingConversation', testPayload);

    return {
      success: true,
      socketsCount: allSockets.length,
      socketIds: allSockets.map(s => s.id),
      message: 'Single test notification sent',
    };
  }

  /**
   * Notify tutor about new assignment
   */
  notifyTutorAssignment(
    tutorProfileId: string,
    tutorUserId: string,
    conversationData: {
      conversationId: string;
      subject: string;
      urgency: string;
      studentName: string;
      topic?: string;
    },
  ) {
    this.server.to(`profile:${tutorProfileId}`).emit('newAssignment', conversationData);
    this.server.to(`user:${tutorUserId}`).emit('newAssignment', conversationData);
  }

  /**
   * Notify about conversation status change
   */
  emitStatusChange(conversationId: string, status: string) {
    this.server.to(`conversation:${conversationId}`).emit('statusChange', {
      conversationId,
      status,
    });
  }

  /**
   * Notify student that tutor has been assigned
   */
  notifyStudentTutorAssigned(
    studentUserId: string,
    conversationId: string,
    tutorInfo: { id: string; name: string; avatar?: string },
  ) {
    this.emitProcessingStatus(studentUserId, {
      status: ProcessingStatus.TUTOR_ASSIGNED,
      message: `${tutorInfo.name} is ready to help you!`,
      progress: 100,
      data: { tutor: tutorInfo, conversationId },
    });

    this.server.to(`user:${studentUserId}`).emit('tutorAssigned', {
      conversationId,
      tutor: tutorInfo,
    });
  }

  /**
   * Notify available tutors about new pending conversation
   */
  async notifyAvailableTutors(
    subject: string,
    conversationData: {
      conversationId: string;
      subject: string;
      urgency: string;
      studentName: string;
      topic?: string;
    },
  ) {
    const tutors = await (this.prisma as any).tutors.findMany({
      where: {
        isAvailable: true,
        isVerified: true,
        isBusy: false,
        subjects: {
          has: subject,
        },
      },
      select: {
        id: true,
        userId: true,
      },
      take: 3,
    });

    for (const tutor of tutors) {
      this.server.to(`profile:${tutor.id}`).emit('newPendingConversation', conversationData);
      this.server.to(`user:${tutor.userId}`).emit('newPendingConversation', conversationData);
    }

    return tutors.length;
  }

  // ============ Private Helper Methods ============

  private async verifyConversationAccess(
    conversationId: string,
    userId: string,
    userRole: string,
    profileId?: string,
  ): Promise<boolean> {
    if (userRole === 'ADMIN') return true;

    const conversation = await (this.prisma as any).conversations.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) return false;

    if (userRole === 'STUDENT') {
      return conversation.studentId === profileId;
    }

    if (userRole === 'TUTOR') {
      // Tutors can access if assigned OR if conversation is pending (to accept)
      return conversation.tutorId === profileId || conversation.status === 'PENDING';
    }

    return false;
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
}
