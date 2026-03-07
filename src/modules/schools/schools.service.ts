import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSchoolDto, UpdateSchoolDto } from './dto/school.dto';
import { Role } from '@prisma/client';

@Injectable()
export class SchoolsService {
  private readonly logger = new Logger(SchoolsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateSchoolDto) {
    const existing = await this.prisma.school.findUnique({ where: { code: dto.code } });
    if (existing) throw new ConflictException(`School code "${dto.code}" is already taken`);

    const school = await this.prisma.school.create({ data: dto });
    this.logger.log(`School created: ${school.id} (${school.code})`);
    return school;
  }

  async findAll() {
    return this.prisma.school.findMany({
      orderBy: { name: 'asc' },
      include: {
        administrator: { select: { id: true, name: true, email: true } },
        _count: { select: { students: true } },
      },
    });
  }

  async findOne(id: string) {
    const school = await this.prisma.school.findUnique({
      where: { id },
      include: {
        administrator: { select: { id: true, name: true, email: true } },
        _count: { select: { students: true } },
      },
    });
    if (!school) throw new NotFoundException(`School ${id} not found`);
    return school;
  }

  async update(id: string, dto: UpdateSchoolDto) {
    await this.findOne(id);
    return this.prisma.school.update({ where: { id }, data: dto });
  }

  async listStudents(schoolId: string, requestingUser: { role: Role; administeredSchoolId?: string | null }) {
    // Admins can see any school's students; Administrators can only see their own school
    if (
      requestingUser.role === Role.ADMINISTRATOR &&
      requestingUser.administeredSchoolId !== schoolId
    ) {
      throw new ForbiddenException('You can only view students of your own school');
    }

    await this.findOne(schoolId); // 404 if not found

    const students = await this.prisma.students.findMany({
      where: { schoolId },
      include: {
        users: { select: { id: true, name: true, email: true, isActive: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return students.map((s) => ({
      id: s.id,
      userId: s.userId,
      name: s.users.name,
      email: s.users.email,
      isActive: s.users.isActive,
      grade: s.grade,
      profileCompleted: s.profileCompleted,
    }));
  }
}
