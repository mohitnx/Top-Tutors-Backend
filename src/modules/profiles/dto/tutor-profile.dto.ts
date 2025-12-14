import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsDateString,
  IsArray,
  IsEnum,
  IsNumber,
  IsBoolean,
  IsUrl,
  MaxLength,
  Min,
  Max,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Subject } from './shared.dto';

// Academic Qualification DTO
export class AcademicQualificationDto {
  @ApiProperty({ description: 'Institution name', example: 'Harvard University' })
  @IsString()
  institution: string;

  @ApiProperty({ description: 'Degree obtained', example: 'Master of Science' })
  @IsString()
  degree: string;

  @ApiProperty({ description: 'Field of study', example: 'Computer Science' })
  @IsString()
  field: string;

  @ApiPropertyOptional({ description: 'Year of graduation', example: 2020 })
  @IsOptional()
  @IsNumber()
  year?: number;

  @ApiPropertyOptional({ description: 'GPA/Grade', example: '3.8' })
  @IsOptional()
  @IsString()
  gpa?: string;
}

// Certificate DTO
export class CertificateDto {
  @ApiProperty({ description: 'Certificate name', example: 'AWS Certified Developer' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Issuing organization', example: 'Amazon Web Services' })
  @IsString()
  issuedBy: string;

  @ApiPropertyOptional({ description: 'Issue date', example: '2023-01-15' })
  @IsOptional()
  @IsDateString()
  issuedDate?: string;

  @ApiPropertyOptional({ description: 'Expiry date', example: '2026-01-15' })
  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @ApiPropertyOptional({ description: 'Certificate document URL' })
  @IsOptional()
  @IsString()
  url?: string;

  @ApiPropertyOptional({ description: 'Whether the certificate is verified', default: false })
  @IsOptional()
  @IsBoolean()
  verified?: boolean;
}

// Work Experience DTO
export class WorkExperienceDto {
  @ApiProperty({ description: 'Company/Organization name', example: 'Google' })
  @IsString()
  company: string;

  @ApiProperty({ description: 'Job role/title', example: 'Senior Software Engineer' })
  @IsString()
  role: string;

  @ApiPropertyOptional({ description: 'Start date', example: '2018-06-01' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date (leave empty if current)', example: '2022-12-31' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Job description' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    description: 'Type of experience',
    enum: ['WORK', 'RESEARCH', 'TEACHING', 'INTERNSHIP', 'VOLUNTEER'],
  })
  @IsOptional()
  @IsString()
  type?: string;
}

// Availability Schedule DTO
export class DayScheduleDto {
  @ApiProperty({ description: 'Start time', example: '09:00' })
  @IsString()
  start: string;

  @ApiProperty({ description: 'End time', example: '17:00' })
  @IsString()
  end: string;
}

export class AvailabilityScheduleDto {
  @ApiPropertyOptional({ type: [DayScheduleDto] })
  @IsOptional()
  @IsArray()
  monday?: DayScheduleDto[];

  @ApiPropertyOptional({ type: [DayScheduleDto] })
  @IsOptional()
  @IsArray()
  tuesday?: DayScheduleDto[];

  @ApiPropertyOptional({ type: [DayScheduleDto] })
  @IsOptional()
  @IsArray()
  wednesday?: DayScheduleDto[];

  @ApiPropertyOptional({ type: [DayScheduleDto] })
  @IsOptional()
  @IsArray()
  thursday?: DayScheduleDto[];

  @ApiPropertyOptional({ type: [DayScheduleDto] })
  @IsOptional()
  @IsArray()
  friday?: DayScheduleDto[];

  @ApiPropertyOptional({ type: [DayScheduleDto] })
  @IsOptional()
  @IsArray()
  saturday?: DayScheduleDto[];

  @ApiPropertyOptional({ type: [DayScheduleDto] })
  @IsOptional()
  @IsArray()
  sunday?: DayScheduleDto[];
}

export class CreateTutorProfileDto {
  // Basic Info
  @ApiPropertyOptional({
    description: 'Short bio/introduction',
    example: 'Passionate educator with 10+ years of experience',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @ApiPropertyOptional({ description: 'Phone number', example: '+1234567890' })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiPropertyOptional({ description: 'Date of birth', example: '1985-03-15' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  // Location
  @ApiPropertyOptional({ description: 'Street address', example: '456 University Ave' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @ApiPropertyOptional({ description: 'City', example: 'Boston' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ description: 'State/Province', example: 'MA' })
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

  // Academic Qualifications
  @ApiPropertyOptional({
    description: 'Legacy qualification field (use academicQualifications for detailed info)',
    example: 'PhD in Mathematics',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  qualification?: string;

  @ApiPropertyOptional({
    description: 'Detailed academic qualifications',
    type: [AcademicQualificationDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AcademicQualificationDto)
  academicQualifications?: AcademicQualificationDto[];

  // Teaching Info
  @ApiPropertyOptional({ description: 'Years of teaching experience', example: 5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(50)
  experience?: number;

  @ApiPropertyOptional({ description: 'Hourly rate in USD', example: 50 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(500)
  hourlyRate?: number;

  @ApiPropertyOptional({
    description: 'Subjects the tutor teaches',
    enum: Subject,
    isArray: true,
    example: ['MATHEMATICS', 'PHYSICS'],
  })
  @IsOptional()
  @IsArray()
  @IsEnum(Subject, { each: true })
  subjects?: Subject[];

  @ApiPropertyOptional({
    description: 'Detailed areas of expertise',
    example: 'Calculus, Linear Algebra, Differential Equations, Statistics',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  areasOfExpertise?: string;

  @ApiPropertyOptional({
    description: 'Teaching philosophy',
    example: 'I believe in making complex concepts simple and engaging',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  teachingPhilosophy?: string;

  @ApiPropertyOptional({
    description: 'Teaching style',
    enum: ['Interactive', 'Lecture-based', 'Project-based', 'Discussion-based', 'Hands-on', 'Mixed'],
    example: 'Interactive',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  teachingStyle?: string;

  // Certifications
  @ApiPropertyOptional({
    description: 'Professional certifications',
    type: [CertificateDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CertificateDto)
  certificates?: CertificateDto[];

  // Work & Research Experience
  @ApiPropertyOptional({
    description: 'Work experience history',
    type: [WorkExperienceDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkExperienceDto)
  workExperience?: WorkExperienceDto[];

  @ApiPropertyOptional({
    description: 'Research experience description',
    example: 'Published 5 papers on machine learning applications in education',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  researchExperience?: string;

  @ApiPropertyOptional({
    description: 'Notable publications',
    example: 'Machine Learning in Education (Journal of Ed. Tech, 2022)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  publications?: string;

  // Professional Info
  @ApiPropertyOptional({ description: 'LinkedIn profile URL' })
  @IsOptional()
  @IsUrl()
  linkedinUrl?: string;

  @ApiPropertyOptional({ description: 'Personal website URL' })
  @IsOptional()
  @IsUrl()
  websiteUrl?: string;

  @ApiPropertyOptional({
    description: 'Languages spoken',
    example: ['English', 'Spanish', 'French'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  languages?: string[];

  // Availability
  @ApiPropertyOptional({ description: 'Whether the tutor is available for new students' })
  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @ApiPropertyOptional({
    description: 'Weekly availability schedule',
    type: AvailabilityScheduleDto,
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AvailabilityScheduleDto)
  availabilitySchedule?: AvailabilityScheduleDto;

  // Bank/Payment Info
  @ApiPropertyOptional({ description: 'Bank account number (for payouts)' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  bankAccountNumber?: string;

  @ApiPropertyOptional({ description: 'Bank name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankName?: string;

  @ApiPropertyOptional({ description: 'Bank routing number' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  bankRoutingNumber?: string;
}

export class UpdateTutorProfileDto extends PartialType(CreateTutorProfileDto) {}

// Response DTO
export class TutorProfileResponseDto {
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

  // Basic Info
  @ApiPropertyOptional()
  bio?: string;

  @ApiPropertyOptional()
  phoneNumber?: string;

  @ApiPropertyOptional()
  dateOfBirth?: Date;

  // Location
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

  // Academic Qualifications
  @ApiPropertyOptional()
  qualification?: string;

  @ApiPropertyOptional({ type: [AcademicQualificationDto] })
  academicQualifications?: AcademicQualificationDto[];

  // Teaching Info
  @ApiPropertyOptional()
  experience?: number;

  @ApiPropertyOptional()
  hourlyRate?: number;

  @ApiPropertyOptional({ isArray: true })
  subjects?: string[];

  @ApiPropertyOptional()
  areasOfExpertise?: string;

  @ApiPropertyOptional()
  teachingPhilosophy?: string;

  @ApiPropertyOptional()
  teachingStyle?: string;

  // Certifications
  @ApiPropertyOptional({ type: [CertificateDto] })
  certificates?: CertificateDto[];

  // Work & Research Experience
  @ApiPropertyOptional({ type: [WorkExperienceDto] })
  workExperience?: WorkExperienceDto[];

  @ApiPropertyOptional()
  researchExperience?: string;

  @ApiPropertyOptional()
  publications?: string;

  // Professional Info
  @ApiPropertyOptional()
  linkedinUrl?: string;

  @ApiPropertyOptional()
  websiteUrl?: string;

  @ApiPropertyOptional({ isArray: true })
  languages?: string[];

  // Availability
  @ApiProperty()
  isAvailable: boolean;

  @ApiProperty()
  isBusy: boolean;

  @ApiPropertyOptional()
  availabilitySchedule?: AvailabilityScheduleDto;

  // Stats & Ratings
  @ApiPropertyOptional()
  rating?: number;

  @ApiProperty()
  totalReviews: number;

  @ApiProperty()
  totalStudentsTaught: number;

  @ApiProperty()
  totalSessionsCompleted: number;

  @ApiProperty()
  totalHoursTaught: number;

  // Verification
  @ApiProperty()
  isVerified: boolean;

  @ApiPropertyOptional()
  verifiedAt?: Date;

  @ApiProperty()
  profileCompleted: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

// Certificate upload response
export class CertificateUploadResponseDto {
  @ApiProperty({ description: 'Certificate URL' })
  url: string;

  @ApiProperty({ description: 'Certificate name' })
  name: string;

  @ApiProperty({ description: 'Upload timestamp' })
  uploadedAt: Date;
}

