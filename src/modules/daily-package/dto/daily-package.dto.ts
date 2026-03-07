import { ApiProperty } from '@nestjs/swagger';
import { Subject } from '@prisma/client';
import { IsEnum, IsUUID } from 'class-validator';

export class UploadQuestionsDto {
  @ApiProperty({ example: 'uuid-of-section' })
  @IsUUID()
  sectionId: string;

  @ApiProperty({ enum: Subject })
  @IsEnum(Subject)
  subject: Subject;
}
