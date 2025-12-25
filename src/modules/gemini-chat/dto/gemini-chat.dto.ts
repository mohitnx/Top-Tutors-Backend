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
}

export class SendAudioMessageDto {
  @ApiPropertyOptional({ description: 'Session ID (creates new if not provided)' })
  @IsOptional()
  @IsString()
  sessionId?: string;
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
  type: 'start' | 'chunk' | 'end' | 'error';
  messageId: string;
  sessionId: string;
  content?: string;
  fullContent?: string;
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
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

