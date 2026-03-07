import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards, Redirect } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { DailyPackageService } from './daily-package.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('packages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('packages')
export class PackagesController {
  constructor(private readonly dailyPackageService: DailyPackageService) {}

  @Get('daily')
  @ApiOperation({ summary: 'List your daily learning packages [STUDENT]' })
  getDailyPackages(@CurrentUser() user: any) {
    return this.dailyPackageService.getStudentPackages(user.id, 'daily');
  }

  @Get('weekly')
  @ApiOperation({ summary: 'List your weekly learning packages [STUDENT]' })
  getWeeklyPackages(@CurrentUser() user: any) {
    return this.dailyPackageService.getStudentPackages(user.id, 'weekly');
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Get a signed download URL for a package [STUDENT]' })
  async getDownloadUrl(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    const url = await this.dailyPackageService.getPackageDownloadUrl(id, user.id);
    return { url };
  }
}
