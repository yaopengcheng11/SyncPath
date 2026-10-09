import {
  Body,
  Controller,
  HttpCode,
  Post
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../identity/current-user.decorator';
import type { User } from '@prisma/client';
import { ImportsService } from './imports.service';
import type {
  ImportSummary,
  LegacyImportBody
} from './dto';

@ApiTags('imports')
@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Post('validate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Pre-flight check for a legacy JSON import. Never writes.'
  })
  async validate(
    @CurrentUser() user: User,
    @Body() body: LegacyImportBody
  ): Promise<{ projects: number; entries: number; warnings: string[] }> {
    return this.imports.validate(user, body);
  }

  @Post('apply')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Apply a legacy JSON import (requires accept: true).'
  })
  async apply(
    @CurrentUser() user: User,
    @Body() body: LegacyImportBody
  ): Promise<ImportSummary> {
    return this.imports.apply(user, body);
  }
}
