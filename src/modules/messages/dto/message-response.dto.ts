import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageType, SenderType, Subject, Urgency, ConversationStatus } from '@prisma/client';

export class MessageResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  conversationId: string;

  @ApiProperty()
  senderId: string;

  @ApiProperty({ enum: SenderType })
  senderType: SenderType;

  @ApiPropertyOptional()
  content?: string;

  @ApiProperty({ enum: MessageType })
  messageType: MessageType;

  @ApiPropertyOptional()
  audioUrl?: string;

  @ApiPropertyOptional()
  audioDuration?: number;

  @ApiPropertyOptional()
  transcription?: string;

  @ApiProperty()
  isRead: boolean;

  @ApiProperty()
  createdAt: Date;
}

export class ConversationResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  studentId: string;

  @ApiPropertyOptional()
  tutorId?: string;

  @ApiProperty({ enum: Subject })
  subject: Subject;

  @ApiPropertyOptional()
  topic?: string;

  @ApiProperty({ type: [String] })
  keywords: string[];

  @ApiProperty({ enum: Urgency })
  urgency: Urgency;

  @ApiProperty({ enum: ConversationStatus })
  status: ConversationStatus;

  @ApiProperty({ type: [MessageResponseDto] })
  messages: MessageResponseDto[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  // Include related user info
  @ApiPropertyOptional()
  student?: {
    id: string;
    user: {
      name: string;
      email: string;
    };
  };

  @ApiPropertyOptional()
  tutor?: {
    id: string;
    user: {
      name: string;
      email: string;
    };
  };
}

export class ConversationListResponseDto {
  @ApiProperty({ type: [ConversationResponseDto] })
  data: ConversationResponseDto[];

  @ApiProperty()
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

