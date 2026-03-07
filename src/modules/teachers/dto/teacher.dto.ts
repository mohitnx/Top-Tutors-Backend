import { ApiPropertyOptional } from '@nestjs/swagger';
import { Subject } from '@prisma/client';
import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdateTeacherDto {
  @ApiPropertyOptional({ example: 'Experienced math teacher' })
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional({ enum: Subject, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(Subject, { each: true })
  subjects?: Subject[];
}
