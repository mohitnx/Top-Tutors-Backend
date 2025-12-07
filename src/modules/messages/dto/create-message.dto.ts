import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsUUID } from 'class-validator';
import { MessageType } from '@prisma/client';

export class CreateMessageDto {
  @ApiPropertyOptional({ description: 'Text content of the message' })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiProperty({ enum: MessageType, default: MessageType.TEXT })
  @IsEnum(MessageType)
  messageType: MessageType = MessageType.TEXT;

  @ApiPropertyOptional({ description: 'Conversation ID (if continuing existing conversation)' })
  @IsOptional()
  @IsUUID()
  conversationId?: string;
}

export class CreateAudioMessageDto {
  @ApiPropertyOptional({ description: 'Conversation ID (if continuing existing conversation)' })
  @IsOptional()
  @IsUUID()
  conversationId?: string;
}

