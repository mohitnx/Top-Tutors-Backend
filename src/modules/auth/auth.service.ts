import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto';
import { Role } from '@prisma/client';
import { AuthResponseDto, TokensDto, AcceptInvitationDto } from './dto/auth-response.dto';
import { JwtPayload } from './strategies/jwt.strategy';
import { GoogleUser } from './strategies/google.strategy';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  private normalizeEmail(email: string): string {
    return email?.trim().toLowerCase();
  }

  async login(loginDto: LoginDto): Promise<AuthResponseDto> {
    const normalizedEmail = this.normalizeEmail(loginDto.email);

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: { students: true },
    });

    if (!user || !user.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      // Distinguish between "never accepted invite" and "deactivated"
      if (user.invitationToken) {
        throw new UnauthorizedException(
          'Please accept your invitation first. Check your email for the invitation link.',
        );
      }
      throw new UnauthorizedException('Account is inactive');
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const schoolId = user.students?.schoolId ?? null;
    const tokens = await this.generateTokens(user.id, user.email, user.role, schoolId);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        avatar: user.avatar ?? null,
        schoolId,
      },
      tokens,
    };
  }

  async verifyInvitationToken(token: string): Promise<{ valid: boolean; email: string; name: string; role: Role }> {
    const user = await this.prisma.user.findUnique({
      where: { invitationToken: token },
    });

    if (!user) {
      throw new NotFoundException('Invalid invitation token');
    }

    if (user.invitationExpiresAt && user.invitationExpiresAt < new Date()) {
      throw new BadRequestException('Invitation token has expired');
    }

    return { valid: true, email: user.email, name: user.name, role: user.role };
  }

  async acceptInvitation(dto: AcceptInvitationDto): Promise<AuthResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { invitationToken: dto.token },
      include: { students: true },
    });

    if (!user) {
      throw new NotFoundException('Invalid invitation token');
    }

    if (user.invitationExpiresAt && user.invitationExpiresAt < new Date()) {
      throw new BadRequestException('Invitation token has expired. Please ask an admin to resend it.');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        isActive: true,
        invitationToken: null,
        invitationExpiresAt: null,
      },
      include: { students: true },
    });

    const schoolId = updated.students?.schoolId ?? null;
    const tokens = await this.generateTokens(updated.id, updated.email, updated.role, schoolId);

    return {
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        role: updated.role,
        avatar: updated.avatar ?? null,
        schoolId,
      },
      tokens,
    };
  }

  async refreshToken(refreshToken: string): Promise<AuthResponseDto> {
    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken);

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        include: { students: true },
      });

      if (!user || !user.isActive) {
        throw new UnauthorizedException('User not found or inactive');
      }

      const schoolId = user.students?.schoolId ?? null;
      const tokens = await this.generateTokens(user.id, user.email, user.role, schoolId);

      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          avatar: user.avatar ?? null,
          schoolId,
        },
        tokens,
      };
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async getFullProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        students: { include: { school_rel: true } },
        tutors: true,
        administeredSchool: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      avatar: user.avatar,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      ...(user.students && {
        studentProfile: {
          id: user.students.id,
          grade: user.students.grade,
          phoneNumber: user.students.phoneNumber,
          dateOfBirth: user.students.dateOfBirth,
          schoolId: user.students.schoolId,
          school: user.students.school_rel
            ? { id: user.students.school_rel.id, name: user.students.school_rel.name }
            : null,
        },
      }),
      ...(user.tutors && {
        tutorProfile: {
          id: user.tutors.id,
          bio: user.tutors.bio,
          qualification: user.tutors.qualification,
          experience: user.tutors.experience,
          hourlyRate: user.tutors.hourlyRate,
          isVerified: user.tutors.isVerified,
          isAvailable: user.tutors.isAvailable,
          rating: user.tutors.rating,
          subjects: user.tutors.subjects,
        },
      }),
      ...(user.administeredSchool && {
        administeredSchool: {
          id: user.administeredSchool.id,
          name: user.administeredSchool.name,
          code: user.administeredSchool.code,
        },
      }),
    };
  }

  async googleLogin(googleUser: GoogleUser): Promise<AuthResponseDto> {
    const normalizedEmail = this.normalizeEmail(googleUser.email);

    // Find existing user by googleId or email
    let user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { googleId: googleUser.googleId },
          { email: normalizedEmail },
        ],
      },
      include: { students: true },
    });

    if (user) {
      // Link googleId if not set, activate if needed
      if (!user.googleId || !user.isActive) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: {
            googleId: googleUser.googleId,
            isActive: true,
            avatar: user.avatar || googleUser.avatar,
            invitationToken: null,
            invitationExpiresAt: null,
          },
          include: { students: true },
        });
      }
    } else {
      // Create new STUDENT user (no school affiliation)
      const newUser = await this.prisma.user.create({
        data: {
          email: normalizedEmail,
          name: googleUser.name || normalizedEmail.split('@')[0],
          googleId: googleUser.googleId,
          role: Role.STUDENT,
          isActive: true,
          avatar: googleUser.avatar,
        },
      });

      // Create student profile (no school affiliation)
      await this.prisma.students.create({
        data: {
          id: uuidv4(),
          userId: newUser.id,
          updatedAt: new Date(),
        },
      });

      // Auto-create SAP project for new Google users (demo streamlining)
      await this.prisma.projects.create({
        data: {
          userId: newUser.id,
          title: 'SAP',
          description: 'School Assessment & Performance — Upload question images to generate professional reports.',
          aiTemperature: 0.5,
        },
      });

      user = await this.prisma.user.findUnique({
        where: { id: newUser.id },
        include: { students: true },
      });
    }

    // Ensure SAP project exists for all Google users (idempotent)
    const existingSap = await this.prisma.projects.findFirst({
      where: { userId: user!.id, title: 'SAP' },
    });
    if (!existingSap) {
      await this.prisma.projects.create({
        data: {
          userId: user!.id,
          title: 'SAP',
          description: 'School Assessment & Performance — Upload question images to generate professional reports.',
          aiTemperature: 0.5,
        },
      });
    }

    const schoolId = user!.students?.schoolId ?? null;
    const tokens = await this.generateTokens(user!.id, user!.email, user!.role, schoolId);

    return {
      user: {
        id: user!.id,
        email: user!.email,
        name: user!.name,
        role: user!.role,
        avatar: user!.avatar ?? null,
        schoolId,
      },
      tokens,
    };
  }

  private async generateTokens(
    userId: string,
    email: string,
    role: Role,
    schoolId: string | null,
  ): Promise<TokensDto> {
    const payload: JwtPayload = {
      sub: userId,
      email,
      role,
      ...(schoolId && { schoolId }),
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload),
      this.jwtService.signAsync(payload, { expiresIn: '30d' }),
    ]);

    return { accessToken, refreshToken };
  }
}
