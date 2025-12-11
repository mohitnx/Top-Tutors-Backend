import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export enum MessageType {
  TEXT = 'TEXT',
  AUDIO = 'AUDIO',
  IMAGE = 'IMAGE',
  FILE = 'FILE',
}

export class SendTextMessageDto {
  @ApiProperty({ description: 'Message content' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiPropertyOptional({ description: 'Message type', enum: MessageType, default: MessageType.TEXT })
  @IsOptional()
  @IsEnum(MessageType)
  messageType?: MessageType = MessageType.TEXT;

  @ApiPropertyOptional({ description: 'Existing conversation ID (omit to create new)' })
  @IsOptional()
  @IsUUID()
  conversationId?: string;
}

export class SendAudioMessageDto {
  @ApiPropertyOptional({ description: 'Existing conversation ID (omit to create new)' })
  @IsOptional()
  @IsUUID()
  conversationId?: string;
}

export class ClassificationResult {
  transcription: string;
  detectedLanguage: string;
  subject: string;
  topic: string;
  keywords: string[];
  urgency: string;
}

export class AssignTutorDto {
  @ApiProperty({ description: 'Tutor ID to assign' })
  @IsUUID()
  tutorId: string;
}

export class CloseConversationDto {
  @ApiProperty({ description: 'Final status', enum: ['RESOLVED', 'CLOSED'] })
  @IsString()
  @IsNotEmpty()
  status: 'RESOLVED' | 'CLOSED';
}

export class ConversationQueryDto {
  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 10 })
  @IsOptional()
  limit?: number = 10;

  @ApiPropertyOptional({ description: 'Filter by status' })
  @IsOptional()
  @IsString()
  status?: string;
}

// Legacy DTO for backwards compatibility
export class SendMessageDto {
  @ApiProperty({ description: 'User question or prompt to send to Gemini' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  prompt?: string;

  @ApiProperty({ description: 'Alias for prompt, supports existing frontend payloads', required: false })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  content?: string;

  @ApiProperty({ description: 'Transcription text for audio messages', required: false })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  transcription?: string;

  @ApiProperty({ description: 'Optional audio URL (if already uploaded)', required: false })
  @IsOptional()
  @IsString()
  audioUrl?: string;

  @ApiProperty({
    description: 'Optional message type (TEXT, AUDIO, IMAGE, FILE)',
    required: false,
    enum: MessageType,
    default: MessageType.TEXT,
  })
  @IsOptional()
  @IsEnum(MessageType)
  messageType?: MessageType;

  @ApiProperty({
    description: 'Optional context messages sent before the prompt',
    type: [String],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  context?: string[];

  @ApiProperty({
    description: 'Override the Gemini model name (defaults to gemini-2.5-flash)',
    required: false,
    example: 'gemini-1.5-pro',
  })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({ description: 'Existing conversation ID' })
  @IsOptional()
  @IsUUID()
  conversationId?: string;
}
