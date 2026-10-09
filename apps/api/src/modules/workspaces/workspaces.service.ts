import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import type { Membership, User, Workspace } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  newMembershipId,
  newWorkspaceId
} from '@syncpath/domain';

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(user: User): Promise<Array<{ workspace: Workspace; membership: Membership }>> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId: user.id, workspace: { deletedAt: null } },
      include: { workspace: true },
      orderBy: { createdAt: 'asc' }
    });
    return memberships.map((m) => ({
      workspace: m.workspace,
      membership: m
    }));
  }

  async create(
    user: User,
    input: { name: string; slug?: string }
  ): Promise<{ workspace: Workspace; membership: Membership }> {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name) {
      throw new ForbiddenException({
        code: 'invalid_name',
        message: 'Workspace name is required.'
      });
    }
    // The display name may be written in any language. Slugs are internal
    // ASCII identifiers, so generate a stable fallback when a name (for
    // example Chinese text) has no Latin characters to transliterate.
    const workspaceId = newWorkspaceId();
    const requestedSlug = typeof input.slug === 'string' ? input.slug.trim() : '';
    // UUIDv7 prefixes contain the timestamp; preserve the complete id so
    // consecutive non-Latin names cannot receive the same fallback slug.
    const slug = (requestedSlug || slugify(name) || `ws-${workspaceId.replace(/-/g, '')}`).toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) {
      throw new ConflictException({
        code: 'invalid_slug',
        message:
          'Custom slug must be 2–41 chars, lowercase letters/digits/dashes, starting with a letter or digit.'
      });
    }
    const existing = await this.prisma.workspace.findUnique({
      where: { slug }
    });
    if (existing) {
      throw new ConflictException({
        code: 'slug_taken',
        message: 'A workspace with that slug already exists.'
      });
    }
    // Single transaction: workspace + Owner membership.
    return this.prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: {
          id: workspaceId,
          name,
          slug,
          ownerId: user.id
        }
      });
      const membership = await tx.membership.create({
        data: {
          id: newMembershipId(),
          workspaceId: workspace.id,
          userId: user.id,
          role: 'Owner'
        }
      });
      return { workspace, membership };
    });
  }

  async getByIdForUser(
    workspaceId: string,
    user: User
  ): Promise<{ workspace: Workspace; membership: Membership }> {
    const membership = await this.prisma.membership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: user.id } },
      include: { workspace: true }
    });
    if (!membership || membership.workspace.deletedAt) {
      throw new NotFoundException({
        code: 'workspace_not_found',
        message: 'Workspace not found or inaccessible.'
      });
    }
    return { workspace: membership.workspace, membership };
  }

  async rename(input: {
    workspaceId: string;
    user: User;
    name: string;
  }): Promise<{ workspace: Workspace; membership: Membership }> {
    const { workspace, membership } = await this.getByIdForUser(
      input.workspaceId,
      input.user
    );
    if (membership.role !== 'Owner' && membership.role !== 'Admin') {
      throw new ForbiddenException({
        code: 'workspace_settings_forbidden',
        message: 'Only the workspace Owner or Admin can change workspace settings.'
      });
    }

    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name) {
      throw new BadRequestException({
        code: 'invalid_name',
        message: 'Workspace name is required.'
      });
    }
    if (name.length > 120) {
      throw new BadRequestException({
        code: 'invalid_name',
        message: 'Workspace name must be 120 characters or fewer.'
      });
    }

    const updated = await this.prisma.workspace.update({
      where: { id: workspace.id },
      data: { name }
    });
    return { workspace: updated, membership };
  }

  /**
   * RV-10: soft-delete a workspace. Cascade hides every project + entry
   * (already enforced by the workspace.deletedAt checks in
   * ProjectRolesGuard / ProjectsService.getById / EntriesService.getById).
   * Only the workspace Owner can do this.
   */
  async softDelete(input: { workspaceId: string; user: User }): Promise<void> {
    const { workspace, membership } = await this.getByIdForUser(
      input.workspaceId,
      input.user
    );
    if (membership.role !== 'Owner') {
      throw new ForbiddenException({
        code: 'owner_required',
        message: 'Only the workspace Owner can archive this workspace.'
      });
    }
    await this.prisma.workspace.update({
      where: { id: workspace.id },
      data: { deletedAt: new Date() }
    });
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 41);
}
