import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  CreateProjectDto,
  UpdateProjectDto,
  GetProjectsQueryDto,
  ProjectResponse,
  ProjectResourceResponse,
} from './dto';
import { v4 as uuidv4 } from 'uuid';
import { LlmService } from '../llm/llm.service';

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly llm: LlmService,
  ) {}

  // ============ Project CRUD ============

  async createProject(userId: string, dto: CreateProjectDto): Promise<ProjectResponse> {
    const project = await this.prisma.projects.create({
      data: {
        userId,
        title: dto.title,
        description: dto.description || null,
        aiSystemPrompt: dto.aiSystemPrompt || null,
        aiTemperature: dto.aiTemperature ?? 0.5,
      },
    });

    return this.formatProject(project);
  }

  async getProjects(userId: string, query: GetProjectsQueryDto): Promise<{
    projects: ProjectResponse[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const { page = 1, limit = 20, includeArchived, search } = query;
    const skip = (page - 1) * limit;

    const whereClause: any = { userId };

    if (!includeArchived) {
      whereClause.isArchived = false;
    }

    if (search) {
      whereClause.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [projects, total] = await Promise.all([
      this.prisma.projects.findMany({
        where: whereClause,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
        include: {
          _count: {
            select: {
              project_resources: true,
              project_chat_sessions: true,
            },
          },
        },
      }),
      this.prisma.projects.count({ where: whereClause }),
    ]);

    return {
      projects: projects.map((p: any) => this.formatProject(p)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getProject(projectId: string, userId: string): Promise<{
    project: ProjectResponse;
    resources: ProjectResourceResponse[];
  }> {
    const project = await this.prisma.projects.findFirst({
      where: { id: projectId, userId },
      include: {
        project_resources: {
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: {
            project_resources: true,
            project_chat_sessions: true,
          },
        },
      },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    return {
      project: this.formatProject(project),
      resources: project.project_resources.map((r: any) => this.formatResource(r)),
    };
  }

  async updateProject(projectId: string, userId: string, dto: UpdateProjectDto): Promise<ProjectResponse> {
    const project = await this.prisma.projects.findFirst({
      where: { id: projectId, userId },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const updated = await this.prisma.projects.update({
      where: { id: projectId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.aiSystemPrompt !== undefined && { aiSystemPrompt: dto.aiSystemPrompt }),
        ...(dto.aiTemperature !== undefined && { aiTemperature: dto.aiTemperature }),
        ...(dto.isArchived !== undefined && { isArchived: dto.isArchived }),
      },
    });

    return this.formatProject(updated);
  }

  async deleteProject(projectId: string, userId: string): Promise<{ success: boolean }> {
    const project = await this.prisma.projects.findFirst({
      where: { id: projectId, userId },
      include: {
        project_resources: { select: { url: true } },
      },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    // Clean up S3 resources
    for (const resource of project.project_resources) {
      if (resource.url) {
        try {
          await this.storage.deleteObject(resource.url);
        } catch (e: any) {
          this.logger.warn(`Failed to delete S3 object ${resource.url}: ${e.message}`);
        }
      }
    }

    // Cascade delete handles resources, chat sessions, messages
    await this.prisma.projects.delete({
      where: { id: projectId },
    });

    return { success: true };
  }

  // ============ Resource Management ============

  async addResource(
    projectId: string,
    userId: string,
    title: string,
    file: Express.Multer.File,
    sessionId?: string,
  ): Promise<ProjectResourceResponse> {
    const project = await this.prisma.projects.findFirst({
      where: { id: projectId, userId },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    // Verify session ownership if sessionId provided
    if (sessionId) {
      const session = await this.prisma.project_chat_sessions.findFirst({
        where: { id: sessionId, projectId, userId },
      });
      if (!session) throw new NotFoundException('Chat session not found');
    }

    // Check resource limit (max 20 per project + max 10 per session)
    if (sessionId) {
      const sessionResourceCount = await this.prisma.project_resources.count({
        where: { projectId, sessionId },
      });
      if (sessionResourceCount >= 10) {
        throw new BadRequestException('Maximum 10 resources per session');
      }
    }
    const totalResourceCount = await this.prisma.project_resources.count({
      where: { projectId },
    });
    if (totalResourceCount >= 50) {
      throw new BadRequestException('Maximum 50 resources per project (including session resources)');
    }

    const isImage = file.mimetype.startsWith('image/');
    const isPdf = file.mimetype === 'application/pdf';
    const isTextFile = file.mimetype === 'text/plain';
    const isWordDoc = file.mimetype === 'application/msword' ||
      file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const type = isImage ? 'IMAGE' : (isPdf ? 'PDF' : 'DOCUMENT');

    // Upload to GCS
    const ext = file.originalname?.split('.').pop() || 'bin';
    const key = `projects/${projectId}/${uuidv4()}.${ext}`;
    let url: string;
    try {
      url = await this.storage.uploadBuffer(key, file.buffer, file.mimetype);
    } catch (error: any) {
      this.logger.error(`GCS upload failed for ${file.originalname}: ${error.message}`, error.stack);
      throw new BadRequestException(`File upload failed: ${error.message}`);
    }

    // Extract text content for AI context
    let extractedContent: string | null = null;
    if (isTextFile) {
      // Plain text — read buffer directly
      extractedContent = file.buffer.toString('utf-8');
    } else if (isPdf || isImage || isWordDoc) {
      // Use Gemini Vision for PDFs, images, and Word docs
      extractedContent = await this.extractContent(file);
    }

    const resource = await this.prisma.project_resources.create({
      data: {
        projectId,
        sessionId: sessionId || null,
        type,
        title: title || file.originalname || 'Untitled',
        url: url.startsWith('http') ? key : url,
        content: extractedContent,
        fileSize: file.size,
        mimeType: file.mimetype,
      },
    });

    // Touch project updatedAt
    await this.prisma.projects.update({
      where: { id: projectId },
      data: { updatedAt: new Date() },
    });

    this.logger.log(`Resource added to project ${projectId}${sessionId ? ` session ${sessionId}` : ''}: ${resource.id} (${type})`);
    return this.formatResource(resource);
  }

  async getResources(projectId: string, userId: string, sessionId?: string): Promise<ProjectResourceResponse[]> {
    const project = await this.prisma.projects.findFirst({
      where: { id: projectId, userId },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const whereClause: any = { projectId };
    if (sessionId) {
      // Session view: return both project-level (sessionId=null) AND this session's resources
      whereClause.OR = [
        { sessionId: null },
        { sessionId },
      ];
      delete whereClause.projectId;
      whereClause.AND = [{ projectId }];
    }

    const resources = await this.prisma.project_resources.findMany({
      where: sessionId ? { projectId, OR: [{ sessionId: null }, { sessionId }] } : { projectId },
      orderBy: { createdAt: 'desc' },
    });

    return resources.map((r: any) => this.formatResource(r));
  }

  async deleteResource(
    projectId: string,
    resourceId: string,
    userId: string,
  ): Promise<{ success: boolean }> {
    const project = await this.prisma.projects.findFirst({
      where: { id: projectId, userId },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const resource = await this.prisma.project_resources.findFirst({
      where: { id: resourceId, projectId },
    });

    if (!resource) {
      throw new NotFoundException('Resource not found');
    }

    // Delete from S3
    if (resource.url) {
      try {
        await this.storage.deleteObject(resource.url);
      } catch (e: any) {
        this.logger.warn(`Failed to delete S3 object ${resource.url}: ${e.message}`);
      }
    }

    await this.prisma.project_resources.delete({
      where: { id: resourceId },
    });

    return { success: true };
  }

  async getResourcePreviewUrl(
    projectId: string,
    resourceId: string,
    userId: string,
  ): Promise<{ url: string; mimeType: string | null; title: string }> {
    const project = await this.prisma.projects.findFirst({
      where: { id: projectId, userId },
    });
    if (!project) throw new NotFoundException('Project not found');

    const resource = await this.prisma.project_resources.findFirst({
      where: { id: resourceId, projectId },
    });
    if (!resource) throw new NotFoundException('Resource not found');
    if (!resource.url) throw new NotFoundException('Resource has no file');

    // If the URL is already a full public URL, return it directly
    if (resource.url.startsWith('http')) {
      return { url: resource.url, mimeType: resource.mimeType, title: resource.title };
    }

    // Generate a signed URL (valid for 1 hour)
    const signedUrl = await this.storage.getSignedUrl(resource.url, 3600);
    return { url: signedUrl, mimeType: resource.mimeType, title: resource.title };
  }

  /**
   * Get all resource content for a project (used by chat service for AI context)
   */
  async getResourceContext(projectId: string, sessionId?: string): Promise<string> {
    // If sessionId provided, get project-level + session-level resources; otherwise all project resources
    const whereClause = sessionId
      ? { projectId, content: { not: null }, OR: [{ sessionId: null }, { sessionId }] as any }
      : { projectId, content: { not: null } };

    const resources = await this.prisma.project_resources.findMany({
      where: whereClause,
      select: { title: true, content: true, type: true },
    });

    if (resources.length === 0) return '';

    const context = resources
      .map((r) => `--- ${r.type}: ${r.title} ---\n${r.content}`)
      .join('\n\n');

    // Truncate to ~100k chars to fit within Gemini context
    return context.length > 100000
      ? context.slice(0, 100000) + '\n\n[Content truncated due to length...]'
      : context;
  }

  // ============ Helpers ============

  /**
   * Verify project ownership and return the project
   */
  async verifyOwnership(projectId: string, userId: string) {
    const project = await this.prisma.projects.findFirst({
      where: { id: projectId, userId },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    return project;
  }

  /**
   * Extract text content from uploaded files using AI Vision
   */
  private async extractContent(file: Express.Multer.File): Promise<string | null> {
    try {
      const result = await this.llm.generateFromPrompt('resource-text-extraction', undefined, {
        userParts: [
          {
            inlineData: {
              mimeType: file.mimetype,
              data: file.buffer.toString('base64'),
            },
          },
        ],
      });

      const text = result.text.trim();
      this.logger.log(`Extracted ${text.length} chars from ${file.originalname}`);
      return text || null;
    } catch (error: any) {
      this.logger.warn(`Content extraction failed for ${file.originalname}: ${error.message}`);
      return null;
    }
  }

  private formatProject(project: any): ProjectResponse {
    return {
      id: project.id,
      title: project.title,
      description: project.description,
      aiSystemPrompt: project.aiSystemPrompt,
      aiTemperature: project.aiTemperature,
      isArchived: project.isArchived,
      resourceCount: project._count?.project_resources,
      chatSessionCount: project._count?.project_chat_sessions,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
  }

  private formatResource(resource: any): ProjectResourceResponse {
    return {
      id: resource.id,
      projectId: resource.projectId,
      sessionId: resource.sessionId || null,
      type: resource.type,
      title: resource.title,
      url: resource.url,
      fileSize: resource.fileSize,
      mimeType: resource.mimeType,
      hasExtractedContent: !!resource.content,
      createdAt: resource.createdAt,
    };
  }
}
