import { ApiProperty } from '@nestjs/swagger';
import type {
  Project,
  ProjectMember,
  ProjectRole
} from '@prisma/client';

export class CreateProjectBody {
  @ApiProperty({ example: 'R1 Pilot — G1 cohort' })
  name!: string;

  @ApiProperty({ required: false, nullable: true })
  description?: string;

  @ApiProperty({ example: '2026-01-05' })
  startDate!: string;

  @ApiProperty({ example: '2026-03-29' })
  endDate!: string;

  @ApiProperty({
    required: false,
    enum: ['private', 'workspace'],
    example: 'workspace'
  })
  visibility?: 'private' | 'workspace';

  @ApiProperty({ required: false, example: '#10b981' })
  color?: string;

  @ApiProperty({
    required: false,
    enum: ['CN', 'US', 'NONE'],
    example: 'CN'
  })
  holidayRegion?: 'CN' | 'US' | 'NONE';
}

export class UpdateProjectBody {
  @ApiProperty({ required: false }) name?: string;
  @ApiProperty({ required: false, nullable: true }) description?: string;
  @ApiProperty({ required: false, example: '2026-01-05' })
  startDate?: string;
  @ApiProperty({ required: false, example: '2026-03-29' })
  endDate?: string;
  @ApiProperty({
    required: false,
    enum: ['private', 'workspace']
  })
  visibility?: 'private' | 'workspace';
  @ApiProperty({ required: false, enum: ['active'] })
  status?: 'active';
  @ApiProperty({ required: false, example: '#6366f1' })
  color?: string;
  @ApiProperty({ required: false, enum: ['CN', 'US', 'NONE'] })
  holidayRegion?: 'CN' | 'US' | 'NONE';

  @ApiProperty({ minimum: 1, description: 'Optimistic-lock revision.' })
  expectedRevision!: number;
}

export class PublicProject {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) workspaceId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true }) description!: string | null;
  @ApiProperty({ example: '2026-01-05' }) startDate!: string;
  @ApiProperty({ example: '2026-03-29' }) endDate!: string;
  @ApiProperty({ enum: ['private', 'workspace'] })
  visibility!: 'private' | 'workspace';
  @ApiProperty({ enum: ['active', 'archived'] })
  status!: 'active' | 'archived';
  @ApiProperty({ example: '#6366f1' }) color!: string;
  @ApiProperty({ enum: ['CN', 'US', 'NONE'], nullable: true })
  holidayRegion!: 'CN' | 'US' | 'NONE' | null;
  @ApiProperty({ minimum: 1 }) revision!: number;
  @ApiProperty({ format: 'uuid' }) creatorId!: string;
  @ApiProperty({ example: '2026-09-16T10:49:08.341Z' })
  createdAt!: string;
  @ApiProperty({ example: '2026-09-16T10:49:08.341Z' })
  updatedAt!: string;

  @ApiProperty({
    enum: ['Lead', 'Editor', 'Viewer'],
    nullable: true,
    description: "Caller's role in this project; null if not a member."
  })
  myRole!: ProjectRole | null;
}

export function toPublicProject(
  project: Project,
  myRole: ProjectRole | null
): PublicProject {
  return {
    id: project.id,
    workspaceId: project.workspaceId,
    name: project.name,
    description: project.description,
    startDate: project.startDate.toISOString().slice(0, 10),
    endDate: project.endDate.toISOString().slice(0, 10),
    visibility: project.visibility,
    status: project.status,
    color: project.color,
    holidayRegion: (project.holidayRegion as 'CN' | 'US' | 'NONE' | null) ?? null,
    revision: project.revision,
    creatorId: project.creatorId,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    myRole
  };
}

export type { ProjectMember };
