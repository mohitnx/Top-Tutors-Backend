import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { ClassSectionsService } from './class-sections.service';
import {
  CreateClassSectionDto,
  UpdateClassSectionDto,
  AddStudentsDto,
  AssignTeacherDto,
} from './dto/class-section.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('admin/sections')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/sections')
export class ClassSectionsController {
  constructor(private readonly classSectionsService: ClassSectionsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ADMINISTRATOR')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a class section [ADMIN, ADMINISTRATOR]' })
  create(@Body() dto: CreateClassSectionDto, @CurrentUser() user: any) {
    return this.classSectionsService.create(dto, user);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ADMINISTRATOR')
  @ApiOperation({ summary: 'List sections [ADMIN, ADMINISTRATOR]' })
  findAll(@CurrentUser() user: any) {
    return this.classSectionsService.findAll(user);
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ADMINISTRATOR')
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Get section details with students and teachers [ADMIN, ADMINISTRATOR]' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.classSectionsService.findOne(id, user);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ADMINISTRATOR')
  @ApiOperation({ summary: 'Update section [ADMIN, ADMINISTRATOR]' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateClassSectionDto) {
    return this.classSectionsService.update(id, dto);
  }

  @Get('available-students')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ADMINISTRATOR')
  @ApiOperation({ summary: 'List students not assigned to any section [ADMIN, ADMINISTRATOR]' })
  getAvailableStudents(@CurrentUser() user: any) {
    return this.classSectionsService.getAvailableStudents(user);
  }

  @Get('available-teachers')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ADMINISTRATOR')
  @ApiOperation({ summary: 'List school teachers with their section assignments [ADMIN, ADMINISTRATOR]' })
  getSchoolTeachers(@CurrentUser() user: any) {
    return this.classSectionsService.getSchoolTeachers(user);
  }

  @Post(':id/students')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ADMINISTRATOR')
  @ApiOperation({ summary: 'Add students to section [ADMIN, ADMINISTRATOR]' })
  addStudents(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddStudentsDto) {
    return this.classSectionsService.addStudents(id, dto);
  }

  @Delete(':id/students/:studentId')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ADMINISTRATOR')
  @ApiOperation({ summary: 'Remove student from section [ADMIN, ADMINISTRATOR]' })
  removeStudent(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    return this.classSectionsService.removeStudent(id, studentId);
  }

  @Post(':id/teachers')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ADMINISTRATOR')
  @ApiOperation({ summary: 'Assign teacher to section for a subject [ADMIN, ADMINISTRATOR]' })
  assignTeacher(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignTeacherDto) {
    return this.classSectionsService.assignTeacher(id, dto);
  }

  @Delete(':id/teachers/:teacherId')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ADMINISTRATOR')
  @ApiOperation({ summary: 'Remove teacher from section [ADMIN, ADMINISTRATOR]' })
  removeTeacher(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('teacherId', ParseUUIDPipe) teacherId: string,
  ) {
    return this.classSectionsService.removeTeacher(id, teacherId);
  }
}
