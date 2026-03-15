import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsUUID,
  IsNumber,
  IsEnum,
  MaxLength,
  Min,
  Max,
} from 'class-validator';

// ============ Project DTOs ============

export class CreateProjectDto {
  @ApiProperty({ description: 'Project title' })
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ description: 'Project description' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ description: 'Custom AI system prompt / persona instructions' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  aiSystemPrompt?: string;

  @ApiPropertyOptional({ description: 'AI temperature (0-1)', default: 0.5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  aiTemperature?: number;
}

export class UpdateProjectDto {
  @ApiPropertyOptional({ description: 'Project title' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ description: 'Project description' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ description: 'Custom AI system prompt / persona instructions' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  aiSystemPrompt?: string;

  @ApiPropertyOptional({ description: 'AI temperature (0-1)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  aiTemperature?: number;

  @ApiPropertyOptional({ description: 'Archive project' })
  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}

export class GetProjectsQueryDto {
  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Include archived projects' })
  @IsOptional()
  @IsBoolean()
  includeArchived?: boolean = false;

  @ApiPropertyOptional({ description: 'Search in title and description' })
  @IsOptional()
  @IsString()
  search?: string;
}

// ============ Resource DTOs ============

export class AddResourceDto {
  @ApiProperty({ description: 'Resource title / display name' })
  @IsString()
  @MaxLength(300)
  title: string;
}

// ============ Chat DTOs ============

export class CreateProjectChatSessionDto {
  @ApiPropertyOptional({ description: 'Session title' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}

export class SendProjectMessageDto {
  @ApiPropertyOptional({ description: 'Text content of the message' })
  @IsOptional()
  @IsString()
  @MaxLength(50000)
  content?: string;

  @ApiPropertyOptional({ description: 'Chat session ID (creates new if not provided)' })
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @ApiPropertyOptional({ description: 'Enable deep thinking mode (extended step-by-step reasoning)' })
  @IsOptional()
  @IsBoolean()
  deepThink?: boolean;

  @ApiPropertyOptional({ description: 'Enable deep research mode (web search + source synthesis)' })
  @IsOptional()
  @IsBoolean()
  deepResearch?: boolean;

  @ApiPropertyOptional({ description: 'Enable council mode (multi-expert analysis)' })
  @IsOptional()
  @IsBoolean()
  councilMode?: boolean;
}

export class ProjectMessageFeedbackDto {
  @ApiProperty({ description: 'Feedback type', enum: ['GOOD', 'BAD'] })
  @IsEnum(['GOOD', 'BAD'])
  feedback: 'GOOD' | 'BAD';
}

// ============ Quiz DTOs ============

export class GenerateQuizDto {
  @ApiPropertyOptional({ description: 'Number of questions', default: 5 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(20)
  questionCount?: number = 5;

  @ApiPropertyOptional({ description: 'Quiz type', enum: ['MCQ', 'SHORT_ANSWER', 'TRUE_FALSE', 'MIXED'] })
  @IsOptional()
  @IsEnum(['MCQ', 'SHORT_ANSWER', 'TRUE_FALSE', 'MIXED'])
  quizType?: string = 'MIXED';

  @ApiPropertyOptional({ description: 'Difficulty level', enum: ['EASY', 'MEDIUM', 'HARD'] })
  @IsOptional()
  @IsEnum(['EASY', 'MEDIUM', 'HARD'])
  difficulty?: string = 'MEDIUM';

  @ApiPropertyOptional({ description: 'Session ID to scope quiz to session resources only' })
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @ApiPropertyOptional({ description: 'Generate downloadable PDF', default: false })
  @IsOptional()
  @IsBoolean()
  generatePdf?: boolean;
}

// ============ Response Types ============

export interface ProjectResponse {
  id: string;
  title: string;
  description: string | null;
  aiSystemPrompt: string | null;
  aiTemperature: number;
  isArchived: boolean;
  resourceCount?: number;
  chatSessionCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectResourceResponse {
  id: string;
  projectId: string;
  sessionId: string | null;
  type: string;
  title: string;
  url: string | null;
  fileSize: number | null;
  mimeType: string | null;
  hasExtractedContent: boolean;
  createdAt: Date;
}

export interface ProjectChatSessionResponse {
  id: string;
  projectId: string;
  title: string | null;
  lastMessageAt: Date;
  createdAt: Date;
  messageCount?: number;
  /** 'project' = native project chat, 'llm-chat' = linked from main LLM chat */
  source?: 'project' | 'llm-chat';
  lastMessage?: {
    content: string | null;
    role: string;
    createdAt: Date;
  };
}

export interface ProjectMessageResponse {
  id: string;
  sessionId: string;
  role: string;
  content: string | null;
  attachments: any[] | null;
  isStreaming: boolean;
  isComplete: boolean;
  hasError: boolean;
  errorMessage: string | null;
  feedback: string | null;
  createdAt: Date;
}

export interface ProjectStreamChunk {
  type: 'start' | 'chunk' | 'heartbeat' | 'end' | 'error' | 'status';
  messageId: string;
  sessionId: string;
  projectId: string;
  /** Unique stream ID — use with cancelStream event to stop generation */
  streamId?: string;

  /**
   * When true, the stream has not received new content for 30+ seconds.
   * Present on 'heartbeat' chunks. Frontend should show a retry button.
   */
  stalled?: boolean;
  content?: string;
  fullContent?: string;
  message?: string;
  waitingMs?: number;
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };

  /**
   * SAP Report: auto-generated PDF download info.
   * Present only on the 'end' chunk when a SAP report was generated.
   * Frontend should render a download button with href = downloadUrl.
   */
  reportDownload?: {
    downloadUrl: string;
    filename: string;
    messageId: string;
  };

  /** When true, the stream was cancelled by the user before completion. */
  cancelled?: boolean;
}
