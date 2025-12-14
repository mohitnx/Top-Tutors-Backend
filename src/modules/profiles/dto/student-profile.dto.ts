import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEmail,
  IsDateString,
  IsArray,
  IsEnum,
  IsBoolean,
  MaxLength,
  IsPhoneNumber,
} from 'class-validator';
import { Subject } from './shared.dto';

export class CreateStudentProfileDto {
  // Basic Info
  @ApiPropertyOptional({ description: 'Student grade/year', example: 'Grade 11' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  grade?: string;

  @ApiPropertyOptional({ description: 'School name', example: 'Springfield High School' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  school?: string;

  @ApiPropertyOptional({ description: 'Phone number', example: '+1234567890' })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiPropertyOptional({ description: 'Date of birth', example: '2005-03-15' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  // Parent/Guardian Info
  @ApiPropertyOptional({ description: 'Parent/Guardian name', example: 'John Doe' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  parentName?: string;

  @ApiPropertyOptional({ description: 'Parent/Guardian email', example: 'parent@email.com' })
  @IsOptional()
  @IsEmail()
  parentEmail?: string;

  @ApiPropertyOptional({ description: 'Parent/Guardian phone', example: '+1234567890' })
  @IsOptional()
  @IsString()
  parentPhone?: string;

  // Location
  @ApiPropertyOptional({ description: 'Street address', example: '123 Main St' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @ApiPropertyOptional({ description: 'City', example: 'New York' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ description: 'State/Province', example: 'NY' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @ApiPropertyOptional({ description: 'Country', example: 'USA' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @ApiPropertyOptional({ description: 'Timezone', example: 'America/New_York' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  timezone?: string;

  // Academic Preferences
  @ApiPropertyOptional({
    description: 'Preferred subjects for tutoring',
    enum: Subject,
    isArray: true,
    example: ['MATHEMATICS', 'PHYSICS'],
  })
  @IsOptional()
  @IsArray()
  @IsEnum(Subject, { each: true })
  preferredSubjects?: Subject[];

  @ApiPropertyOptional({
    description: 'Learning goals',
    example: 'I want to improve my math grades and prepare for SAT',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  learningGoals?: string;

  @ApiPropertyOptional({
    description: 'Academic level',
    example: 'High School',
    enum: ['Elementary', 'Middle School', 'High School', 'Undergraduate', 'Graduate', 'Professional'],
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  academicLevel?: string;
}

export class UpdateStudentProfileDto extends PartialType(CreateStudentProfileDto) {}

// Response DTO
export class StudentProfileResponseDto {
  @ApiProperty({ description: 'Profile ID' })
  id: string;

  @ApiProperty({ description: 'User ID' })
  userId: string;

  // User info (from related User model)
  @ApiPropertyOptional({ description: 'User name' })
  name?: string;

  @ApiPropertyOptional({ description: 'User email' })
  email?: string;

  @ApiPropertyOptional({ description: 'Avatar URL' })
  avatar?: string;

  // Student profile fields
  @ApiPropertyOptional()
  grade?: string;

  @ApiPropertyOptional()
  school?: string;

  @ApiPropertyOptional()
  phoneNumber?: string;

  @ApiPropertyOptional()
  dateOfBirth?: Date;

  @ApiPropertyOptional()
  parentName?: string;

  @ApiPropertyOptional()
  parentEmail?: string;

  @ApiPropertyOptional()
  parentPhone?: string;

  @ApiPropertyOptional()
  address?: string;

  @ApiPropertyOptional()
  city?: string;

  @ApiPropertyOptional()
  state?: string;

  @ApiPropertyOptional()
  country?: string;

  @ApiPropertyOptional()
  timezone?: string;

  @ApiPropertyOptional({ isArray: true })
  preferredSubjects?: string[];

  @ApiPropertyOptional()
  learningGoals?: string;

  @ApiPropertyOptional()
  academicLevel?: string;

  @ApiProperty()
  profileCompleted: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

