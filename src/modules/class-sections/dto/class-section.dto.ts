import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Subject } from '@prisma/client';
import { IsArray, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateClassSectionDto {
  @ApiProperty({ example: 'Grade 10 - Section D' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'uuid-of-school', description: 'Required for ADMIN. Auto-filled for ADMINISTRATOR.' })
  @IsOptional()
  @IsUUID()
  schoolId?: string;

  @ApiPropertyOptional({ example: 'Grade 10' })
  @IsOptional()
  @IsString()
  grade?: string;
}

export class UpdateClassSectionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  grade?: string;
}

export class AddStudentsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsUUID('all', { each: true })
  studentIds: string[];
}

export class AssignTeacherDto {
  @ApiProperty({ example: 'uuid-of-teacher' })
  @IsUUID()
  teacherId: string;

  @ApiProperty({ enum: Subject })
  @IsEnum(Subject)
  subject: Subject;
}
