import { ApiProperty } from '@nestjs/swagger';
import type { Membership, Workspace, WorkspaceRole } from '@prisma/client';

export class CreateWorkspaceBody {
  @ApiProperty({ example: 'R1 Pilot' })
  name!: string;

  @ApiProperty({ required: false, example: 'r1-pilot' })
  slug?: string;
}

export class UpdateWorkspaceBody {
  @ApiProperty({ example: 'AI 产品团队' })
  name!: string;
}

export class PublicWorkspace {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'R1 Pilot' })
  name!: string;

  @ApiProperty({ example: 'r1-pilot' })
  slug!: string;

  @ApiProperty({ enum: ['Owner', 'Admin', 'Member'] })
  role!: WorkspaceRole;

  @ApiProperty({ example: '2026-09-16T10:35:05.852Z' })
  createdAt!: string;
}

export function toPublicWorkspace(
  workspace: Workspace,
  membership: Membership
): PublicWorkspace {
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    role: membership.role,
    createdAt: workspace.createdAt.toISOString()
  };
}
