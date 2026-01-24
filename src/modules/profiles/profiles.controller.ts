import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ProfilesService } from './profiles.service';
import {
  CreateStudentProfileDto,
  UpdateStudentProfileDto,
  StudentProfileResponseDto,
  CreateTutorProfileDto,
  UpdateTutorProfileDto,
  TutorProfileResponseDto,
  CertificateDto,
} from './dto';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

@ApiTags('profiles')
@Controller('profiles')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  // ============ Student Profile Endpoints ============

  @Get('student/me')
  @UseGuards(RolesGuard)
  @Roles('STUDENT')
  @ApiOperation({ summary: 'Get current student profile' })
  @ApiResponse({ status: 200, description: 'Student profile', type: StudentProfileResponseDto })
  async getMyStudentProfile(@CurrentUser() user: any) {
    return this.profilesService.getStudentProfile(user.id);
  }

  @Put('student/me')
  @UseGuards(RolesGuard)
  @Roles('STUDENT')
  @ApiOperation({ summary: 'Update current student profile' })
  @ApiResponse({ status: 200, description: 'Updated student profile', type: StudentProfileResponseDto })
  async updateMyStudentProfile(
    @CurrentUser() user: any,
    @Body() dto: UpdateStudentProfileDto,
  ) {
    return this.profilesService.updateStudentProfile(user.id, dto);
  }

  @Get('student/:id')
  @ApiOperation({ summary: 'Get student profile by ID (admin or tutor viewing their student)' })
  @ApiResponse({ status: 200, description: 'Student profile', type: StudentProfileResponseDto })
  async getStudentProfile(@Param('id') id: string) {
    return this.profilesService.getStudentProfileById(id);
  }

  // ============ Tutor Profile Endpoints ============

  @Get('tutor/me')
  @UseGuards(RolesGuard)
  @Roles('TUTOR')
  @ApiOperation({ summary: 'Get current tutor profile' })
  @ApiResponse({ status: 200, description: 'Tutor profile', type: TutorProfileResponseDto })
  async getMyTutorProfile(@CurrentUser() user: any) {
    return this.profilesService.getTutorProfile(user.id);
  }

  @Put('tutor/me')
  @UseGuards(RolesGuard)
  @Roles('TUTOR')
  @ApiOperation({ summary: 'Update current tutor profile' })
  @ApiResponse({ status: 200, description: 'Updated tutor profile', type: TutorProfileResponseDto })
  async updateMyTutorProfile(
    @CurrentUser() user: any,
    @Body() dto: UpdateTutorProfileDto,
  ) {
    return this.profilesService.updateTutorProfile(user.id, dto);
  }

  @Get('tutor/:id')
  @ApiOperation({ summary: 'Get tutor profile by ID (public view)' })
  @ApiResponse({ status: 200, description: 'Tutor profile', type: TutorProfileResponseDto })
  async getTutorProfile(@Param('id') id: string) {
    return this.profilesService.getTutorProfileById(id);
  }

  @Get('tutors')
  @ApiOperation({ summary: 'Get list of verified tutors (public listing)' })
  @ApiQuery({ name: 'subjects', required: false, description: 'Filter by subjects (comma-separated)' })
  @ApiQuery({ name: 'minRating', required: false, type: Number, description: 'Minimum rating' })
  @ApiQuery({ name: 'maxHourlyRate', required: false, type: Number, description: 'Maximum hourly rate' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page' })
  @ApiResponse({ status: 200, description: 'List of tutors with pagination' })
  async getVerifiedTutors(
    @Query('subjects') subjects?: string,
    @Query('minRating') minRating?: string,
    @Query('maxHourlyRate') maxHourlyRate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.profilesService.getVerifiedTutors({
      subjects: subjects ? subjects.split(',') : undefined,
      minRating: minRating ? parseFloat(minRating) : undefined,
      maxHourlyRate: maxHourlyRate ? parseFloat(maxHourlyRate) : undefined,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  // ============ Certificate Management ============

  @Post('tutor/certificates')
  @UseGuards(RolesGuard)
  @Roles('TUTOR')
  @ApiOperation({ summary: 'Add a certificate to tutor profile' })
  @ApiResponse({ status: 201, description: 'Certificate added', type: TutorProfileResponseDto })
  async addCertificate(
    @CurrentUser() user: any,
    @Body() certificate: CertificateDto,
  ) {
    return this.profilesService.addCertificate(user.id, certificate);
  }

  @Delete('tutor/certificates/:certificateId')
  @UseGuards(RolesGuard)
  @Roles('TUTOR')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a certificate from tutor profile' })
  @ApiResponse({ status: 200, description: 'Certificate removed', type: TutorProfileResponseDto })
  async removeCertificate(
    @CurrentUser() user: any,
    @Param('certificateId') certificateId: string,
  ) {
    return this.profilesService.removeCertificate(user.id, certificateId);
  }

  @Post('tutor/certificates/upload')
  @UseGuards(RolesGuard)
  @Roles('TUTOR')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a certificate document' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Certificate file (PDF, JPG, PNG)',
        },
        name: {
          type: 'string',
          description: 'Certificate name',
        },
        issuedBy: {
          type: 'string',
          description: 'Issuing organization',
        },
        issuedDate: {
          type: 'string',
          description: 'Issue date (YYYY-MM-DD)',
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Certificate uploaded and added to profile' })
  async uploadCertificate(
    @CurrentUser() user: any,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { name: string; issuedBy: string; issuedDate?: string },
  ) {
    if (!file) {
      throw new BadRequestException('Certificate file is required');
    }

    // Validate file type
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException('Only PDF, JPG, and PNG files are allowed');
    }

    // Save file
    const uploadDir = path.join(process.cwd(), 'uploads', 'certificates');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const fileExt = path.extname(file.originalname);
    const fileName = `${user.id}_${uuidv4()}${fileExt}`;
    const filePath = path.join(uploadDir, fileName);
    fs.writeFileSync(filePath, file.buffer);

    const fileUrl = `/uploads/certificates/${fileName}`;

    // Add certificate to profile
    return this.profilesService.addCertificate(user.id, {
      name: body.name,
      issuedBy: body.issuedBy,
      issuedDate: body.issuedDate,
      url: fileUrl,
    });
  }

  // ============ Avatar Upload ============

  @Post('avatar')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload profile avatar' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Avatar image (JPG, PNG, WebP)',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Avatar updated' })
  async uploadAvatar(
    @CurrentUser() user: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Avatar file is required');
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException('Only JPG, PNG, and WebP images are allowed');
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('File size must be less than 5MB');
    }

    // Save file
    const uploadDir = path.join(process.cwd(), 'uploads', 'avatars');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const fileExt = path.extname(file.originalname);
    const fileName = `${user.id}_${uuidv4()}${fileExt}`;
    const filePath = path.join(uploadDir, fileName);
    fs.writeFileSync(filePath, file.buffer);

    const avatarUrl = `/uploads/avatars/${fileName}`;

    return this.profilesService.updateAvatar(user.id, avatarUrl);
  }

  // ============ User Name Update ============

  @Put('name')
  @ApiOperation({ summary: 'Update user display name' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'New display name',
          example: 'John Doe',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Name updated' })
  async updateName(
    @CurrentUser() user: any,
    @Body() body: { name: string },
  ) {
    if (!body.name || body.name.trim().length < 2) {
      throw new BadRequestException('Name must be at least 2 characters');
    }
    return this.profilesService.updateUserName(user.id, body.name.trim());
  }
}






