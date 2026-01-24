import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsString, IsEnum, IsOptional, MinLength, MaxLength, Matches } from 'class-validator';
import { RegisterBaseDto } from './register.dto';
import { Role } from '@prisma/client';

export class RegisterUserDto extends RegisterBaseDto {
  @ApiPropertyOptional({
    enum: Role,
    example: Role.STUDENT,
    description: 'User role (STUDENT or TUTOR)',
  })
  @IsOptional()
  @IsEnum(Role, { message: 'Invalid user role' })
  role?: Role;

  // Student-specific fields (optional)
  @ApiPropertyOptional({
    example: 'Grade 10',
    description: 'Student grade/class',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  grade?: string;

  @ApiPropertyOptional({
    example: 'Springfield High School',
    description: 'School name',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  school?: string;

  @ApiPropertyOptional({
    example: '+1234567890',
    description: 'Phone number',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phoneNumber?: string;
}

