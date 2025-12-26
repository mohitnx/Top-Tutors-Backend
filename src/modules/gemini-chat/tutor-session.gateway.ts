import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, Inject, forwardRef } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';

// Forward reference to avoid circular dependency
import { GeminiChatGateway } from './gemini-chat.gateway';

interface ConnectedClient {
  socketId: string;
  userId: string;
  role: 'student' | 'tutor';
  sessionId?: string;
}

@WebSocketGateway({
  namespace: '/tutor-session',
  cors: {
    origin: '*',
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class TutorSessionGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(TutorSessionGateway.name);
  private connectedClients: Map<string, ConnectedClient> = new Map();
  private sessionRooms: Map<string, Set<string>> = new Map();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => GeminiChatGateway))
    private readonly geminiChatGateway: GeminiChatGateway,
  ) {}

  // ============ Connection Handling ============

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        this.logger.warn(`Socket ${client.id} rejected: No token`);
        client.emit('error', { message: 'No authentication token provided' });
        client.disconnect();
        return;
      }

      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });

      const userId = payload.sub;

      // Check if user is a tutor or student
      const tutor = await this.prisma.tutors.findUnique({
        where: { userId },
      });

      const role: 'tutor' | 'student' = tutor ? 'tutor' : 'student';

      this.connectedClients.set(client.id, {
        socketId: client.id,
        userId,
        role,
      });

      this.logger.log(`✅ ${role} connected: ${userId} (${client.id})`);

      // If tutor, join tutor notification room
      if (role === 'tutor' && tutor) {
        client.join(`tutor:${tutor.id}`);
        client.join('tutors'); // Global tutor room for broadcasts
      }

      // Join user-specific room for targeted messages
      client.join(`user:${userId}`);

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
        `❌ ${clientInfo.role} disconnected: ${clientInfo.userId} (${client.id})`,
      );

      // Remove from session rooms and notify others
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
    if (!clientInfo) {
      this.logger.warn(`joinSession called but no clientInfo for ${client.id}`);
      return { success: false, error: 'Not authenticated' };
    }

    const { sessionId } = data;
    const roomName = `session:${sessionId}`;

    // Join the socket.io room
    client.join(roomName);

    // Track in our session rooms map
    if (!this.sessionRooms.has(sessionId)) {
      this.sessionRooms.set(sessionId, new Set());
    }
    this.sessionRooms.get(sessionId)?.add(client.id);

    // Update client info with session
    clientInfo.sessionId = sessionId;

    this.logger.log(
      `✅ ${clientInfo.role} ${clientInfo.userId} joined session ${sessionId} (room: ${roomName})`,
    );

    // Notify others in the room that someone joined
    client.to(roomName).emit('participantJoined', {
      sessionId,
      userId: clientInfo.userId,
      role: clientInfo.role,
    });

    // ⭐ CRITICAL FIX: Emit joinSession acknowledgment back to client
    client.emit('joinSession', {
      success: true,
      sessionId,
      userId: clientInfo.userId,
      role: clientInfo.role,
    });

    // Log room members for debugging
    const roomMembers = this.sessionRooms.get(sessionId);
    this.logger.log(`📊 Session ${sessionId} now has ${roomMembers?.size || 0} members`);

    return { success: true, sessionId };
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
      if (!this.server?.sockets?.sockets) {
        this.logger.warn(`Server sockets not available, cannot leave room for socket ${socketId}`);
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
            sessionId,
            userId: clientInfo.userId,
            role: clientInfo.role,
          });
          clientInfo.sessionId = undefined;
        }
      }

      this.sessionRooms.get(sessionId)?.delete(socketId);
    } catch (error: any) {
      this.logger.error(`Error in leaveSessionRoom: ${error.message}`);
      this.sessionRooms.get(sessionId)?.delete(socketId);
    }
  }

  // ============ Whiteboard Collaboration ============

  @SubscribeMessage('whiteboardUpdate')
  async handleWhiteboardUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string; elements: any[]; appState?: any },
  ) {
    const clientInfo = this.connectedClients.get(client.id);
    
    // ⭐ FIX: More lenient validation - allow if client is authenticated
    if (!clientInfo) {
      this.logger.warn(`whiteboardUpdate: No client info for ${client.id}`);
      return { success: false, error: 'Not authenticated' };
    }

    const { sessionId, elements, appState } = data;

    // ⭐ FIX: Auto-join session if not already joined
    if (clientInfo.sessionId !== sessionId) {
      this.logger.log(`whiteboardUpdate: Client ${client.id} not in session ${sessionId}, auto-joining...`);
      const roomName = `session:${sessionId}`;
      client.join(roomName);
      clientInfo.sessionId = sessionId;
      
      if (!this.sessionRooms.has(sessionId)) {
        this.sessionRooms.set(sessionId, new Set());
      }
      this.sessionRooms.get(sessionId)?.add(client.id);
    }

    this.logger.log(`🎨 Whiteboard update from ${clientInfo.role} ${clientInfo.userId} in session ${sessionId} - ${elements.length} elements`);

    // Save to database (async, don't block)
    this.saveWhiteboardData(sessionId, elements, appState).catch(err => {
      this.logger.error(`Failed to save whiteboard: ${err.message}`);
    });

    // ⭐ CRITICAL FIX: Include sessionId in the broadcast payload
    const updatePayload = {
      sessionId, // ⭐ This was missing!
      elements,
      appState,
      senderId: clientInfo.userId,
      senderRole: clientInfo.role,
      timestamp: Date.now(),
    };

    // Broadcast to others in the session (excluding sender)
    client.to(`session:${sessionId}`).emit('whiteboardUpdate', updatePayload);

    this.logger.log(`📤 Broadcasted whiteboard update to session:${sessionId}`);

    return { success: true };
  }

  private async saveWhiteboardData(sessionId: string, elements: any[], appState?: any) {
    try {
      await this.prisma.tutor_sessions.update({
        where: { id: sessionId },
        data: {
          whiteboardData: { elements, appState: appState || {} },
          whiteboardEnabled: true,
        },
      });
      this.logger.log(`💾 Saved whiteboard data for session ${sessionId}`);
    } catch (error: any) {
      this.logger.error(`Failed to save whiteboard data: ${error.message}`);
      throw error;
    }
  }

  @SubscribeMessage('whiteboardCursor')
  handleWhiteboardCursor(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string; x: number; y: number },
  ) {
    const clientInfo = this.connectedClients.get(client.id);
    if (!clientInfo) return;

    // ⭐ FIX: Include sessionId in cursor broadcast
    client.to(`session:${data.sessionId}`).emit('whiteboardCursor', {
      sessionId: data.sessionId,
      userId: clientInfo.userId,
      role: clientInfo.role,
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
    
    if (!clientInfo) {
      this.logger.warn(`getWhiteboardData: No client info for ${client.id}`);
      client.emit('whiteboardData', {
        sessionId: data.sessionId,
        whiteboardData: { elements: [], appState: {} },
        whiteboardEnabled: false,
        error: 'Not authenticated',
      });
      return;
    }

    const { sessionId } = data;

    this.logger.log(`📋 Getting whiteboard data for session ${sessionId} requested by ${clientInfo.userId}`);

    try {
      const session = await this.prisma.tutor_sessions.findUnique({
        where: { id: sessionId },
        select: { 
          whiteboardData: true, 
          whiteboardEnabled: true,
          id: true,
        },
      });

      if (!session) {
        this.logger.warn(`Session ${sessionId} not found`);
        client.emit('whiteboardData', {
          sessionId,
          whiteboardData: { elements: [], appState: {} },
          whiteboardEnabled: false,
          error: 'Session not found',
        });
        return;
      }

      const whiteboardData = (session.whiteboardData as any) || { elements: [], appState: {} };

      // ⭐ CRITICAL FIX: Emit event instead of just returning
      // The frontend listens for 'whiteboardData' event
      const responsePayload = {
        sessionId,
        whiteboardData,
        whiteboardEnabled: session.whiteboardEnabled || false,
      };

      this.logger.log(`📤 Emitting whiteboardData for session ${sessionId}: ${whiteboardData.elements?.length || 0} elements`);

      // Emit to the requesting client
      client.emit('whiteboardData', responsePayload);

      // Also return for request/response pattern
      return responsePayload;
    } catch (error: any) {
      this.logger.error(`Failed to get whiteboard data: ${error.message}`);
      
      client.emit('whiteboardData', {
        sessionId,
        whiteboardData: { elements: [], appState: {} },
        whiteboardEnabled: false,
        error: error.message,
      });
      
      return { 
        whiteboardData: { elements: [], appState: {} }, 
        whiteboardEnabled: false,
        error: error.message,
      };
    }
  }

  // ============ Chat Messages (Tutor-Student) ============

  @SubscribeMessage('sendChatMessage')
  async handleChatMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string; content: string },
  ) {
    const clientInfo = this.connectedClients.get(client.id);
    if (!clientInfo) {
      return { error: 'Not authenticated' };
    }

    const { sessionId, content } = data;

    // Auto-join if not in session
    if (clientInfo.sessionId !== sessionId) {
      client.join(`session:${sessionId}`);
      clientInfo.sessionId = sessionId;
    }

    // Get tutor session to find the conversation
    const tutorSession = await this.prisma.tutor_sessions.findUnique({
      where: { id: sessionId },
      select: { ai_chat_sessions: { select: { linkedConversationId: true } } },
    });

    if (!tutorSession?.ai_chat_sessions?.linkedConversationId) {
      return { error: 'No conversation linked to this session' };
    }

    const conversationId = tutorSession.ai_chat_sessions.linkedConversationId;

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

      // Create message in database
      const message = await this.prisma.messages.create({
        data: {
          id: uuidv4(),
          conversationId,
          senderId: profileId,
          senderType: clientInfo.role === 'tutor' ? 'TUTOR' : 'STUDENT',
          content: content,
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
        role: clientInfo.role,
      };

      // Broadcast to session room (including sender)
      this.server.to(`session:${sessionId}`).emit('chatMessage', messagePayload);

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
    if (!clientInfo) {
      client.emit('chatHistory', { sessionId: data.sessionId, messages: [], error: 'Not authenticated' });
      return;
    }

    const { sessionId } = data;

    try {
      const tutorSession = await this.prisma.tutor_sessions.findUnique({
        where: { id: sessionId },
        select: { ai_chat_sessions: { select: { linkedConversationId: true } } },
      });

      if (!tutorSession?.ai_chat_sessions?.linkedConversationId) {
        client.emit('chatHistory', { sessionId, messages: [] });
        return { sessionId, messages: [] };
      }

      const messages = await this.prisma.messages.findMany({
        where: { conversationId: tutorSession.ai_chat_sessions.linkedConversationId },
        orderBy: { createdAt: 'asc' },
        take: 100,
      });

      const response = { sessionId, messages };
      
      // ⭐ FIX: Emit event for frontend listener
      client.emit('chatHistory', response);
      
      return response;
    } catch (error: any) {
      this.logger.error(`Failed to get chat history: ${error.message}`);
      client.emit('chatHistory', { sessionId, messages: [], error: error.message });
      return { sessionId, messages: [] };
    }
  }

  // ============ Typing Indicator ============

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string; isTyping: boolean },
  ) {
    const clientInfo = this.connectedClients.get(client.id);
    if (!clientInfo) return;

    client.to(`session:${data.sessionId}`).emit('userTyping', {
      sessionId: data.sessionId,
      userId: clientInfo.userId,
      role: clientInfo.role,
      isTyping: data.isTyping,
    });
  }

  // ============ Call Signaling ============

  @SubscribeMessage('callSignal')
  handleCallSignal(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string; signal: string },
  ) {
    const clientInfo = this.connectedClients.get(client.id);
    if (!clientInfo) return;

    client.to(`session:${data.sessionId}`).emit('callSignal', {
      sessionId: data.sessionId,
      userId: clientInfo.userId,
      role: clientInfo.role,
      signal: data.signal,
    });
  }

  // ============ Notification Helpers ============

  /**
   * Notify student when tutor accepts their help request
   * Emits to multiple rooms for reliability
   */
  async notifyTutorAccepted(
    aiSessionId: string,
    tutorInfo: { id?: string; name: string; avatar?: string },
    tutorSessionId: string,
    dailyRoomUrl?: string,
    studentUserId?: string, // ⭐ Optional: direct user notification
  ) {
    const eventData = {
      tutorSessionId,
      tutor: tutorInfo,
      dailyRoomUrl,
    };

    this.logger.log(`🎯 Emitting tutorAccepted for session ${tutorSessionId}`, eventData);

    try {
      // ⭐ Method 1: Emit via GeminiChatGateway to AI session room
      if (this.geminiChatGateway) {
        this.geminiChatGateway.server.to(`ai:${aiSessionId}`).emit('tutorAccepted', eventData);
        this.logger.log(`✅ Emitted tutorAccepted to ai:${aiSessionId}`);
      }

      // ⭐ Method 2: Emit directly to student's user room (CRITICAL)
      if (studentUserId) {
        // Emit on tutor-session namespace
        this.server.to(`user:${studentUserId}`).emit('tutorAccepted', eventData);
        this.logger.log(`✅ Emitted tutorAccepted to user:${studentUserId} (tutor-session)`);
        
        // Also emit via gemini-chat namespace
        if (this.geminiChatGateway) {
          this.geminiChatGateway.server.to(`user:${studentUserId}`).emit('tutorAccepted', eventData);
          this.logger.log(`✅ Emitted tutorAccepted to user:${studentUserId} (gemini-chat)`);
        }
      }

      // ⭐ Method 3: Emit to the tutor session room
      this.server.to(`session:${tutorSessionId}`).emit('tutorAccepted', eventData);
      this.logger.log(`✅ Emitted tutorAccepted to session:${tutorSessionId}`);

    } catch (error) {
      this.logger.error(`❌ Error emitting tutorAccepted:`, error);
    }
  }

  /**
   * Notify when consent status changes
   */
  async notifyConsentChanged(tutorSessionId: string, enabled: boolean) {
    this.server.to(`session:${tutorSessionId}`).emit('consentChanged', {
      sessionId: tutorSessionId,
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
      sessionId: tutorSessionId,
      status,
    });

    // Notify student AI session room
    this.server.to(`ai:${aiSessionId}`).emit('sessionStatusChanged', {
      tutorSessionId,
      status,
    });
  }

  // ============ Tutor Notification Helpers ============

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
    this.logger.log(`📢 Notifying ${tutorIds.length} tutors of new help request`);
    
    for (const tutorId of tutorIds) {
      // Emit to tutor-specific room
      this.server.to(`tutor:${tutorId}`).emit('newHelpRequest', request);
      // Also emit to user room as fallback
      this.server.to(`user:${tutorId}`).emit('newHelpRequest', request);
    }

    // Also broadcast to all tutors room
    this.server.to('tutors').emit('newHelpRequest', request);

    this.logger.log(`✅ Notified ${tutorIds.length} tutors of new help request for session ${request.tutorSessionId}`);
  }

  /**
   * Get connected clients count for a session
   */
  getSessionParticipants(sessionId: string): number {
    return this.sessionRooms.get(sessionId)?.size || 0;
  }

  // ============ Debug Helpers ============

  @SubscribeMessage('debug')
  async handleDebug(@ConnectedSocket() client: Socket) {
    const clientInfo = this.connectedClients.get(client.id);
    const rooms = Array.from(client.rooms);
    
    const sessionMembers: Record<string, number> = {};
    for (const [sessionId, members] of this.sessionRooms.entries()) {
      sessionMembers[sessionId] = members.size;
    }

    return {
      socketId: client.id,
      clientInfo,
      rooms,
      totalConnectedClients: this.connectedClients.size,
      sessionRooms: sessionMembers,
    };
  }
}