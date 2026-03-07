import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UserResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ example: 'john@example.com' })
  email: string;

  @ApiProperty({ example: 'John Doe' })
  name: string;

  @ApiProperty({ example: 'STUDENT', enum: ['ADMIN', 'ADMINISTRATOR', 'TUTOR', 'STUDENT'] })
  role: string;

  @ApiProperty({ example: false, description: 'false until invitation is accepted' })
  isActive: boolean;

  @ApiPropertyOptional({ example: 'uuid-of-school' })
  schoolId?: string | null;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  updatedAt: Date;
}

