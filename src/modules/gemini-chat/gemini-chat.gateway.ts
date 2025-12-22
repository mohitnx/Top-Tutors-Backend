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
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { GeminiChatService } from './gemini-chat.service';
import { StreamChunk, TutorStatusUpdate } from './dto';

interface AuthenticatedSocket extends Socket {
  user?: {
    id: string;
    email: string;
    role: string;
  };
}

@WebSocketGateway({
  namespace: '/gemini-chat',
  cors: {
    origin: '*',
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class GeminiChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(GeminiChatGateway.name);
  private userSockets: Map<string, Set<string>> = new Map();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly geminiChatService: GeminiChatService,
  ) {}

  async handleConnection(socket: AuthenticatedSocket) {
    try {
      const token = socket.handshake.auth?.token || 
                    socket.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        this.logger.warn(`Socket ${socket.id} rejected: No token`);
        socket.disconnect();
        return;
      }

      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });

      socket.user = {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
      };

      // Track user sockets
      if (!this.userSockets.has(payload.sub)) {
        this.userSockets.set(payload.sub, new Set());
      }
      this.userSockets.get(payload.sub)!.add(socket.id);

      // Join user room for targeted events
      socket.join(`user:${payload.sub}`);

      this.logger.log(`Client connected: ${socket.id} (${payload.email})`);
    } catch (error: any) {
      this.logger.warn(`Socket ${socket.id} auth failed: ${error.message}`);
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
    }
    this.logger.log(`Client disconnected: ${socket.id}`);
  }

  // ============ Client Events ============

  @SubscribeMessage('joinSession')
  async handleJoinSession(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() sessionId: string,
  ) {
    if (!socket.user) {
      return { error: 'Not authenticated' };
    }

    // Verify session ownership
    const session = await (this.prisma as any).ai_chat_sessions.findFirst({
      where: { id: sessionId, userId: socket.user.id },
    });

    if (!session) {
      return { error: 'Session not found' };
    }

    socket.join(`session:${sessionId}`);
    this.logger.log(`User ${socket.user.email} joined session ${sessionId}`);

    return { success: true, sessionId };
  }

  @SubscribeMessage('leaveSession')
  handleLeaveSession(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() sessionId: string,
  ) {
    socket.leave(`session:${sessionId}`);
    return { success: true };
  }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { content: string; sessionId?: string },
  ) {
    if (!socket.user) {
      return { error: 'Not authenticated' };
    }

    try {
      const result = await this.geminiChatService.sendMessageStreaming(
        socket.user.id,
        { content: data.content, sessionId: data.sessionId, stream: true },
      );

      // Forward stream chunks to this user
      result.emitter.on('chunk', (chunk: StreamChunk) => {
        this.server.to(`user:${socket.user!.id}`).emit('streamChunk', chunk);
        
        // Also emit to session room if others are listening
        if (data.sessionId) {
          socket.to(`session:${data.sessionId}`).emit('streamChunk', chunk);
        }
      });

      return {
        success: true,
        messageId: result.messageId,
        sessionId: result.sessionId,
      };
    } catch (error: any) {
      this.logger.error(`Send message error: ${error.message}`);
      return { error: error.message };
    }
  }

  @SubscribeMessage('retryMessage')
  async handleRetryMessage(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() messageId: string,
  ) {
    if (!socket.user) {
      return { error: 'Not authenticated' };
    }

    try {
      const result = await this.geminiChatService.retryMessage(messageId, socket.user.id);

      result.emitter.on('chunk', (chunk: StreamChunk) => {
        this.server.to(`user:${socket.user!.id}`).emit('streamChunk', chunk);
      });

      return {
        success: true,
        messageId: result.messageId,
        sessionId: result.sessionId,
      };
    } catch (error: any) {
      return { error: error.message };
    }
  }

  @SubscribeMessage('getStreamState')
  async handleGetStreamState(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() streamId: string,
  ) {
    const state = await this.geminiChatService.getStreamState(streamId);
    return state || { error: 'Stream not found' };
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { sessionId: string; isTyping: boolean },
  ) {
    if (!socket.user) return;

    // Broadcast to others in the session (for collaborative viewing)
    socket.to(`session:${data.sessionId}`).emit('userTyping', {
      userId: socket.user.id,
      isTyping: data.isTyping,
    });
  }

  // ============ Server Events (called from service/controller) ============

  /**
   * Emit a stream chunk to a specific user
   */
  emitStreamChunk(userId: string, chunk: StreamChunk) {
    this.server.to(`user:${userId}`).emit('streamChunk', chunk);
    
    // Also emit to session room
    this.server.to(`session:${chunk.sessionId}`).emit('streamChunk', chunk);
  }

  /**
   * Emit tutor status update to a user
   */
  emitTutorStatusUpdate(userId: string, sessionId: string, update: TutorStatusUpdate) {
    this.server.to(`user:${userId}`).emit('tutorStatusUpdate', {
      sessionId,
      ...update,
    });
  }

  /**
   * Notify user that tutor has connected
   */
  notifyTutorConnected(
    userId: string,
    sessionId: string,
    tutorInfo: { id: string; name: string; avatar?: string },
    conversationId: string,
  ) {
    this.server.to(`user:${userId}`).emit('tutorConnected', {
      sessionId,
      tutorInfo,
      conversationId,
      message: `${tutorInfo.name} is ready to help!`,
    });
  }

  /**
   * Notify about tutor wait time update
   */
  notifyTutorWaitUpdate(userId: string, sessionId: string, estimatedWait: string) {
    this.server.to(`user:${userId}`).emit('tutorWaitUpdate', {
      sessionId,
      estimatedWait,
      message: `Estimated wait time: ${estimatedWait}`,
    });
  }

  /**
   * Get connected sockets info (for debugging)
   */
  async getConnectedInfo() {
    const sockets = await this.server.fetchSockets();
    return {
      namespace: '/gemini-chat',
      totalConnected: sockets.length,
      users: Array.from(this.userSockets.keys()),
    };
  }
}

