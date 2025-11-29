import { ApiProperty } from '@nestjs/swagger';

export class HealthCheckDto {
  @ApiProperty({ example: 'ok', description: 'Health status' })
  status: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z', description: 'Current timestamp' })
  timestamp: string;

  @ApiProperty({ example: 123.456, description: 'Application uptime in seconds' })
  uptime: number;

  @ApiProperty({ example: 'development', description: 'Current environment' })
  environment: string;

  @ApiProperty({ example: '1.0.0', description: 'Application version' })
  version: string;
}

