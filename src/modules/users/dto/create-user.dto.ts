import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsString, IsOptional, IsEnum, IsUUID, MaxLength } from 'class-validator';
import { Role, Subject } from '@prisma/client';

export class CreateUserDto {
  @ApiProperty({ example: 'jane@school.edu', description: 'User email address' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Jane Smith', description: 'Full name' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    enum: ['ADMINISTRATOR', 'TEACHER', 'TUTOR', 'STUDENT'],
    description: 'Role to assign. ADMIN role is seeded, not created via this endpoint.',
  })
  @IsEnum(Role)
  role: Role;

  @ApiPropertyOptional({
    example: 'uuid-of-school',
    description: 'Required if role=ADMINISTRATOR. Auto-filled for ADMINISTRATOR-created users.',
  })
  @IsOptional()
  @IsUUID()
  schoolId?: string;

  @ApiPropertyOptional({
    example: 'uuid-of-section',
    description: 'Required for TEACHER and STUDENT roles. Must be a valid section in the school.',
  })
  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @ApiPropertyOptional({
    enum: Subject,
    description: 'Required for TEACHER role. The subject this teacher teaches in the assigned section.',
  })
  @IsOptional()
  @IsEnum(Subject)
  subject?: Subject;
}

export class BulkCreateUsersDto {
  @ApiProperty({ type: [CreateUserDto] })
  users: CreateUserDto[];
}
