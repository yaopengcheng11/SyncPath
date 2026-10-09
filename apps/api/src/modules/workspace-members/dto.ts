import { ApiProperty } from '@nestjs/swagger';
import type { WorkspaceRole } from '@prisma/client';

export class InviteWorkspaceMemberBody {
  @ApiProperty({ required: false, format: 'uuid' })
  userId?: string;

  @ApiProperty({ required: false, example: 'alex@company.com' })
  identifier?: string;

  @ApiProperty({ enum: ['Owner', 'Admin', 'Member'] })
  role!: WorkspaceRole;
}

export class ChangeWorkspaceRoleBody {
  @ApiProperty({ enum: ['Owner', 'Admin', 'Member'] })
  role!: WorkspaceRole;
}

export interface PublicWorkspaceMember {
  user: {
    id: string;
    username: string;
    email: string;
    displayName: string | null;
  };
  role: WorkspaceRole;
  createdAt: string;
}
