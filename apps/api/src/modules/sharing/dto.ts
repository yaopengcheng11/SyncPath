import { ApiProperty } from '@nestjs/swagger';
import type { ShareLink } from '@prisma/client';
import { PublicProject } from '../projects/dto';
import { PublicEntry } from '../entries/dto';

export class PublicShareLink {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['workspace', 'project'] }) kind!: 'workspace' | 'project';
  @ApiProperty() createdAt!: string;
  @ApiProperty({ nullable: true }) revokedAt!: string | null;
}

export class CreatedShareLink extends PublicShareLink {
  @ApiProperty({ description: 'Opaque capability returned only once; place it in the URL fragment.' })
  token!: string;
}

export class ResolveShareLinkBody {
  @ApiProperty({ description: 'Opaque token from the shared URL fragment.' }) token!: string;
}

export class SharedWorkspace {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
}

export class SharedContent {
  @ApiProperty({ enum: ['workspace', 'project'] }) kind!: 'workspace' | 'project';
  @ApiProperty({ type: SharedWorkspace }) workspace!: SharedWorkspace;
  @ApiProperty({ type: [PublicProject] }) projects!: PublicProject[];
  @ApiProperty({ type: [PublicEntry] }) entries!: PublicEntry[];
}

export function toPublicShareLink(link: ShareLink): PublicShareLink {
  return {
    id: link.id,
    kind: link.projectId ? 'project' : 'workspace',
    createdAt: link.createdAt.toISOString(),
    revokedAt: link.revokedAt?.toISOString() ?? null
  };
}
