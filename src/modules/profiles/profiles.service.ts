import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateStudentProfileDto,
  UpdateStudentProfileDto,
  CreateTutorProfileDto,
  UpdateTutorProfileDto,
} from './dto';

@Injectable()
export class ProfilesService {
  private readonly logger = new Logger(ProfilesService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ============ Student Profile Methods ============

  /**
   * Get student profile by user ID
   */
  async getStudentProfile(userId: string) {
    const student = await (this.prisma as any).students.findUnique({
      where: { userId },
      include: {
        users: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
    });

    if (!student) {
      throw new NotFoundException('Student profile not found');
    }

    return this.formatStudentProfile(student);
  }

  /**
   * Get student profile by profile ID
   */
  async getStudentProfileById(profileId: string) {
    const student = await (this.prisma as any).students.findUnique({
      where: { id: profileId },
      include: {
        users: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
    });

    if (!student) {
      throw new NotFoundException('Student profile not found');
    }

    return this.formatStudentProfile(student);
  }

  /**
   * Update student profile
   */
  async updateStudentProfile(userId: string, dto: UpdateStudentProfileDto) {
    // Check if profile exists
    const existingProfile = await (this.prisma as any).students.findUnique({
      where: { userId },
    });

    if (!existingProfile) {
      throw new NotFoundException('Student profile not found');
    }

    // Calculate profile completion
    const profileCompleted = this.isStudentProfileComplete({
      ...existingProfile,
      ...dto,
    });

    const updatedProfile = await (this.prisma as any).students.update({
      where: { userId },
      data: {
        ...dto,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        profileCompleted,
        updatedAt: new Date(),
      },
      include: {
        users: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
    });

    this.logger.log(`Updated student profile for user ${userId}`);
    return this.formatStudentProfile(updatedProfile);
  }

  /**
   * Check if student profile has required fields
   */
  private isStudentProfileComplete(profile: any): boolean {
    const requiredFields = ['grade', 'school', 'phoneNumber'];
    return requiredFields.every((field) => profile[field] && profile[field].trim() !== '');
  }

  /**
   * Format student profile response
   */
  private formatStudentProfile(student: any) {
    return {
      id: student.id,
      userId: student.userId,
      name: student.users?.name,
      email: student.users?.email,
      avatar: student.users?.avatar,
      grade: student.grade,
      school: student.school,
      phoneNumber: student.phoneNumber,
      dateOfBirth: student.dateOfBirth,
      parentName: student.parentName,
      parentEmail: student.parentEmail,
      parentPhone: student.parentPhone,
      address: student.address,
      city: student.city,
      state: student.state,
      country: student.country,
      timezone: student.timezone,
      preferredSubjects: student.preferredSubjects,
      learningGoals: student.learningGoals,
      academicLevel: student.academicLevel,
      profileCompleted: student.profileCompleted,
      createdAt: student.createdAt,
      updatedAt: student.updatedAt,
    };
  }

  // ============ Tutor Profile Methods ============

  /**
   * Get tutor profile by user ID
   */
  async getTutorProfile(userId: string) {
    const tutor = await (this.prisma as any).tutors.findUnique({
      where: { userId },
      include: {
        users: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
    });

    if (!tutor) {
      throw new NotFoundException('Tutor profile not found');
    }

    return this.formatTutorProfile(tutor);
  }

  /**
   * Get tutor profile by profile ID (public - for students viewing tutors)
   */
  async getTutorProfileById(profileId: string) {
    const tutor = await (this.prisma as any).tutors.findUnique({
      where: { id: profileId },
      include: {
        users: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
    });

    if (!tutor) {
      throw new NotFoundException('Tutor profile not found');
    }

    return this.formatTutorProfile(tutor, true); // isPublic = true
  }

  /**
   * Get all verified tutors (public listing)
   */
  async getVerifiedTutors(filters?: {
    subjects?: string[];
    minRating?: number;
    maxHourlyRate?: number;
    page?: number;
    limit?: number;
  }) {
    const { subjects, minRating, maxHourlyRate, page = 1, limit = 20 } = filters || {};
    const skip = (page - 1) * limit;

    const whereClause: any = {
      isVerified: true,
      isAvailable: true,
    };

    if (subjects && subjects.length > 0) {
      whereClause.subjects = {
        hasSome: subjects,
      };
    }

    if (minRating) {
      whereClause.rating = {
        gte: minRating,
      };
    }

    if (maxHourlyRate) {
      whereClause.hourlyRate = {
        lte: maxHourlyRate,
      };
    }

    const [tutors, total] = await Promise.all([
      (this.prisma as any).tutors.findMany({
        where: whereClause,
        include: {
          users: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true,
            },
          },
        },
        orderBy: [{ rating: 'desc' }, { totalSessionsCompleted: 'desc' }],
        skip,
        take: limit,
      }),
      (this.prisma as any).tutors.count({ where: whereClause }),
    ]);

    return {
      data: tutors.map((t: any) => this.formatTutorProfile(t, true)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Update tutor profile
   */
  async updateTutorProfile(userId: string, dto: UpdateTutorProfileDto) {
    // Check if profile exists
    const existingProfile = await (this.prisma as any).tutors.findUnique({
      where: { userId },
    });

    if (!existingProfile) {
      throw new NotFoundException('Tutor profile not found');
    }

    // Calculate profile completion
    const profileCompleted = this.isTutorProfileComplete({
      ...existingProfile,
      ...dto,
    });

    const updateData: any = {
      ...dto,
      dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
      profileCompleted,
      updatedAt: new Date(),
    };

    // Handle JSON fields
    if (dto.academicQualifications !== undefined) {
      updateData.academicQualifications = dto.academicQualifications;
    }
    if (dto.certificates !== undefined) {
      updateData.certificates = dto.certificates;
    }
    if (dto.workExperience !== undefined) {
      updateData.workExperience = dto.workExperience;
    }
    if (dto.availabilitySchedule !== undefined) {
      updateData.availabilitySchedule = dto.availabilitySchedule;
    }

    const updatedProfile = await (this.prisma as any).tutors.update({
      where: { userId },
      data: updateData,
      include: {
        users: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
    });

    this.logger.log(`Updated tutor profile for user ${userId}`);
    return this.formatTutorProfile(updatedProfile);
  }

  /**
   * Add a certificate to tutor profile
   */
  async addCertificate(
    userId: string,
    certificate: {
      name: string;
      issuedBy: string;
      issuedDate?: string;
      expiryDate?: string;
      url?: string;
    },
  ) {
    const tutor = await (this.prisma as any).tutors.findUnique({
      where: { userId },
    });

    if (!tutor) {
      throw new NotFoundException('Tutor profile not found');
    }

    const currentCertificates = (tutor.certificates as any[]) || [];
    const newCertificate = {
      ...certificate,
      id: `cert_${Date.now()}`,
      verified: false,
      addedAt: new Date().toISOString(),
    };

    const updatedProfile = await (this.prisma as any).tutors.update({
      where: { userId },
      data: {
        certificates: [...currentCertificates, newCertificate],
        updatedAt: new Date(),
      },
      include: {
        users: {
          select: { name: true, email: true, avatar: true },
        },
      },
    });

    return this.formatTutorProfile(updatedProfile);
  }

  /**
   * Remove a certificate from tutor profile
   */
  async removeCertificate(userId: string, certificateId: string) {
    const tutor = await (this.prisma as any).tutors.findUnique({
      where: { userId },
    });

    if (!tutor) {
      throw new NotFoundException('Tutor profile not found');
    }

    const currentCertificates = (tutor.certificates as any[]) || [];
    const updatedCertificates = currentCertificates.filter(
      (cert: any) => cert.id !== certificateId,
    );

    if (currentCertificates.length === updatedCertificates.length) {
      throw new NotFoundException('Certificate not found');
    }

    const updatedProfile = await (this.prisma as any).tutors.update({
      where: { userId },
      data: {
        certificates: updatedCertificates,
        updatedAt: new Date(),
      },
      include: {
        users: {
          select: { name: true, email: true, avatar: true },
        },
      },
    });

    return this.formatTutorProfile(updatedProfile);
  }

  /**
   * Check if tutor profile has required fields
   */
  private isTutorProfileComplete(profile: any): boolean {
    const requiredFields = ['bio', 'qualification', 'experience'];
    const hasRequiredFields = requiredFields.every(
      (field) => profile[field] !== null && profile[field] !== undefined && profile[field] !== '',
    );
    const hasSubjects = profile.subjects && profile.subjects.length > 0;

    return hasRequiredFields && hasSubjects;
  }

  /**
   * Format tutor profile response
   */
  private formatTutorProfile(tutor: any, isPublic = false) {
    const baseProfile = {
      id: tutor.id,
      userId: tutor.userId,
      name: tutor.users?.name,
      email: tutor.users?.email,
      avatar: tutor.users?.avatar,
      bio: tutor.bio,
      phoneNumber: isPublic ? undefined : tutor.phoneNumber,
      dateOfBirth: isPublic ? undefined : tutor.dateOfBirth,
      address: isPublic ? undefined : tutor.address,
      city: tutor.city,
      state: tutor.state,
      country: tutor.country,
      timezone: tutor.timezone,
      qualification: tutor.qualification,
      academicQualifications: tutor.academicQualifications,
      experience: tutor.experience,
      hourlyRate: tutor.hourlyRate,
      subjects: tutor.subjects,
      areasOfExpertise: tutor.areasOfExpertise,
      teachingPhilosophy: tutor.teachingPhilosophy,
      teachingStyle: tutor.teachingStyle,
      certificates: tutor.certificates,
      workExperience: tutor.workExperience,
      researchExperience: tutor.researchExperience,
      publications: tutor.publications,
      linkedinUrl: tutor.linkedinUrl,
      websiteUrl: tutor.websiteUrl,
      languages: tutor.languages,
      isAvailable: tutor.isAvailable,
      isBusy: tutor.isBusy,
      availabilitySchedule: tutor.availabilitySchedule,
      rating: tutor.rating,
      totalReviews: tutor.totalReviews,
      totalStudentsTaught: tutor.totalStudentsTaught,
      totalSessionsCompleted: tutor.totalSessionsCompleted,
      totalHoursTaught: tutor.totalHoursTaught,
      isVerified: tutor.isVerified,
      verifiedAt: tutor.verifiedAt,
      profileCompleted: tutor.profileCompleted,
      createdAt: tutor.createdAt,
      updatedAt: tutor.updatedAt,
    };

    // Hide sensitive info for public profiles
    if (isPublic) {
      return {
        ...baseProfile,
        bankAccountNumber: undefined,
        bankName: undefined,
        bankRoutingNumber: undefined,
      };
    }

    return {
      ...baseProfile,
      bankAccountNumber: tutor.bankAccountNumber,
      bankName: tutor.bankName,
      bankRoutingNumber: tutor.bankRoutingNumber,
    };
  }

  // ============ Avatar Update ============

  /**
   * Update user avatar (for both students and tutors)
   */
  async updateAvatar(userId: string, avatarUrl: string) {
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { avatar: avatarUrl },
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
      },
    });

    this.logger.log(`Updated avatar for user ${userId}`);
    return updatedUser;
  }

  /**
   * Update user name
   */
  async updateUserName(userId: string, name: string) {
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { name },
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
      },
    });

    this.logger.log(`Updated name for user ${userId}`);
    return updatedUser;
  }
}








