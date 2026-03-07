import { Controller, Get, Patch, Param, Body, ParseUUIDPipe, UseGuards, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TeachersService } from './teachers.service';
import { UpdateTeacherDto } from './dto/teacher.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class TeachersController {
  constructor(private readonly teachersService: TeachersService) {}

  // ============ Teacher-facing endpoints ============

  @Get('teachers/me')
  @UseGuards(RolesGuard)
  @Roles('TEACHER')
  @ApiTags('teachers')
  @ApiOperation({ summary: 'Get my teacher profile with sections [TEACHER]' })
  async getMyProfile(@CurrentUser() user: any) {
    const teacher = await this.teachersService.findByUserId(user.id);
    if (!teacher) throw new NotFoundException('Teacher profile not found');
    return teacher;
  }

  @Get('teachers/me/sections')
  @UseGuards(RolesGuard)
  @Roles('TEACHER')
  @ApiTags('teachers')
  @ApiOperation({ summary: 'Get my assigned sections with subjects [TEACHER]' })
  async getMySections(@CurrentUser() user: any) {
    return this.teachersService.getMySections(user.id);
  }

  // ============ Admin-facing endpoints ============

  @Get('admin/teachers')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ADMINISTRATOR')
  @ApiTags('admin/teachers')
  @ApiOperation({ summary: 'List teachers [ADMIN, ADMINISTRATOR]' })
  findAll(@CurrentUser() user: any) {
    return this.teachersService.findAll(user);
  }

  @Get('admin/teachers/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ADMINISTRATOR')
  @ApiTags('admin/teachers')
  @ApiOperation({ summary: 'Get teacher [ADMIN, ADMINISTRATOR]' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.teachersService.findOne(id, user);
  }

  @Patch('admin/teachers/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @ApiTags('admin/teachers')
  @ApiOperation({ summary: 'Update teacher profile [ADMIN]' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTeacherDto) {
    return this.teachersService.update(id, dto);
  }
}
