import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger, UseGuards, Inject, forwardRef } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { GeminiChatGateway } from './gemini-chat.gateway';
import { v4 as uuidv4 } from 'uuid';

interface ConnectedClient {
  socketId: string;
  userId: string;
  role: 'student' | 'tutor';
  sessionId?: string;
  aiSessionId?: string;
}

@WebSocketGateway({
  namespace: '/tutor-session',
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class TutorSessionGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(TutorSessionGateway.name);
  private connectedClients: Map<string, ConnectedClient> = new Map();
  private sessionRooms: Map<string, Set<string>> = new Map(); // sessionId -> socketIds

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => GeminiChatGateway))
    private readonly geminiChatGateway: GeminiChatGateway,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        this.logger.warn(`Client ${client.id} connected without token`);
        client.emit('error', { message: 'Authentication required' });
        client.disconnect();
        return;
      }

      const decoded = this.jwtService.verify(token);
      const userId = decoded.sub;

      // Determine role
      const tutor = await this.prisma.tutors.findUnique({
        where: { userId },
      });

      const role = tutor ? 'tutor' : 'student';

      this.connectedClients.set(client.id, {
        socketId: client.id,
        userId,
        role,
      });

      this.logger.log(`${role} connected: ${userId} (${client.id})`);

      // If tutor, join tutor notification room
      if (role === 'tutor' && tutor) {
        client.join(`tutor:${tutor.id}`);
        client.join('tutors'); // Global tutor room for broadcasts
      }

      client.emit('connected', { userId, role });
    } catch (error: any) {
      this.logger.error(`Connection error: ${error.message}`);
      client.emit('error', { message: 'Invalid token' });
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const clientInfo = this.connectedClients.get(client.id);
    if (clientInfo) {
      this.logger.log(
        `${clientInfo.role} disconnected: ${clientInfo.userId} (${client.id})`,
      );

      // Remove from session rooms
      if (clientInfo.sessionId) {
        this.leaveSessionRoom(client.id, clientInfo.sessionId);
      }

      this.connectedClients.delete(client.id);
    }
  }

  // ============ Session Room Management ============

  @SubscribeMessage('joinSession')
  async handleJoinSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ) {
    const clientInfo = this.connectedClients.get(client.id);
    if (!clientInfo) return;

    const roomName = `session:${data.sessionId}`;
    client.join(roomName);

    if (!this.sessionRooms.has(data.sessionId)) {
      this.sessionRooms.set(data.sessionId, new Set());
    }
    this.sessionRooms.get(data.sessionId)?.add(client.id);

    clientInfo.sessionId = data.sessionId;

    this.logger.log(
      `${clientInfo.role} ${clientInfo.userId} joined session ${data.sessionId}`,
    );

    // Notify others in the room
    client.to(roomName).emit('participantJoined', {
      userId: clientInfo.userId,
      role: clientInfo.role,
    });

    return { success: true };
  }

  @SubscribeMessage('leaveSession')
  handleLeaveSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ) {
    this.leaveSessionRoom(client.id, data.sessionId);
    return { success: true };
  }

  private leaveSessionRoom(socketId: string, sessionId: string) {
    try {
      // Safely check if server and sockets are available
      if (!this.server?.sockets?.sockets) {
        this.logger.warn(`Server sockets not available, cannot leave room for socket ${socketId}`);
        // Still clean up our internal state
        this.sessionRooms.get(sessionId)?.delete(socketId);
        const clientInfo = this.connectedClients.get(socketId);
        if (clientInfo) {
          clientInfo.sessionId = undefined;
        }
        return;
      }

      const client = this.server.sockets.sockets.get(socketId);
      if (client) {
        const roomName = `session:${sessionId}`;
        client.leave(roomName);

        const clientInfo = this.connectedClients.get(socketId);
        if (clientInfo) {
          client.to(roomName).emit('participantLeft', {
            userId: clientInfo.userId,
            role: clientInfo.role,
          });
          clientInfo.sessionId = undefined;
        }
      }

      this.sessionRooms.get(sessionId)?.delete(socketId);
    } catch (error: any) {
      this.logger.error(`Error in leaveSessionRoom: ${error.message}`);
      // Still clean up our internal state even if Socket.IO operations fail
      this.sessionRooms.get(sessionId)?.delete(socketId);
      const clientInfo = this.connectedClients.get(socketId);
      if (clientInfo) {
        clientInfo.sessionId = undefined;
      }
    }
  }

  // ============ Student Subscribes to AI Session Updates ============

  @SubscribeMessage('subscribeToAISession')
  handleSubscribeToAISession(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { aiSessionId: string },
  ) {
    const clientInfo = this.connectedClients.get(client.id);
    if (!clientInfo) return;

    client.join(`ai:${data.aiSessionId}`);
    clientInfo.aiSessionId = data.aiSessionId;

    this.logger.log(
      `Client subscribed to AI session: ${data.aiSessionId}`,
    );

    return { success: true };
  }

  // ============ Live Chat Updates ============

  /**
   * Called when a new AI message is added to a session
   * This notifies connected tutors if live sharing is enabled
   */
  async notifyNewAIMessage(
    aiSessionId: string,
    message: {
      id: string;
      role: string;
      content: string;
      createdAt: Date;
    },
  ) {
    // Get the tutor session
    const tutorSession = await this.prisma.tutor_sessions.findFirst({
      where: {
        aiSessionId,
        status: { in: ['ACCEPTED', 'ACTIVE'] },
        liveSharingConsent: true,
      },
    });

    if (!tutorSession) return;

    // Emit to the session room (tutors watching this session)
    this.server
      .to(`session:${tutorSession.id}`)
      .emit('newAIMessage', message);

    this.logger.log(`Notified session ${tutorSession.id} of new AI message`);
  }

  // ============ Session Events ============

  /**
   * Notify when tutor accepts the session
   */
  async notifyTutorAccepted(
    aiSessionId: string,
    tutorInfo: { name: string; avatar?: string },
    tutorSessionId: string,
    dailyRoomUrl?: string,
  ) {
    const eventData = {
      tutorSessionId,
      tutor: tutorInfo,
      dailyRoomUrl,
    };

    this.logger.log(`🎯 Emitting tutorAccepted to ai:${aiSessionId}`, eventData);

    try {
      // Use GeminiChatGateway to emit to the correct namespace
      if (this.geminiChatGateway) {
        this.geminiChatGateway.server.to(`ai:${aiSessionId}`).emit('tutorAccepted', eventData);
        this.logger.log(`✅ Successfully emitted tutorAccepted via GeminiChatGateway`);
      } else {
        this.logger.error(`❌ GeminiChatGateway not available for emitting tutorAccepted`);
      }
    } catch (error) {
      this.logger.error(`❌ Error emitting tutorAccepted:`, error);
    }
  }

  /**
   * Notify when consent status changes
   */
  async notifyConsentChanged(
    tutorSessionId: string,
    enabled: boolean,
  ) {
    this.server.to(`session:${tutorSessionId}`).emit('consentChanged', {
      liveSharingEnabled: enabled,
    });
  }

  /**
   * Notify when session status changes
   */
  async notifySessionStatusChanged(
    tutorSessionId: string,
    aiSessionId: string,
    status: string,
  ) {
    // Notify tutor session room
    this.server.to(`session:${tutorSessionId}`).emit('sessionStatusChanged', {
      status,
    });

    // Notify student AI session room
    this.server.to(`ai:${aiSessionId}`).emit('sessionStatusChanged', {
      tutorSessionId,
      status,
    });
  }

  // ============ Whiteboard Collaboration ============

  @SubscribeMessage('whiteboardUpdate')
  async handleWhiteboardUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string; elements: any[]; appState?: any },
  ) {
    const clientInfo = this.connectedClients.get(client.id);
    if (!clientInfo || clientInfo.sessionId !== data.sessionId) return;

    try {
      // Save whiteboard data to database
      await this.prisma.tutor_sessions.update({
        where: { id: data.sessionId },
        data: {
          whiteboardData: { elements: data.elements, appState: data.appState },
          whiteboardEnabled: true,
        },
      });
    } catch (error: any) {
      this.logger.error(`Failed to save whiteboard data: ${error.message}`);
    }

    // Broadcast to others in the session
    client.to(`session:${data.sessionId}`).emit('whiteboardUpdate', {
      elements: data.elements,
      appState: data.appState,
      senderId: clientInfo.userId,
    });
  }

  @SubscribeMessage('whiteboardCursor')
  handleWhiteboardCursor(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string; x: number; y: number },
  ) {
    const clientInfo = this.connectedClients.get(client.id);
    if (!clientInfo || clientInfo.sessionId !== data.sessionId) return;

    client.to(`session:${data.sessionId}`).emit('whiteboardCursor', {
      userId: clientInfo.userId,
      x: data.x,
      y: data.y,
    });
  }

  @SubscribeMessage('getWhiteboardData')
  async handleGetWhiteboardData(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ) {
    const clientInfo = this.connectedClients.get(client.id);
    if (!clientInfo || clientInfo.sessionId !== data.sessionId) return;

    try {
      const session = await this.prisma.tutor_sessions.findUnique({
        where: { id: data.sessionId },
        select: { whiteboardData: true, whiteboardEnabled: true },
      });

      return {
        whiteboardData: session?.whiteboardData || { elements: [], appState: {} },
        whiteboardEnabled: session?.whiteboardEnabled || false,
      };
    } catch (error: any) {
      this.logger.error(`Failed to get whiteboard data: ${error.message}`);
      return { whiteboardData: { elements: [], appState: {} }, whiteboardEnabled: false };
    }
  }

  // ============ Chat Messages (Tutor-Student) ============

  @SubscribeMessage('sendChatMessage')
  async handleChatMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string; content: string },
  ) {
    const clientInfo = this.connectedClients.get(client.id);
    if (!clientInfo || clientInfo.sessionId !== data.sessionId) return;

    // Get tutor session to find the conversation
    const tutorSession = await this.prisma.tutor_sessions.findUnique({
      where: { id: data.sessionId },
      select: { ai_chat_sessions: { select: { linkedConversationId: true } } },
    });

    if (!tutorSession?.ai_chat_sessions?.linkedConversationId) {
      return { error: 'No conversation linked to this session' };
    }

    const conversationId = tutorSession.ai_chat_sessions.linkedConversationId;

    // Create message in database using the MessagesService
    try {
      // Get user info
      const user = await this.prisma.user.findUnique({
        where: { id: clientInfo.userId },
        select: { name: true, avatar: true },
      });

      // Get profile ID based on role
      let profileId: string;
      if (clientInfo.role === 'tutor') {
        const tutor = await this.prisma.tutors.findUnique({
          where: { userId: clientInfo.userId },
          select: { id: true },
        });
        profileId = tutor!.id;
      } else {
        const student = await this.prisma.students.findUnique({
          where: { userId: clientInfo.userId },
          select: { id: true },
        });
        profileId = student!.id;
      }

      // Create message in conversations table
      const message = await this.prisma.messages.create({
        data: {
          id: uuidv4(),
          conversationId,
          senderId: profileId,
          senderType: clientInfo.role === 'tutor' ? 'TUTOR' : 'STUDENT',
          content: data.content,
          messageType: 'TEXT',
        },
      });

      const messagePayload = {
        id: message.id,
        senderId: message.senderId,
        senderName: user?.name || 'User',
        senderAvatar: user?.avatar,
        senderType: message.senderType,
        content: message.content,
        messageType: message.messageType,
        createdAt: message.createdAt,
        isRead: message.isRead,
      };

      // Broadcast to session room (including sender)
      this.server.to(`session:${data.sessionId}`).emit('chatMessage', messagePayload);

      // Also broadcast to conversation room for legacy support
      this.server.to(`conversation:${conversationId}`).emit('newMessage', messagePayload);

      return { success: true, message: messagePayload };
    } catch (error: any) {
      this.logger.error(`Failed to send chat message: ${error.message}`);
      return { error: 'Failed to send message' };
    }
  }

  // ============ Chat History ============

  @SubscribeMessage('getChatHistory')
  async handleGetChatHistory(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ) {
    const clientInfo = this.connectedClients.get(client.id);
    if (!clientInfo || clientInfo.sessionId !== data.sessionId) return;

    try {
      // Get tutor session to find the conversation
      const tutorSession = await this.prisma.tutor_sessions.findUnique({
        where: { id: data.sessionId },
        select: { ai_chat_sessions: { select: { linkedConversationId: true } } },
      });

      if (!tutorSession?.ai_chat_sessions?.linkedConversationId) {
        return { messages: [] };
      }

      const conversationId = tutorSession.ai_chat_sessions.linkedConversationId;

      // Get messages from conversation
      const messages = await this.prisma.messages.findMany({
        where: { conversationId },
        include: {
          // We can't easily join users here, so we'll get user info separately
        },
        orderBy: { createdAt: 'asc' },
      });

      // Get user info for each message sender
      const userIds = [...new Set(messages.map(m => m.senderId))];
      const users = await this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, avatar: true },
      });

      const userMap = new Map(users.map(u => [u.id, u]));

      const formattedMessages = messages.map(message => ({
        id: message.id,
        senderId: message.senderId,
        senderName: userMap.get(message.senderId)?.name || 'User',
        senderAvatar: userMap.get(message.senderId)?.avatar,
        senderType: message.senderType,
        content: message.content,
        messageType: message.messageType,
        createdAt: message.createdAt,
        isRead: message.isRead,
      }));

      return { messages: formattedMessages };
    } catch (error: any) {
      this.logger.error(`Failed to get chat history: ${error.message}`);
      return { messages: [] };
    }
  }

  // ============ Call Signaling ============

  @SubscribeMessage('callSignal')
  handleCallSignal(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { sessionId: string; signal: 'mute' | 'unmute' | 'videoOn' | 'videoOff' | 'screenShare' | 'stopScreenShare' },
  ) {
    const clientInfo = this.connectedClients.get(client.id);
    if (!clientInfo || clientInfo.sessionId !== data.sessionId) return;

    client.to(`session:${data.sessionId}`).emit('callSignal', {
      userId: clientInfo.userId,
      signal: data.signal,
    });
  }

  // ============ Typing Indicators ============

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string; isTyping: boolean },
  ) {
    const clientInfo = this.connectedClients.get(client.id);
    if (!clientInfo || clientInfo.sessionId !== data.sessionId) return;

    client.to(`session:${data.sessionId}`).emit('userTyping', {
      userId: clientInfo.userId,
      role: clientInfo.role,
      isTyping: data.isTyping,
    });
  }

  // ============ Broadcasting Helpers ============

  /**
   * Notify all tutors about a new help request
   */
  async notifyTutorsOfNewRequest(
    tutorIds: string[],
    request: {
      tutorSessionId: string;
      topic: string;
      subject: string;
      summary: string;
      studentName: string;
    },
  ) {
    for (const tutorId of tutorIds) {
      this.server.to(`tutor:${tutorId}`).emit('newHelpRequest', request);
    }

    this.logger.log(
      `Notified ${tutorIds.length} tutors of new help request`,
    );
  }

  /**
   * Get connected clients count for a session
   */
  getSessionParticipants(sessionId: string): number {
    return this.sessionRooms.get(sessionId)?.size || 0;
  }
}

