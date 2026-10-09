import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Public } from '../identity/public.decorator';

interface HealthReport {
  status: 'ok' | 'degraded';
  uptime: number;
  database: 'up' | 'down';
  version: string;
  timestamp: string;
}

const STARTED_AT = Date.now();

@Public()
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({
    summary: 'Liveness + database ping',
    description: 'Returns service uptime and database connectivity status.'
  })
  async check(): Promise<HealthReport> {
    let database: 'up' | 'down' = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'up';
    } catch {
      database = 'down';
    }
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      uptime: Math.floor((Date.now() - STARTED_AT) / 1000),
      database,
      version: process.env.npm_package_version ?? '0.0.0',
      timestamp: new Date().toISOString()
    };
  }
}
