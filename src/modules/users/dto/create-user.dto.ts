import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsString, IsOptional, IsEnum, IsUUID, MaxLength } from 'class-validator';
import { Role } from '@prisma/client';

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
    description: 'Required if role=ADMINISTRATOR or if student is school-affiliated',
  })
  @IsOptional()
  @IsUUID()
  schoolId?: string;
}

export class BulkCreateUsersDto {
  @ApiProperty({ type: [CreateUserDto] })
  users: CreateUserDto[];
}
