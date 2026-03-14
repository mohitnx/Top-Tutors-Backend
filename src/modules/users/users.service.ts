import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { PaginationDto } from './dto/pagination.dto';
import { Role } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  async createUser(dto: CreateUserDto, currentUser?: any): Promise<UserResponseDto> {
    const normalizedEmail = dto.email.trim().toLowerCase();

    // ADMINISTRATOR can only create TEACHER and STUDENT, auto-scoped to their school
    if (currentUser?.role === 'ADMINISTRATOR') {
      if (dto.role !== Role.TEACHER && dto.role !== Role.STUDENT) {
        throw new ForbiddenException('Administrators can only create TEACHER and STUDENT users');
      }
      if (!currentUser.administeredSchoolId) {
        throw new ForbiddenException('Administrator is not linked to a school');
      }
      // Auto-fill schoolId — administrator cannot create users for other schools
      dto.schoolId = currentUser.administeredSchoolId;
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existingUser) {
      throw new ConflictException('A user with this email already exists');
    }

    // Validate school constraint
    if (dto.role === Role.ADMINISTRATOR) {
      if (!dto.schoolId) {
        throw new BadRequestException('schoolId is required for ADMINISTRATOR role');
      }
      const school = await this.prisma.school.findUnique({ where: { id: dto.schoolId } });
      if (!school) throw new NotFoundException(`School ${dto.schoolId} not found`);

      // Ensure school has no existing administrator
      const existingAdmin = await this.prisma.user.findFirst({
        where: { administeredSchoolId: dto.schoolId },
      });
      if (existingAdmin) {
        throw new ConflictException('This school already has an administrator');
      }
    }

    if (dto.role === Role.TEACHER) {
      if (!dto.schoolId) {
        throw new BadRequestException('schoolId is required for TEACHER role');
      }
      const school = await this.prisma.school.findUnique({ where: { id: dto.schoolId } });
      if (!school) throw new NotFoundException(`School ${dto.schoolId} not found`);

      if (!dto.sectionId) {
        throw new BadRequestException('sectionId is required for TEACHER role — create a grade and section first');
      }
      if (!dto.subject) {
        throw new BadRequestException('subject is required for TEACHER role');
      }
      const section = await this.prisma.class_sections.findUnique({ where: { id: dto.sectionId } });
      if (!section) throw new NotFoundException(`Section ${dto.sectionId} not found`);
      if (section.schoolId !== dto.schoolId) {
        throw new BadRequestException('Section does not belong to this school');
      }
    }

    if (dto.role === Role.STUDENT) {
      if (!dto.schoolId) {
        throw new BadRequestException('schoolId is required for STUDENT role');
      }
      const school = await this.prisma.school.findUnique({ where: { id: dto.schoolId } });
      if (!school) throw new NotFoundException(`School ${dto.schoolId} not found`);

      if (!dto.sectionId) {
        throw new BadRequestException('sectionId is required for STUDENT role — create a grade and section first');
      }
      const section = await this.prisma.class_sections.findUnique({ where: { id: dto.sectionId } });
      if (!section) throw new NotFoundException(`Section ${dto.sectionId} not found`);
      if (section.schoolId !== dto.schoolId) {
        throw new BadRequestException('Section does not belong to this school');
      }
    }

    const invitationToken = crypto.randomBytes(32).toString('hex');
    const invitationExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const user = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: normalizedEmail,
          name: dto.name,
          role: dto.role,
          isActive: false,
          invitationToken,
          invitationExpiresAt,
          ...(dto.role === Role.ADMINISTRATOR && dto.schoolId
            ? { administeredSchoolId: dto.schoolId }
            : {}),
        },
      });

      if (dto.role === Role.STUDENT) {
        const student = await tx.students.create({
          data: {
            id: uuidv4(),
            userId: newUser.id,
            schoolId: dto.schoolId!,
            updatedAt: new Date(),
          },
        });
        // Auto-assign to section
        await tx.student_sections.create({
          data: { studentId: student.id, sectionId: dto.sectionId! },
        });
      } else if (dto.role === Role.TUTOR) {
        await tx.tutors.create({
          data: {
            id: uuidv4(),
            userId: newUser.id,
            updatedAt: new Date(),
          },
        });
      } else if (dto.role === Role.TEACHER && dto.schoolId) {
        const teacher = await tx.teachers.create({
          data: {
            userId: newUser.id,
            schoolId: dto.schoolId,
          },
        });
        // Auto-assign to section+subject
        await tx.teacher_sections.create({
          data: { teacherId: teacher.id, sectionId: dto.sectionId!, subject: dto.subject! },
        });
      }

      return newUser;
    });

    // Send invitation email (non-blocking — log error but don't fail the request)
    this.emailService.sendInvitation(user.email, user.name, invitationToken, user.role).catch((err) => {
      this.logger.error(`Could not send invitation email to ${user.email}: ${err.message}`);
    });

    this.logger.log(`User created and invitation sent: ${user.id} (${user.role})`);
    return this.mapToResponse(user, dto.schoolId);
  }

  async bulkCreateUsers(dtos: CreateUserDto[], currentUser?: any): Promise<{ created: UserResponseDto[]; failed: { email: string; reason: string }[] }> {
    const created: UserResponseDto[] = [];
    const failed: { email: string; reason: string }[] = [];

    for (const dto of dtos) {
      try {
        const user = await this.createUser(dto, currentUser);
        created.push(user);
      } catch (err) {
        failed.push({ email: dto.email, reason: err.message });
      }
    }

    return { created, failed };
  }

  async resendInvitation(userId: string, currentUser?: any): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { students: true, teachers: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.isActive) throw new BadRequestException('User has already accepted their invitation');

    // ADMINISTRATOR can only resend invitations for users in their school
    if (currentUser?.role === 'ADMINISTRATOR') {
      const userSchoolId = user.teachers?.schoolId ?? user.students?.schoolId;
      if (userSchoolId !== currentUser.administeredSchoolId) {
        throw new ForbiddenException('You can only resend invitations for users in your school');
      }
    }

    const invitationToken = crypto.randomBytes(32).toString('hex');
    const invitationExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.user.update({
      where: { id: userId },
      data: { invitationToken, invitationExpiresAt },
    });

    await this.emailService.sendInvitation(user.email, user.name, invitationToken, user.role);
    this.logger.log(`Invitation resent to ${user.email}`);
  }

  async findAll(paginationDto: PaginationDto, currentUser?: any) {
    const { page = 1, limit = 10 } = paginationDto;
    const skip = (page - 1) * limit;

    // ADMINISTRATOR only sees teachers and students belonging to their school
    const where = currentUser?.role === 'ADMINISTRATOR' && currentUser.administeredSchoolId
      ? {
          OR: [
            { teachers: { schoolId: currentUser.administeredSchoolId } },
            { students: { schoolId: currentUser.administeredSchoolId } },
          ],
        }
      : {};

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { students: true },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users.map((u) => this.mapToResponse(u, u.students?.schoolId)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string): Promise<UserResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { students: true },
    });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return this.mapToResponse(user, user.students?.schoolId);
  }

  async update(id: string, updateUserDto: UpdateUserDto): Promise<UserResponseDto> {
    await this.findOne(id);
    const user = await this.prisma.user.update({
      where: { id },
      data: updateUserDto as any,
      include: { students: true },
    });
    return this.mapToResponse(user, user.students?.schoolId);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.prisma.user.delete({ where: { id } });
    this.logger.log(`User deleted: ${id}`);
  }

  private mapToResponse(
    user: { id: string; email: string; name: string; role: string; isActive: boolean; createdAt: Date; updatedAt: Date },
    schoolId?: string | null,
  ): UserResponseDto {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      schoolId: schoolId ?? null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
