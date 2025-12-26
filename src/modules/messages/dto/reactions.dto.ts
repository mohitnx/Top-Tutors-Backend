import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsString, IsOptional, IsUUID } from 'class-validator';

export enum ReactionType {
  LIKE = 'LIKE',
  DISLIKE = 'DISLIKE',
}

export class AddReactionDto {
  @ApiProperty({
    description: 'Type of reaction',
    enum: ReactionType,
    example: 'LIKE',
  })
  @IsEnum(ReactionType)
  type: ReactionType;
}

export class ReactionResponseDto {
  @ApiProperty({ description: 'Reaction ID' })
  id: string;

  @ApiProperty({ description: 'Message ID' })
  messageId: string;

  @ApiProperty({ description: 'User ID who reacted' })
  userId: string;

  @ApiProperty({ description: 'Reaction type', enum: ReactionType })
  type: ReactionType;

  @ApiProperty({ description: 'When the reaction was created' })
  createdAt: Date;
}

export class MessageReactionSummaryDto {
  @ApiProperty({ description: 'Message ID' })
  messageId: string;

  @ApiProperty({ description: 'Number of likes' })
  likeCount: number;

  @ApiProperty({ description: 'Number of dislikes' })
  dislikeCount: number;

  @ApiPropertyOptional({
    description: 'Current user reaction (if any)',
    enum: ReactionType,
  })
  userReaction?: ReactionType | null;
}



