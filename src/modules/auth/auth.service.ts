import { Injectable, UnauthorizedException, ConflictException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto';
import { RegisterBaseDto, RegisterUserDto } from './dto';
import { Role } from '@prisma/client';
import { AuthResponseDto, TokensDto } from './dto/auth-response.dto';
import { JwtPayload } from './strategies/jwt.strategy';
import { GoogleUser } from './strategies/google.strategy';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(registerDto: RegisterUserDto): Promise<AuthResponseDto> {
    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: registerDto.email },
    });

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(registerDto.password, 10);

    // Determine the role, default to STUDENT if not provided
    const userRole = registerDto.role || Role.STUDENT;

    // Create user and profile in a transaction
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: registerDto.email,
          name: registerDto.name,
          password: hashedPassword,
          role: userRole,
        },
      });

      if (userRole === Role.STUDENT) {
        await (tx as any).students.create({
          data: {
            id: uuidv4(),
            userId: user.id,
            grade: registerDto.grade || null,
            school: registerDto.school || null,
            phoneNumber: registerDto.phoneNumber || null,
            updatedAt: new Date(),
          },
        });
      } else if (userRole === Role.TUTOR) {
        await (tx as any).tutors.create({
          data: {
            id: uuidv4(),
            userId: user.id,
            updatedAt: new Date(),
            // Add other default tutor fields if necessary
          },
        });
      }
      return user;
    });

    // Generate tokens
    const tokens = await this.generateTokens(result.id, result.email, result.role);

    return {
      user: {
        id: result.id,
        email: result.email,
        name: result.name,
        role: result.role,
        avatar: (result as any).avatar || null,
        authProvider: (result as any).authProvider || 'LOCAL',
      },
      tokens,
    };
  }

  async login(loginDto: LoginDto): Promise<AuthResponseDto> {
    // Find user
    const user = await this.prisma.user.findUnique({
      where: { email: loginDto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if user has a password (not a Google OAuth user)
    if (!user.password) {
      throw new UnauthorizedException('Please use Google login for this account');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is inactive');
    }

    // Generate tokens
    const tokens = await this.generateTokens(user.id, user.email, user.role);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        avatar: (user as any).avatar || null,
        authProvider: (user as any).authProvider || 'LOCAL',
      },
      tokens,
    };
  }

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (user && user.password && (await bcrypt.compare(password, user.password))) {
      const { password: _, ...result } = user;
      return result;
    }
    return null;
  }

  private async generateTokens(userId: string, email: string, role: string): Promise<TokensDto> {
    const payload: JwtPayload = {
      sub: userId,
      email,
      role,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload),
      this.jwtService.signAsync(payload, { expiresIn: '30d' }),
    ]);

    return {
      accessToken,
      refreshToken,
    };
  }

  async refreshToken(refreshToken: string): Promise<AuthResponseDto> {
    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken);

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user || !user.isActive) {
        throw new UnauthorizedException('User not found or inactive');
      }

      const tokens = await this.generateTokens(user.id, user.email, user.role);

      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          avatar: (user as any).avatar || null,
          authProvider: (user as any).authProvider || 'LOCAL',
        },
        tokens,
      };
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async googleLogin(googleUser: GoogleUser): Promise<AuthResponseDto> {
    // Try to find user by googleId first, then by email
    let user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { googleId: googleUser.googleId } as any,
          { email: googleUser.email },
        ],
      },
    });

    // If user doesn't exist, create a new one with student profile
    if (!user) {
      const result = await this.prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            email: googleUser.email,
            name: googleUser.name,
            password: null as any, // Google OAuth users don't need password
            googleId: googleUser.googleId,
            avatar: googleUser.avatar,
            authProvider: 'GOOGLE',
            role: 'STUDENT',
          } as any,
        });

        // Create student profile for new Google users
        await (tx as any).students.create({
          data: {
            id: uuidv4(),
            userId: newUser.id,
            updatedAt: new Date(),
          },
        });

        return newUser;
      });
      user = result;
    } else {
      // Update existing user with Google info if missing
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          googleId: (user as any).googleId || googleUser.googleId,
          avatar: googleUser.avatar || (user as any).avatar,
          authProvider: 'GOOGLE',
          name: user.name || googleUser.name,
        } as any,
      });

      // Ensure student profile exists for existing users
      const existingStudent = await (this.prisma as any).students.findUnique({
        where: { userId: user.id },
      });

      if (!existingStudent && user.role === 'STUDENT') {
        await (this.prisma as any).students.create({
          data: {
            id: uuidv4(),
            userId: user.id,
            updatedAt: new Date(),
          },
        });
      }
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is inactive');
    }

    // Generate tokens
    const tokens = await this.generateTokens(user.id, user.email, user.role);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        avatar: (user as any).avatar,
        authProvider: 'GOOGLE',
      },
      tokens,
    };
  }

  async getFullProfile(userId: string) {
    const user: any = await (this.prisma as any).user.findUnique({
      where: { id: userId },
      include: {
        students: true,
        tutors: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const userAny = user as any;

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      avatar: userAny.avatar,
      authProvider: userAny.authProvider,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      // Include role-specific profile data
      ...(userAny.students && {
        studentProfile: {
          id: userAny.students.id,
          grade: userAny.students.grade,
          school: userAny.students.school,
          phoneNumber: userAny.students.phoneNumber,
          dateOfBirth: userAny.students.dateOfBirth,
        },
      }),
      ...(userAny.tutors && {
        tutorProfile: {
          id: userAny.tutors.id,
          bio: userAny.tutors.bio,
          qualification: userAny.tutors.qualification,
          experience: userAny.tutors.experience,
          hourlyRate: userAny.tutors.hourlyRate,
          isVerified: userAny.tutors.isVerified,
          isAvailable: userAny.tutors.isAvailable,
          rating: userAny.tutors.rating,
          subjects: userAny.tutors.subjects,
        },
      }),
    };
  }
}
