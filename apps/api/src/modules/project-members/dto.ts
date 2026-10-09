import { ApiProperty } from '@nestjs/swagger';
import type { ProjectRole } from '@prisma/client';

export interface PublicProjectMember {
  user: {
    id: string;
    username: string;
    email: string;
    displayName: string | null;
  };
  role: ProjectRole;
  createdAt: string;
}

export class InviteMemberBody {
  @ApiProperty({ required: false, format: 'uuid' })
  userId?: string;

  @ApiProperty({
    required: false,
    example: 'alex@company.com',
    description: 'Username or email. Used when userId is not supplied.'
  })
  identifier?: string;

  @ApiProperty({ enum: ['Lead', 'Editor', 'Viewer'] })
  role!: ProjectRole;
}

export class ChangeRoleBody {
  @ApiProperty({ enum: ['Lead', 'Editor', 'Viewer'] })
  role!: ProjectRole;
}
