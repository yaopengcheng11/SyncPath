import { ApiProperty } from '@nestjs/swagger';
import type { ProgressEntry } from '@prisma/client';

export type ProgressLevel = 'primary' | 'secondary' | 'minor';
export type ProgressStatus = 'pending' | 'completed';

export class CreateEntryBody {
  @ApiProperty({
    example: '2026-01-12',
    description: 'YYYY-MM-DD; the server normalises to Monday-aligned week start.'
  })
  weekStartDate!: string;

  @ApiProperty({
    example: 'Spec draft',
    description: 'Legacy terminology: WorkLog.author stored the *title*.'
  })
  title!: string;

  @ApiProperty({ enum: ['primary', 'secondary', 'minor'] })
  level!: ProgressLevel;

  @ApiProperty({ required: false, nullable: true })
  summary?: string;

  @ApiProperty({ required: false, nullable: true })
  notes?: string;

  @ApiProperty({ required: false, description: 'Mention every eligible project member.' })
  mentionAll?: boolean;

  @ApiProperty({ required: false, type: [String], description: 'Explicit project member IDs to mention.' })
  mentionedUserIds?: string[];

  @ApiProperty({ required: false, enum: ['pending', 'completed'] })
  status?: ProgressStatus;
}

export class UpdateEntryBody {
  @ApiProperty({ required: false, description: 'YYYY-MM-DD week start date.' })
  weekStartDate?: string;
  @ApiProperty({ required: false }) title?: string;
  @ApiProperty({ required: false, enum: ['primary', 'secondary', 'minor'] })
  level?: ProgressLevel;
  @ApiProperty({ required: false, nullable: true }) summary?: string;
  @ApiProperty({ required: false, nullable: true }) notes?: string;
  @ApiProperty({ required: false }) mentionAll?: boolean;
  @ApiProperty({ required: false, type: [String] }) mentionedUserIds?: string[];
  @ApiProperty({ required: false, enum: ['pending', 'completed'] })
  status?: ProgressStatus;
  @ApiProperty({
    required: false,
    description: 'Toggle the lock. The only field a locked card accepts; every other change is rejected while the lock is set.'
  })
  isLocked?: boolean;

  @ApiProperty({ minimum: 1, description: 'Optimistic-lock revision.' })
  expectedRevision!: number;
}

export class PublicEntry {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) projectId!: string;
  @ApiProperty({ example: '2026-01-12' }) weekStartDate!: string;
  @ApiProperty({ format: 'uuid' }) authorId!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: ['primary', 'secondary', 'minor'] })
  level!: ProgressLevel;
  @ApiProperty({ nullable: true }) summary!: string | null;
  @ApiProperty({ nullable: true }) notes!: string | null;
  @ApiProperty() mentionAll!: boolean;
  @ApiProperty({ type: [String] }) mentionedUserIds!: string[];
  @ApiProperty({ enum: ['pending', 'completed'] })
  status!: ProgressStatus;
  @ApiProperty({ description: 'Locked cards cannot be moved, edited, or deleted.' })
  isLocked!: boolean;
  @ApiProperty({ minimum: 1 }) revision!: number;
  @ApiProperty({ example: '2026-09-16T10:49:09.010Z' })
  createdAt!: string;
  @ApiProperty({ example: '2026-09-16T10:49:09.010Z' })
  updatedAt!: string;
}

export function toPublicEntry(e: ProgressEntry): PublicEntry {
  return {
    id: e.id,
    projectId: e.projectId,
    weekStartDate: e.weekStartDate.toISOString().slice(0, 10),
    authorId: e.authorId,
    title: e.title,
    level: e.level,
    summary: e.summary,
    notes: e.notes,
    mentionAll: e.mentionAll,
    mentionedUserIds: e.mentionedUserIds,
    status: e.status,
    isLocked: e.isLocked,
    revision: e.revision,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString()
  };
}
