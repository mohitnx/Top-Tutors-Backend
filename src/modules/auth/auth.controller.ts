import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Get,
  Param,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto, RefreshTokenDto, AcceptInvitationDto } from './dto/auth-response.dto';
import { Public } from './decorators/public.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  login(@Body() loginDto: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(loginDto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid refresh token' })
  refresh(@Body() dto: RefreshTokenDto): Promise<AuthResponseDto> {
    return this.authService.refreshToken(dto.refreshToken);
  }

  @Public()
  @Get('verify-invitation/:token')
  @ApiOperation({ summary: 'Verify invitation token (frontend prefill)' })
  @ApiResponse({ status: 200, description: 'Token is valid, returns name/email/role' })
  @ApiResponse({ status: 404, description: 'Invalid token' })
  @ApiResponse({ status: 400, description: 'Token expired' })
  verifyInvitation(@Param('token') token: string) {
    return this.authService.verifyInvitationToken(token);
  }

  @Public()
  @Post('accept-invitation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept invitation and set password — logs user in immediately' })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  @ApiResponse({ status: 404, description: 'Invalid token' })
  @ApiResponse({ status: 400, description: 'Token expired or weak password' })
  acceptInvitation(@Body() dto: AcceptInvitationDto): Promise<AuthResponseDto> {
    return this.authService.acceptInvitation(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user full profile' })
  getProfile(@CurrentUser() user: any) {
    return this.authService.getFullProfile(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user full profile (alias)' })
  getMe(@CurrentUser() user: any) {
    return this.authService.getFullProfile(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout (client should discard tokens)' })
  logout() {
    return { message: 'Successfully logged out' };
  }
}
