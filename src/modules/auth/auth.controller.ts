import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards, Get, Req, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { LoginDto, RegisterBaseDto, RegisterUserDto } from './dto';
import { AuthResponseDto, RefreshTokenDto } from './dto/auth-response.dto';
import { Public } from './decorators/public.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { Response } from 'express';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Post('register/student')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new student' })
  @ApiResponse({
    status: 201,
    description: 'User successfully registered',
    type: AuthResponseDto,
  })
  @ApiResponse({ status: 409, description: 'User already exists' })
  async registerStudent(@Body() registerDto: RegisterUserDto): Promise<AuthResponseDto> {
    return this.authService.register(registerDto);
  }

  // Keep legacy endpoint for backwards compatibility
  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new student (legacy)' })
  @ApiResponse({
    status: 201,
    description: 'User successfully registered',
    type: AuthResponseDto,
  })
  @ApiResponse({ status: 409, description: 'User already exists' })
  async register(@Body() registerDto: RegisterUserDto): Promise<AuthResponseDto> {
    return this.authService.register(registerDto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({
    status: 200,
    description: 'User successfully logged in',
    type: AuthResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() loginDto: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(loginDto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({
    status: 200,
    description: 'Token successfully refreshed',
    type: AuthResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid refresh token' })
  async refresh(@Body() refreshTokenDto: RefreshTokenDto): Promise<AuthResponseDto> {
    return this.authService.refreshToken(refreshTokenDto.refreshToken);
  }

  @Public()
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Initiate Google OAuth login' })
  @ApiResponse({ status: 302, description: 'Redirects to Google OAuth' })
  async googleAuth() {
    // Guard redirects to Google
  }

  @Public()
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Google OAuth callback' })
  @ApiResponse({ status: 200, description: 'Google authentication successful' })
  @ApiResponse({ status: 401, description: 'Google authentication failed' })
  async googleAuthCallback(@Req() req: any, @Res() res: Response) {
    try {
      const googleUser = req.user;
      
      if (!googleUser) {
        throw new Error('Google user not found');
      }
      
      const authResponse = await this.authService.googleLogin(googleUser);
      
      // Redirect to frontend with tokens in query params (URL encode tokens)
      const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:5173');
      const token = encodeURIComponent(authResponse.tokens.accessToken);
      const refreshToken = encodeURIComponent(authResponse.tokens.refreshToken);
      // Send both token/accessToken to satisfy different frontend expectations
      const redirectUrl = `${frontendUrl}/auth/callback?token=${token}&accessToken=${token}&refreshToken=${refreshToken}`;
      
      res.redirect(redirectUrl);
    } catch (error) {
      // If error, redirect to frontend with error message
      const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:5173');
      const errorMessage = encodeURIComponent(error.message || 'Authentication failed');
      res.redirect(`${frontendUrl}/auth/callback?error=${errorMessage}`);
    }
  }

  // Main profile endpoint as per API docs
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'Current user profile' })
  async getProfile(@CurrentUser() user: any) {
    return this.authService.getFullProfile(user.id);
  }

  // Keep legacy /me endpoint for backwards compatibility
  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile (legacy)' })
  @ApiResponse({ status: 200, description: 'Current user profile' })
  async getMe(@CurrentUser() user: any) {
    return this.authService.getFullProfile(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout user' })
  @ApiResponse({ status: 200, description: 'Successfully logged out' })
  async logout(@CurrentUser() user: any) {
    // For JWT-based auth, logout is typically handled client-side by removing tokens
    // Server-side we can invalidate refresh tokens if stored
    return { message: 'Successfully logged out' };
  }
}
