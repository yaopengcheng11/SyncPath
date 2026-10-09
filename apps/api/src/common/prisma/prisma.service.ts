import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma service wrapped for NestJS lifecycle hooks.
 *
 * Notes on tenancy:
 *   Per docs §7.1 we use a dedicated application role that does NOT have
 *   BYPASSRLS; RLS is the second layer after the application-level checks.
 *   When row-level policies are added in a later iteration, set the
 *   workspace_id via `SET LOCAL` inside the same transaction as the
 *   application code, NOT via connection-string params.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: ['warn', 'error']
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('Prisma connected to PostgreSQL');
    } catch (err) {
      this.logger.error('Prisma failed to connect', err as Error);
      throw err;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
