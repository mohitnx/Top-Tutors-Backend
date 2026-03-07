import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, MaxLength, Matches } from 'class-validator';

export class CreateSchoolDto {
  @ApiProperty({ example: 'Springfield High School' })
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiProperty({ example: 'SPH-2024', description: 'Short unique school code' })
  @IsString()
  @MaxLength(20)
  @Matches(/^[A-Z0-9-]+$/, { message: 'Code must be uppercase letters, digits and hyphens only' })
  code: string;

  @ApiPropertyOptional({ example: '123 Main Street' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 'Springfield' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'US' })
  @IsOptional()
  @IsString()
  country?: string;
}

export class UpdateSchoolDto {
  @ApiPropertyOptional({ example: 'Springfield High School' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ example: '123 Main Street' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 'Springfield' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'US' })
  @IsOptional()
  @IsString()
  country?: string;
}
