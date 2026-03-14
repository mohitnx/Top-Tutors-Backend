import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Role } from '@prisma/client';
import {
  CreateClassSectionDto,
  UpdateClassSectionDto,
  AddStudentsDto,
  AssignTeacherDto,
} from './dto/class-section.dto';

@Injectable()
export class ClassSectionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateClassSectionDto, currentUser: { role: Role; administeredSchoolId?: string | null }) {
    // Auto-fill schoolId for ADMINISTRATOR from their own school
    let schoolId = dto.schoolId;
    if (currentUser.role === Role.ADMINISTRATOR) {
      if (!currentUser.administeredSchoolId) {
        throw new ForbiddenException('Administrator is not linked to a school');
      }
      if (schoolId && schoolId !== currentUser.administeredSchoolId) {
        throw new ForbiddenException('You can only create sections for your own school');
      }
      schoolId = currentUser.administeredSchoolId;
    }

    if (!schoolId) {
      throw new NotFoundException('schoolId is required');
    }

    const school = await this.prisma.school.findUnique({ where: { id: schoolId } });
    if (!school) throw new NotFoundException(`School ${schoolId} not found`);

    return this.prisma.class_sections.create({
      data: { name: dto.name, schoolId, grade: dto.grade },
    });
  }

  async findAll(currentUser: { role: Role; administeredSchoolId?: string | null }) {
    const where =
      currentUser.role === Role.ADMINISTRATOR && currentUser.administeredSchoolId
        ? { schoolId: currentUser.administeredSchoolId }
        : {};

    const sections = await this.prisma.class_sections.findMany({
      where,
      include: {
        school: { select: { id: true, name: true } },
        _count: { select: { student_sections: true, teacher_sections: true } },
      },
      orderBy: [{ grade: 'asc' }, { name: 'asc' }],
    });

    // Group sections by grade for frontend
    const grouped: Record<string, typeof sections> = {};
    for (const section of sections) {
      const grade = section.grade || 'Ungraded';
      if (!grouped[grade]) grouped[grade] = [];
      grouped[grade].push(section);
    }

    return { grades: grouped, total: sections.length };
  }

  async findOne(id: string, currentUser: { role: Role; administeredSchoolId?: string | null }) {
    const section = await this.prisma.class_sections.findUnique({
      where: { id },
      include: {
        school: true,
        student_sections: {
          include: {
            students: { include: { users: { select: { name: true, email: true } } } },
          },
        },
        teacher_sections: {
          include: {
            teachers: { include: { users: { select: { name: true, email: true } } } },
          },
        },
      },
    });
    if (!section) throw new NotFoundException(`Section ${id} not found`);

    if (
      currentUser.role === Role.ADMINISTRATOR &&
      section.schoolId !== currentUser.administeredSchoolId
    ) {
      throw new ForbiddenException('Access denied');
    }

    return section;
  }

  async update(id: string, dto: UpdateClassSectionDto) {
    const section = await this.prisma.class_sections.findUnique({ where: { id } });
    if (!section) throw new NotFoundException(`Section ${id} not found`);
    return this.prisma.class_sections.update({ where: { id }, data: dto });
  }

  async addStudents(id: string, dto: AddStudentsDto) {
    const section = await this.prisma.class_sections.findUnique({ where: { id } });
    if (!section) throw new NotFoundException(`Section ${id} not found`);

    // Check if any students are already assigned to a section
    const existing = await this.prisma.student_sections.findMany({
      where: { studentId: { in: dto.studentIds } },
      include: {
        class_sections: { select: { name: true, grade: true } },
        students: { include: { users: { select: { name: true } } } },
      },
    });

    if (existing.length > 0) {
      const conflicts = existing.map(
        (e) => `${e.students.users.name} is already in Grade ${e.class_sections.grade} - ${e.class_sections.name}`,
      );
      throw new ConflictException(
        `Students already assigned to a section. Remove them first: ${conflicts.join('; ')}`,
      );
    }

    await this.prisma.student_sections.createMany({
      data: dto.studentIds.map((studentId) => ({ studentId, sectionId: id })),
    });

    return { added: dto.studentIds.length };
  }

  async removeStudent(sectionId: string, studentId: string) {
    const existing = await this.prisma.student_sections.findUnique({
      where: { studentId_sectionId: { studentId, sectionId } },
    });
    if (!existing) throw new NotFoundException('Student is not in this section');

    await this.prisma.student_sections.delete({
      where: { studentId_sectionId: { studentId, sectionId } },
    });
    return { message: 'Student removed from section' };
  }

  async assignTeacher(id: string, dto: AssignTeacherDto) {
    const section = await this.prisma.class_sections.findUnique({ where: { id } });
    if (!section) throw new NotFoundException(`Section ${id} not found`);

    const teacher = await this.prisma.teachers.findUnique({ where: { id: dto.teacherId } });
    if (!teacher) throw new NotFoundException(`Teacher ${dto.teacherId} not found`);

    if (teacher.schoolId !== section.schoolId) {
      throw new ForbiddenException('Teacher and section must belong to the same school');
    }

    try {
      return await this.prisma.teacher_sections.create({
        data: { teacherId: dto.teacherId, sectionId: id, subject: dto.subject },
      });
    } catch {
      throw new ConflictException('Teacher is already assigned to this section for this subject');
    }
  }

  async getAvailableStudents(currentUser: { role: Role; administeredSchoolId?: string | null }) {
    const schoolId =
      currentUser.role === Role.ADMINISTRATOR ? currentUser.administeredSchoolId : undefined;

    // Students not assigned to any section
    const where: any = {
      student_sections: { none: {} },
    };
    if (schoolId) where.schoolId = schoolId;

    return this.prisma.students.findMany({
      where,
      include: { users: { select: { id: true, name: true, email: true } } },
      orderBy: { users: { name: 'asc' } },
    });
  }

  async getSchoolTeachers(currentUser: { role: Role; administeredSchoolId?: string | null }) {
    if (currentUser.role === Role.ADMINISTRATOR && !currentUser.administeredSchoolId) {
      throw new ForbiddenException('Administrator is not linked to a school');
    }

    const where: any = {};
    if (currentUser.role === Role.ADMINISTRATOR) {
      where.schoolId = currentUser.administeredSchoolId;
    }

    return this.prisma.teachers.findMany({
      where,
      include: {
        users: { select: { id: true, name: true, email: true } },
        teacher_sections: {
          include: { class_sections: { select: { id: true, name: true, grade: true } } },
        },
      },
      orderBy: { users: { name: 'asc' } },
    });
  }

  async removeTeacher(sectionId: string, teacherId: string) {
    const existing = await this.prisma.teacher_sections.findFirst({
      where: { teacherId, sectionId },
    });
    if (!existing) throw new NotFoundException('Teacher is not assigned to this section');

    await this.prisma.teacher_sections.delete({ where: { id: existing.id } });
    return { message: 'Teacher removed from section' };
  }
}
