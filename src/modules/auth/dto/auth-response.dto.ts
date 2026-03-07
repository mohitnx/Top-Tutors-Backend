import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MinLength, Matches } from 'class-validator';

export class TokensDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  accessToken: string;

  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  refreshToken: string;
}

export class UserInfoDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ example: 'john@example.com' })
  email: string;

  @ApiProperty({ example: 'John Doe' })
  name: string;

  @ApiProperty({ example: 'STUDENT', enum: ['ADMIN', 'ADMINISTRATOR', 'TEACHER', 'TUTOR', 'STUDENT'] })
  role: string;

  @ApiPropertyOptional({ example: 'https://example.com/avatar.jpg' })
  avatar: string | null;

  @ApiPropertyOptional({
    example: 'uuid-of-school',
    description: 'Present only for school-affiliated students — gates SAP feature on frontend',
  })
  schoolId?: string | null;
}

export class AuthResponseDto {
  @ApiProperty({ type: UserInfoDto })
  user: UserInfoDto;

  @ApiProperty({ type: TokensDto })
  tokens: TokensDto;
}

export class RefreshTokenDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  refreshToken: string;
}

export class AcceptInvitationDto {
  @ApiProperty({ description: 'Invitation token from the email link' })
  @IsString()
  token: string;

  @ApiProperty({
    description: 'New password (min 8 chars, must include upper, lower, number, special char)',
    example: 'MyPass@123',
  })
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/, {
    message: 'Password must contain uppercase, lowercase, number and special character',
  })
  password: string;
}
