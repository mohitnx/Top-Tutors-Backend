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

interface AuthenticatedSocket extends Socket {
  userId?: string;
  userRole?: string;
}

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/messages',
})
export class MessagesGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(MessagesGateway.name);
  private connectedUsers: Map<string, string[]> = new Map(); // userId -> socketIds[]

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    try {
      // Extract token from handshake
      const token = client.handshake.auth?.token || 
                    client.handshake.headers?.authorization?.split(' ')[1];

      if (!token) {
        this.logger.warn('Client attempted connection without token');
        client.disconnect();
        return;
      }

      // Verify JWT
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });

      client.userId = payload.sub;
      client.userRole = payload.role;

      // Track connected user
      if (client.userId) {
        const userSockets = this.connectedUsers.get(client.userId) || [];
        userSockets.push(client.id);
        this.connectedUsers.set(client.userId, userSockets);

        // Join user-specific room
        client.join(`user:${client.userId}`);
      }

      this.logger.log(`Client connected: ${client.id} (User: ${client.userId})`);
    } catch (error) {
      this.logger.error('Connection authentication failed', error);
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    if (client.userId) {
      const userSockets = this.connectedUsers.get(client.userId) || [];
      const updatedSockets = userSockets.filter(id => id !== client.id);
      
      if (updatedSockets.length === 0) {
        this.connectedUsers.delete(client.userId);
      } else {
        this.connectedUsers.set(client.userId, updatedSockets);
      }
    }

    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('joinConversation')
  handleJoinConversation(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() conversationId: string,
  ) {
    client.join(`conversation:${conversationId}`);
    this.logger.log(`User ${client.userId} joined conversation: ${conversationId}`);
    return { event: 'joined', conversationId };
  }

  @SubscribeMessage('leaveConversation')
  handleLeaveConversation(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() conversationId: string,
  ) {
    client.leave(`conversation:${conversationId}`);
    this.logger.log(`User ${client.userId} left conversation: ${conversationId}`);
    return { event: 'left', conversationId };
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string; isTyping: boolean },
  ) {
    client.to(`conversation:${data.conversationId}`).emit('userTyping', {
      userId: client.userId,
      isTyping: data.isTyping,
    });
  }

  // Methods to emit events from the service

  /**
   * Notify about a new message (excludes sender to prevent duplicates)
   */
  sendNewMessage(conversationId: string, message: any, excludeSenderId?: string) {
    if (excludeSenderId) {
      // Get all sockets in the conversation room except the sender
      const senderSockets = this.connectedUsers.get(excludeSenderId) || [];
      
      // Emit to the room, but sender's sockets will filter it out client-side
      // We include senderId so frontend can deduplicate if needed
      this.server.to(`conversation:${conversationId}`).emit('newMessage', {
        ...message,
        _excludeSender: excludeSenderId, // Frontend can use this to skip if it's from self
      });
    } else {
      this.server.to(`conversation:${conversationId}`).emit('newMessage', message);
    }
  }

  /**
   * Notify a specific user (e.g., tutor about new assignment)
   */
  notifyUser(userId: string, event: string, data: any) {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  /**
   * Notify about conversation assignment
   */
  notifyNewAssignment(tutorUserId: string, conversation: any) {
    this.server.to(`user:${tutorUserId}`).emit('newAssignment', {
      conversationId: conversation.id,
      subject: conversation.subject,
      urgency: conversation.urgency,
      studentName: conversation.student?.user?.name,
    });
  }

  /**
   * Notify about conversation status change
   */
  notifyStatusChange(conversationId: string, status: string) {
    this.server.to(`conversation:${conversationId}`).emit('statusChange', {
      conversationId,
      status,
    });
  }

  /**
   * Check if a user is online
   */
  isUserOnline(userId: string): boolean {
    return this.connectedUsers.has(userId);
  }

  /**
   * Get online users count
   */
  getOnlineUsersCount(): number {
    return this.connectedUsers.size;
  }
}

