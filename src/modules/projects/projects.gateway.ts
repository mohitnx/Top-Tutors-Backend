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
import { ProjectStreamChunk } from './dto';

interface AuthenticatedSocket extends Socket {
  user?: {
    id: string;
    email: string;
    role: string;
  };
}

@WebSocketGateway({
  namespace: '/projects',
  cors: {
    origin: '*',
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class ProjectsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ProjectsGateway.name);
  private userSockets: Map<string, Set<string>> = new Map();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async handleConnection(socket: AuthenticatedSocket) {
    try {
      const token =
        socket.handshake.auth?.token ||
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

      if (!this.userSockets.has(payload.sub)) {
        this.userSockets.set(payload.sub, new Set());
      }
      this.userSockets.get(payload.sub)!.add(socket.id);

      socket.join(`user:${payload.sub}`);

      this.logger.log(`Projects WS connected: ${socket.id} (${payload.email})`);
    } catch (error: any) {
      this.logger.warn(`Projects WS auth failed: ${error.message}`);
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
    this.logger.log(`Projects WS disconnected: ${socket.id}`);
  }

  @SubscribeMessage('joinProject')
  handleJoinProject(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() projectId: string,
  ) {
    if (!socket.user) return;
    socket.join(`project:${projectId}`);
    this.logger.log(`User ${socket.user.email} joined project room: ${projectId}`);
  }

  @SubscribeMessage('leaveProject')
  handleLeaveProject(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() projectId: string,
  ) {
    if (!socket.user) return;
    socket.leave(`project:${projectId}`);
  }

  @SubscribeMessage('joinSession')
  handleJoinSession(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() sessionId: string,
  ) {
    if (!socket.user) return;
    socket.join(`project-session:${sessionId}`);
  }

  @SubscribeMessage('leaveSession')
  handleLeaveSession(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() sessionId: string,
  ) {
    if (!socket.user) return;
    socket.leave(`project-session:${sessionId}`);
  }

  // ============ Server-side emission methods ============

  emitStreamChunk(userId: string, sessionId: string, chunk: ProjectStreamChunk) {
    this.server.to(`user:${userId}`).emit('streamChunk', chunk);
    this.server.to(`project-session:${sessionId}`).emit('streamChunk', chunk);
  }

  emitCouncilStatus(userId: string, sessionId: string, data: any) {
    this.server.to(`user:${userId}`).emit('councilStatus', data);
    this.server.to(`project-session:${sessionId}`).emit('councilStatus', data);
  }

  emitCouncilMemberComplete(userId: string, sessionId: string, data: any) {
    this.server.to(`user:${userId}`).emit('councilMemberComplete', data);
    this.server.to(`project-session:${sessionId}`).emit('councilMemberComplete', data);
  }

  emitCouncilSynthesisStart(userId: string, sessionId: string, data: any) {
    this.server.to(`user:${userId}`).emit('councilSynthesisStart', data);
    this.server.to(`project-session:${sessionId}`).emit('councilSynthesisStart', data);
  }

  emitResourceAdded(userId: string, projectId: string, resource: any) {
    this.server.to(`user:${userId}`).emit('resourceAdded', { projectId, resource });
  }

  emitResourceDeleted(userId: string, projectId: string, resourceId: string) {
    this.server.to(`user:${userId}`).emit('resourceDeleted', { projectId, resourceId });
  }
}
