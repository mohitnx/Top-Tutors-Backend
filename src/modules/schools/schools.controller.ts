import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { SchoolsService } from './schools.service';
import { CreateSchoolDto, UpdateSchoolDto } from './dto/school.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '@prisma/client';

@ApiTags('admin/schools')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/schools')
export class SchoolsController {
  constructor(private readonly schoolsService: SchoolsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a school [ADMIN]' })
  @ApiResponse({ status: 201, description: 'School created' })
  @ApiResponse({ status: 409, description: 'School code already taken' })
  create(@Body() dto: CreateSchoolDto) {
    return this.schoolsService.create(dto);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'List all schools [ADMIN]' })
  findAll() {
    return this.schoolsService.findAll();
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ADMINISTRATOR')
  @ApiOperation({ summary: 'Get school details [ADMIN or school ADMINISTRATOR]' })
  @ApiParam({ name: 'id', type: String })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    // Administrators will get a 403 from listStudents if it's not their school;
    // for details we allow them to see their own school
    if (user.role === Role.ADMINISTRATOR && user.administeredSchoolId !== id) {
      return { message: 'Forbidden' };
    }
    return this.schoolsService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Update school [ADMIN]' })
  @ApiParam({ name: 'id', type: String })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSchoolDto) {
    return this.schoolsService.update(id, dto);
  }

  @Get(':id/students')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ADMINISTRATOR')
  @ApiOperation({ summary: "List school's students [ADMIN or school ADMINISTRATOR]" })
  @ApiParam({ name: 'id', type: String })
  listStudents(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.schoolsService.listStudents(id, {
      role: user.role,
      administeredSchoolId: user.administeredSchoolId,
    });
  }
}
