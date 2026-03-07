import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto, BulkCreateUsersDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { PaginationDto } from './dto/pagination.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('admin/users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Roles('ADMIN', 'ADMINISTRATOR')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a user and send invitation email [ADMIN, ADMINISTRATOR]' })
  @ApiResponse({ status: 201, type: UserResponseDto })
  @ApiResponse({ status: 409, description: 'Email already exists' })
  @ApiResponse({ status: 403, description: 'ADMINISTRATOR can only create TEACHER/STUDENT roles' })
  create(@Body() dto: CreateUserDto, @CurrentUser() currentUser: any): Promise<UserResponseDto> {
    return this.usersService.createUser(dto, currentUser);
  }

  @Post('bulk')
  @Roles('ADMIN', 'ADMINISTRATOR')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Bulk create users and send invitation emails [ADMIN, ADMINISTRATOR]' })
  @ApiResponse({ status: 201, description: '{ created: UserResponseDto[], failed: { email, reason }[] }' })
  bulkCreate(@Body() dto: BulkCreateUsersDto, @CurrentUser() currentUser: any) {
    return this.usersService.bulkCreateUsers(dto.users, currentUser);
  }

  @Post(':id/resend-invitation')
  @Roles('ADMIN', 'ADMINISTRATOR')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Resend invitation email [ADMIN, ADMINISTRATOR]' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 204, description: 'Invitation resent' })
  resendInvitation(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() currentUser: any): Promise<void> {
    return this.usersService.resendInvitation(id, currentUser);
  }

  @Get()
  @Roles('ADMIN', 'ADMINISTRATOR')
  @ApiOperation({ summary: 'List users with pagination [ADMIN sees all, ADMINISTRATOR sees own school]' })
  @ApiResponse({ status: 200, type: [UserResponseDto] })
  findAll(@Query() paginationDto: PaginationDto, @CurrentUser() currentUser: any) {
    return this.usersService.findAll(paginationDto, currentUser);
  }

  @Get(':id')
  @Roles('ADMIN', 'ADMINISTRATOR')
  @ApiOperation({ summary: 'Get user by ID [ADMIN, ADMINISTRATOR]' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiResponse({ status: 404, description: 'User not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<UserResponseDto> {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update user [ADMIN]' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: UserResponseDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto): Promise<UserResponseDto> {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete user [ADMIN]' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 204, description: 'User deleted' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.usersService.remove(id);
  }
}
