import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Res,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiBody,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ProjectsService } from './projects.service';
import { ProjectChatService } from './project-chat.service';
import { ProjectsGateway } from './projects.gateway';
import {
  CreateProjectDto,
  UpdateProjectDto,
  GetProjectsQueryDto,
  AddResourceDto,
  CreateProjectChatSessionDto,
  SendProjectMessageDto,
  ProjectMessageFeedbackDto,
  GenerateQuizDto,
} from './dto';

@ApiTags('projects')
@Controller('projects')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('STUDENT', 'TEACHER', 'TUTOR')
@ApiBearerAuth()
export class ProjectsController {
  private readonly logger = new Logger(ProjectsController.name);

  constructor(
    private readonly projectsService: ProjectsService,
    private readonly projectChatService: ProjectChatService,
    private readonly projectsGateway: ProjectsGateway,
  ) {}

  // ============ Project CRUD ============

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new project' })
  @ApiResponse({ status: 201, description: 'Project created' })
  async createProject(
    @CurrentUser() user: any,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projectsService.createProject(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List my projects' })
  @ApiResponse({ status: 200, description: 'Paginated list of projects' })
  async getProjects(
    @CurrentUser() user: any,
    @Query() query: GetProjectsQueryDto,
  ) {
    return this.projectsService.getProjects(user.id, query);
  }

  @Get(':projectId')
  @ApiOperation({ summary: 'Get project details with resources' })
  @ApiParam({ name: 'projectId' })
  @ApiResponse({ status: 200, description: 'Project with resources' })
  async getProject(
    @CurrentUser() user: any,
    @Param('projectId') projectId: string,
  ) {
    return this.projectsService.getProject(projectId, user.id);
  }

  @Put(':projectId')
  @ApiOperation({ summary: 'Update project (title, description, AI config)' })
  @ApiParam({ name: 'projectId' })
  @ApiResponse({ status: 200, description: 'Project updated' })
  async updateProject(
    @CurrentUser() user: any,
    @Param('projectId') projectId: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projectsService.updateProject(projectId, user.id, dto);
  }

  @Delete(':projectId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a project and all its data' })
  @ApiParam({ name: 'projectId' })
  @ApiResponse({ status: 200, description: 'Project deleted' })
  async deleteProject(
    @CurrentUser() user: any,
    @Param('projectId') projectId: string,
  ) {
    return this.projectsService.deleteProject(projectId, user.id);
  }

  // ============ Resources ============

  @Post(':projectId/resources')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
      fileFilter: (req, file, cb) => {
        const allowedMimes = [
          'image/jpeg',
          'image/jpg',
          'image/png',
          'image/gif',
          'image/webp',
          'application/pdf',
          'text/plain',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ];
        if (allowedMimes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only images, PDFs, text files, and Word documents are allowed'), false);
        }
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a resource (PDF, image, text, or Word document) to a project' })
  @ApiParam({ name: 'projectId' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        title: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Resource uploaded' })
  async addResource(
    @CurrentUser() user: any,
    @Param('projectId') projectId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: AddResourceDto,
  ) {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('No file provided');
    }
    return this.projectsService.addResource(projectId, user.id, dto.title, file);
  }

  @Get(':projectId/resources')
  @ApiOperation({ summary: 'List all resources in a project' })
  @ApiParam({ name: 'projectId' })
  @ApiResponse({ status: 200, description: 'List of resources' })
  async getResources(
    @CurrentUser() user: any,
    @Param('projectId') projectId: string,
  ) {
    return this.projectsService.getResources(projectId, user.id);
  }

  @Get(':projectId/resources/:resourceId/preview')
  @ApiOperation({ summary: 'Get a temporary preview URL for a resource' })
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'resourceId' })
  @ApiResponse({ status: 200, description: 'Signed preview URL (valid for 1 hour)' })
  async getResourcePreview(
    @CurrentUser() user: any,
    @Param('projectId') projectId: string,
    @Param('resourceId') resourceId: string,
  ) {
    return this.projectsService.getResourcePreviewUrl(projectId, resourceId, user.id);
  }

  @Delete(':projectId/resources/:resourceId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a resource from a project' })
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'resourceId' })
  @ApiResponse({ status: 200, description: 'Resource deleted' })
  async deleteResource(
    @CurrentUser() user: any,
    @Param('projectId') projectId: string,
    @Param('resourceId') resourceId: string,
  ) {
    return this.projectsService.deleteResource(projectId, resourceId, user.id);
  }

  // ============ Session Resources ============

  @Post(':projectId/chat/sessions/:sessionId/resources')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 20 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        const allowedMimes = [
          'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
          'application/pdf',
          'text/plain',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ];
        if (allowedMimes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only images, PDFs, text files, and Word documents are allowed'), false);
        }
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a resource to a specific chat session' })
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'sessionId' })
  @ApiResponse({ status: 201, description: 'Session resource uploaded' })
  async addSessionResource(
    @CurrentUser() user: any,
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: AddResourceDto,
  ) {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('No file provided');
    }
    return this.projectsService.addResource(projectId, user.id, dto.title, file, sessionId);
  }

  @Get(':projectId/chat/sessions/:sessionId/resources')
  @ApiOperation({ summary: 'List resources for a session (includes project-level + session-level)' })
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'sessionId' })
  @ApiResponse({ status: 200, description: 'List of resources' })
  async getSessionResources(
    @CurrentUser() user: any,
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.projectsService.getResources(projectId, user.id, sessionId);
  }

  // ============ Chat Sessions ============

  @Post(':projectId/chat/sessions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new chat session in a project' })
  @ApiParam({ name: 'projectId' })
  @ApiResponse({ status: 201, description: 'Chat session created' })
  async createChatSession(
    @CurrentUser() user: any,
    @Param('projectId') projectId: string,
    @Body() dto: CreateProjectChatSessionDto,
  ) {
    return this.projectChatService.createSession(projectId, user.id, dto);
  }

  @Get(':projectId/chat/sessions')
  @ApiOperation({ summary: 'List chat sessions in a project' })
  @ApiParam({ name: 'projectId' })
  @ApiResponse({ status: 200, description: 'List of chat sessions' })
  async getChatSessions(
    @CurrentUser() user: any,
    @Param('projectId') projectId: string,
  ) {
    return this.projectChatService.getSessions(projectId, user.id);
  }

  @Get(':projectId/chat/sessions/:sessionId')
  @ApiOperation({ summary: 'Get a chat session with all messages' })
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'sessionId' })
  @ApiResponse({ status: 200, description: 'Session with messages' })
  async getChatSession(
    @CurrentUser() user: any,
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.projectChatService.getSession(projectId, sessionId, user.id);
  }

  @Delete(':projectId/chat/sessions/:sessionId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a chat session' })
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'sessionId' })
  @ApiResponse({ status: 200, description: 'Session deleted' })
  async deleteChatSession(
    @CurrentUser() user: any,
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.projectChatService.deleteSession(projectId, sessionId, user.id);
  }

  // ============ Chat Messages ============

  @Post(':projectId/chat/messages')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a message in a project chat (streaming via WebSocket)' })
  @ApiParam({ name: 'projectId' })
  @ApiBody({ type: SendProjectMessageDto })
  @ApiResponse({ status: 200, description: 'Message sent, streaming via WebSocket' })
  async sendMessage(
    @CurrentUser() user: any,
    @Param('projectId') projectId: string,
    @Body() dto: SendProjectMessageDto,
  ) {
    const result = await this.projectChatService.sendMessage(projectId, user.id, dto);
    this.forwardStreamEvents(result, user.id);

    return {
      messageId: result.messageId,
      sessionId: result.sessionId,
      projectId: result.projectId,
      streaming: true,
      message: 'Response streaming via WebSocket',
    };
  }

  @Post(':projectId/chat/messages/stream')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a message with SSE streaming response' })
  @ApiParam({ name: 'projectId' })
  @ApiBody({ type: SendProjectMessageDto })
  @ApiResponse({ status: 200, description: 'SSE streaming response' })
  async sendMessageStream(
    @CurrentUser() user: any,
    @Param('projectId') projectId: string,
    @Body() dto: SendProjectMessageDto,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const result = await this.projectChatService.sendMessage(projectId, user.id, dto);

    res.write(
      `data: ${JSON.stringify({ type: 'init', messageId: result.messageId, sessionId: result.sessionId, projectId: result.projectId })}\n\n`,
    );

    result.emitter.on('chunk', (chunk) => {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      if (chunk.type === 'end' || chunk.type === 'error') {
        res.end();
      }
    });

    // Forward council events via SSE too
    result.emitter.on('councilStatus', (data) => {
      res.write(`data: ${JSON.stringify({ ...data, event: 'councilStatus' })}\n\n`);
    });
    result.emitter.on('councilMemberComplete', (data) => {
      res.write(`data: ${JSON.stringify({ ...data, event: 'councilMemberComplete' })}\n\n`);
    });
    result.emitter.on('councilSynthesisStart', (data) => {
      res.write(`data: ${JSON.stringify({ ...data, event: 'councilSynthesisStart' })}\n\n`);
    });

    res.on('close', () => {
      result.emitter.removeAllListeners();
    });
  }

  @Post(':projectId/chat/messages/with-attachments')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FilesInterceptor('files', 5, {
      limits: { fileSize: 20 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        const allowedMimes = [
          'image/jpeg',
          'image/jpg',
          'image/png',
          'image/gif',
          'image/webp',
          'application/pdf',
          'text/plain',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ];
        if (allowedMimes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only images, PDFs, text files, and Word documents are allowed'), false);
        }
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Send a message with attachments in project chat' })
  @ApiParam({ name: 'projectId' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
        content: { type: 'string' },
        sessionId: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Message with attachments sent' })
  async sendMessageWithAttachments(
    @CurrentUser() user: any,
    @Param('projectId') projectId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() dto: SendProjectMessageDto,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('At least one file is required');
    }

    const result = await this.projectChatService.sendMessage(
      projectId,
      user.id,
      dto,
      files,
    );

    this.forwardStreamEvents(result, user.id);

    return {
      messageId: result.messageId,
      sessionId: result.sessionId,
      projectId: result.projectId,
      streaming: true,
      attachments: files.length,
    };
  }

  @Post(':projectId/chat/messages/:messageId/feedback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add feedback to a project chat message' })
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'messageId' })
  @ApiBody({ type: ProjectMessageFeedbackDto })
  @ApiResponse({ status: 200, description: 'Feedback added' })
  async addFeedback(
    @CurrentUser() user: any,
    @Param('projectId') projectId: string,
    @Param('messageId') messageId: string,
    @Body() dto: ProjectMessageFeedbackDto,
  ) {
    return this.projectChatService.addMessageFeedback(
      projectId,
      messageId,
      user.id,
      dto.feedback,
    );
  }

  @Get(':projectId/chat/streams/:streamId')
  @ApiOperation({ summary: 'Get stream state (for reconnection)' })
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'streamId' })
  @ApiResponse({ status: 200, description: 'Stream state' })
  async getStreamState(@Param('streamId') streamId: string) {
    const state = await this.projectChatService.getStreamState(streamId);
    if (!state) return { found: false };
    return { found: true, ...state };
  }

  // ============ Quiz ============

  @Post(':projectId/quiz/generate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate a quiz from project resources' })
  @ApiParam({ name: 'projectId' })
  @ApiBody({ type: GenerateQuizDto })
  @ApiResponse({ status: 200, description: 'Quiz generation started (streaming)' })
  async generateQuiz(
    @CurrentUser() user: any,
    @Param('projectId') projectId: string,
    @Body() dto: GenerateQuizDto,
  ) {
    const result = await this.projectChatService.generateQuiz(
      projectId,
      user.id,
      dto,
    );

    this.forwardStreamEvents(result, user.id);

    return {
      messageId: result.messageId,
      sessionId: result.sessionId,
      projectId: result.projectId,
      streaming: true,
      message: 'Quiz generation streaming via WebSocket',
    };
  }

  @Post(':projectId/quiz/generate/pdf')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate a quiz PDF for download' })
  @ApiParam({ name: 'projectId' })
  @ApiBody({ type: GenerateQuizDto })
  @ApiResponse({ status: 200, description: 'Quiz PDF file' })
  async generateQuizPdf(
    @CurrentUser() user: any,
    @Param('projectId') projectId: string,
    @Body() dto: GenerateQuizDto,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.projectChatService.generateQuizPdf(
      projectId,
      user.id,
      dto,
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  @Post(':projectId/report/pdf/:messageId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Download a SAP report as PDF from an AI message' })
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'messageId', description: 'The AI message ID containing the generated report' })
  @ApiResponse({ status: 200, description: 'SAP Report PDF file' })
  async generateSapReportPdf(
    @CurrentUser() user: any,
    @Param('projectId') projectId: string,
    @Param('messageId') messageId: string,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.projectChatService.generateSapReportPdf(
      projectId,
      messageId,
      user.id,
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  // ============ Internal Helpers ============

  private forwardStreamEvents(result: { emitter: any; sessionId: string }, userId: string) {
    result.emitter.on('chunk', (chunk: any) => {
      this.projectsGateway.emitStreamChunk(userId, result.sessionId, chunk);
    });
    result.emitter.on('councilStatus', (data: any) => {
      this.projectsGateway.emitCouncilStatus(userId, result.sessionId, data);
    });
    result.emitter.on('councilMemberComplete', (data: any) => {
      this.projectsGateway.emitCouncilMemberComplete(userId, result.sessionId, data);
    });
    result.emitter.on('councilSynthesisStart', (data: any) => {
      this.projectsGateway.emitCouncilSynthesisStart(userId, result.sessionId, data);
    });
  }
}
