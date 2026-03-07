import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Role } from '@prisma/client';
import { UpdateTeacherDto } from './dto/teacher.dto';

@Injectable()
export class TeachersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(currentUser: { role: Role; administeredSchoolId?: string | null }) {
    const where =
      currentUser.role === Role.ADMINISTRATOR && currentUser.administeredSchoolId
        ? { schoolId: currentUser.administeredSchoolId }
        : {};

    return this.prisma.teachers.findMany({
      where,
      include: { users: { select: { id: true, name: true, email: true, isActive: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, currentUser: { role: Role; administeredSchoolId?: string | null }) {
    const teacher = await this.prisma.teachers.findUnique({
      where: { id },
      include: {
        users: { select: { id: true, name: true, email: true, isActive: true } },
        teacher_sections: { include: { class_sections: true } },
      },
    });
    if (!teacher) throw new NotFoundException(`Teacher ${id} not found`);

    if (
      currentUser.role === Role.ADMINISTRATOR &&
      teacher.schoolId !== currentUser.administeredSchoolId
    ) {
      throw new ForbiddenException('Access denied');
    }

    return teacher;
  }

  async update(id: string, dto: UpdateTeacherDto) {
    const teacher = await this.prisma.teachers.findUnique({ where: { id } });
    if (!teacher) throw new NotFoundException(`Teacher ${id} not found`);

    return this.prisma.teachers.update({
      where: { id },
      data: { ...dto },
      include: { users: { select: { id: true, name: true, email: true } } },
    });
  }

  async findByUserId(userId: string) {
    return this.prisma.teachers.findUnique({
      where: { userId },
      include: {
        school: true,
        teacher_sections: { include: { class_sections: true } },
      },
    });
  }

  async getMySections(userId: string) {
    const teacher = await this.prisma.teachers.findUnique({
      where: { userId },
    });
    if (!teacher) throw new NotFoundException('Teacher profile not found');

    return this.prisma.teacher_sections.findMany({
      where: { teacherId: teacher.id },
      include: {
        class_sections: {
          include: {
            school: { select: { id: true, name: true } },
            _count: { select: { student_sections: true } },
          },
        },
      },
    });
  }
}
