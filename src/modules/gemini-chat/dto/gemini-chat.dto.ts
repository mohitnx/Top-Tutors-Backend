import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsArray,
  IsBoolean,
  IsEnum,
  IsUUID,
  MaxLength,
  IsNumber,
  Min,
  Max,
} from 'class-validator';

// ============ Session DTOs ============

export class CreateSessionDto {
  @ApiPropertyOptional({ description: 'Initial title for the chat session' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ description: 'Subject category for the session' })
  @IsOptional()
  @IsString()
  subject?: string;

  @ApiPropertyOptional({ description: 'AI mode for the session', enum: ['SINGLE', 'COUNCIL'] })
  @IsOptional()
  @IsEnum(['SINGLE', 'COUNCIL'])
  mode?: 'SINGLE' | 'COUNCIL';
}

export class UpdateSessionDto {
  @ApiPropertyOptional({ description: 'Session title' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ description: 'Pin session to top' })
  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;

  @ApiPropertyOptional({ description: 'Archive session' })
  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;

  @ApiPropertyOptional({ description: 'AI mode for the session', enum: ['SINGLE', 'COUNCIL'] })
  @IsOptional()
  @IsEnum(['SINGLE', 'COUNCIL'])
  mode?: 'SINGLE' | 'COUNCIL';
}

export class GetSessionsQueryDto {
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

  @ApiPropertyOptional({ description: 'Include archived sessions' })
  @IsOptional()
  @IsBoolean()
  includeArchived?: boolean = false;

  @ApiPropertyOptional({ description: 'Filter by subject' })
  @IsOptional()
  @IsString()
  subject?: string;

  @ApiPropertyOptional({ description: 'Search in titles and messages' })
  @IsOptional()
  @IsString()
  search?: string;
}

// ============ Message DTOs ============

export class SendMessageDto {
  @ApiProperty({ description: 'Text content of the message' })
  @IsOptional()
  @IsString()
  @MaxLength(50000)
  content?: string;

  @ApiPropertyOptional({ description: 'Session ID (creates new if not provided)' })
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @ApiPropertyOptional({ description: 'Enable streaming response' })
  @IsOptional()
  @IsBoolean()
  stream?: boolean = false;

  @ApiPropertyOptional({ description: 'Enable deep thinking mode (extended step-by-step reasoning)' })
  @IsOptional()
  @IsBoolean()
  deepThink?: boolean;

  @ApiPropertyOptional({ description: 'Enable deep research mode (web search + source synthesis)' })
  @IsOptional()
  @IsBoolean()
  deepResearch?: boolean;

  @ApiPropertyOptional({ description: 'Enable council mode (3-expert deliberation) for this message' })
  @IsOptional()
  @IsBoolean()
  council?: boolean;

  @ApiPropertyOptional({ description: 'Project ID to inject study materials context from' })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Enable read-aloud: AI insights spoken during thinking, full answer spoken after streaming' })
  @IsOptional()
  @IsBoolean()
  readAloud?: boolean;
}

export class SendAudioMessageDto {
  @ApiPropertyOptional({ description: 'Session ID (creates new if not provided)' })
  @IsOptional()
  @IsString()
  sessionId?: string;

  @ApiPropertyOptional({ description: 'Enable read-aloud: AI insights spoken during thinking, full answer spoken after streaming' })
  @IsOptional()
  @IsBoolean()
  readAloud?: boolean;
}

export class RetryMessageDto {
  @ApiProperty({ description: 'ID of the message to retry' })
  @IsUUID()
  messageId: string;
}

export class MessageFeedbackDto {
  @ApiProperty({ description: 'Feedback type', enum: ['GOOD', 'BAD'] })
  @IsEnum(['GOOD', 'BAD'])
  feedback: 'GOOD' | 'BAD';
}

// ============ Tutor Request DTOs ============

export class RequestTutorDto {
  @ApiProperty({ description: 'Session ID to request tutor for' })
  @IsUUID()
  sessionId: string;

  @ApiPropertyOptional({ description: 'Specific subject for tutor request' })
  @IsOptional()
  @IsString()
  subject?: string;

  @ApiPropertyOptional({ description: 'Urgency level', enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'] })
  @IsOptional()
  @IsEnum(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
  urgency?: string = 'NORMAL';
}

export class CancelTutorRequestDto {
  @ApiProperty({ description: 'Session ID to cancel tutor request for' })
  @IsUUID()
  sessionId: string;
}

// ============ Response Types ============

export interface AIAttachment {
  url: string;
  name: string;
  type: string;
  size: number;
  mimeType: string;
}

export interface SessionResponse {
  id: string;
  title: string | null;
  summary: string | null;
  subject: string | null;
  isPinned: boolean;
  isArchived: boolean;
  lastMessageAt: Date;
  createdAt: Date;
  tutorRequestStatus: string | null;
  linkedConversationId: string | null;
  messageCount?: number;
  lastMessage?: {
    content: string | null;
    role: string;
    createdAt: Date;
  };
}

export interface MessageResponse {
  id: string;
  sessionId: string;
  role: string;
  content: string | null;
  attachments: AIAttachment[] | null;
  audioUrl: string | null;
  transcription: string | null;
  isStreaming: boolean;
  isComplete: boolean;
  hasError: boolean;
  errorMessage: string | null;
  feedback: string | null;
  createdAt: Date;
}

export interface StreamChunk {
  type: 'start' | 'chunk' | 'heartbeat' | 'end' | 'error' | 'status';
  messageId: string;
  sessionId: string;
  /** Unique stream ID — use with cancelStream event to stop generation */
  streamId?: string;
  content?: string;
  fullContent?: string;
  message?: string; // status/heartbeat text for UI
  waitingMs?: number; // used with heartbeat/timeouts
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };

  // ── Enhanced UX fields (shown persistently at top of answer) ──

  /** The AI mode that produced this response */
  mode?: 'single' | 'deep-think' | 'deep-research' | 'council';

  /**
   * Ordered list of thinking/processing steps so far.
   * Frontend renders these persistently above the answer at reduced opacity.
   * Each entry is appended as the LLM progresses (never removed).
   */
  thinkingTrace?: string[];

  /**
   * Deep Research: web sources the LLM visited / cited.
   * Populated progressively via status chunks.
   */
  sources?: { title: string; url?: string }[];

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

  /**
   * Council mode: which expert is currently active.
   */
  activeExpert?: string;

  /**
   * Provider that actually served this response (for debugging / logging).
   * e.g. 'anthropic', 'vertex', 'gemini'
   */
  provider?: string;

  /**
   * When true, the frontend should use SpeechSynthesis to:
   * 1. Read aloud 'status' messages (AI insight phases) as they arrive
   * 2. Read aloud the full answer after the 'end' chunk
   * The user can stop playback at any time.
   */
  readAloud?: boolean;

  /**
   * When true, the stream was cancelled by the user before completion.
   * Present only on 'end' chunks. fullContent contains partial content.
   */
  cancelled?: boolean;
}

export interface TutorStatusUpdate {
  status: string;
  message: string;
  tutorInfo?: {
    id: string;
    name: string;
    avatar?: string;
  };
  conversationId?: string;
  estimatedWait?: string;
}

