import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class ShareConversationDto {
  @ApiPropertyOptional({
    description: 'Whether to enable or disable sharing',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class ShareConversationResponseDto {
  @ApiProperty({ description: 'Conversation ID' })
  conversationId: string;

  @ApiProperty({ description: 'Whether the conversation is shared' })
  isShared: boolean;

  @ApiPropertyOptional({ description: 'Share token for the URL' })
  shareToken?: string;

  @ApiPropertyOptional({ description: 'Full share URL' })
  shareUrl?: string;

  @ApiPropertyOptional({ description: 'When the conversation was shared' })
  sharedAt?: Date;
}

export class SharedConversationViewDto {
  @ApiProperty({ description: 'Conversation ID' })
  id: string;

  @ApiProperty({ description: 'Subject of the conversation' })
  subject: string;

  @ApiPropertyOptional({ description: 'Topic of the conversation' })
  topic?: string;

  @ApiProperty({ description: 'Student name (anonymized)' })
  studentName: string;

  @ApiPropertyOptional({ description: 'Tutor name' })
  tutorName?: string;

  @ApiProperty({ description: 'Conversation status' })
  status: string;

  @ApiProperty({ description: 'When the conversation was created' })
  createdAt: Date;

  @ApiProperty({ description: 'Messages in the conversation', type: 'array' })
  messages: SharedMessageDto[];
}

export class SharedMessageDto {
  @ApiProperty({ description: 'Message ID' })
  id: string;

  @ApiProperty({ description: 'Sender type (STUDENT, TUTOR, SYSTEM)' })
  senderType: string;

  @ApiPropertyOptional({ description: 'Message content' })
  content?: string;

  @ApiProperty({ description: 'Message type (TEXT, AUDIO, IMAGE, FILE)' })
  messageType: string;

  @ApiProperty({ description: 'Number of likes' })
  likeCount: number;

  @ApiProperty({ description: 'Number of dislikes' })
  dislikeCount: number;

  @ApiProperty({ description: 'When the message was sent' })
  createdAt: Date;
}








