import {
  Controller,
  Post,
  Get,
  Param,
  ParseUUIDPipe,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { DailyPackageService } from './daily-package.service';
import { UploadQuestionsDto } from './dto/daily-package.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('daily-package')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('daily-package')
export class DailyPackageController {
  constructor(private readonly dailyPackageService: DailyPackageService) {}

  @Post('upload')
  @UseGuards(RolesGuard)
  @Roles('TEACHER', 'ADMINISTRATOR')
  @UseInterceptors(FilesInterceptor('files', 50))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload batch question images (max 50) [TEACHER, ADMINISTRATOR]' })
  async upload(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() dto: UploadQuestionsDto,
    @CurrentUser() user: any,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('At least one image file is required');
    }

    const imageBuffers = files.map((f) => f.buffer);
    return this.dailyPackageService.createUpload(
      user.id,
      user.role,
      user.administeredSchoolId,
      dto.sectionId,
      dto.subject,
      imageBuffers,
    );
  }

  @Get('uploads')
  @UseGuards(RolesGuard)
  @Roles('TEACHER', 'ADMINISTRATOR')
  @ApiOperation({ summary: 'List uploads with status [TEACHER, ADMINISTRATOR]' })
  async getMyUploads(@CurrentUser() user: any) {
    return this.dailyPackageService.getUploads(user.id, user.role, user.administeredSchoolId);
  }

  @Get('uploads/:id')
  @UseGuards(RolesGuard)
  @Roles('TEACHER', 'ADMINISTRATOR')
  @ApiOperation({ summary: 'Get upload details and processing status [TEACHER, ADMINISTRATOR]' })
  async getUploadStatus(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.dailyPackageService.getUploadDetails(id, user.id, user.role, user.administeredSchoolId);
  }
}
