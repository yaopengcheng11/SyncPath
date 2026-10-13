import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma, Project } from '@prisma/client';
import { newId } from '@syncpath/domain';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CollaborationService } from '../collaboration/collaboration.service';
import { toPublicEntry } from '../entries/dto';
import { toPublicProject } from '../projects/dto';
import type { MentionTimelineContent } from './timeline.dto';

export interface MentionSelection {
  mentionAll?: boolean;
  mentionedUserIds?: string[];
}

@Injectable()
export class MentionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly collaboration: CollaborationService
  ) {}

  async candidates(project: Project) {
    const memberships = await this.prisma.membership.findMany({
      where: {
        workspaceId: project.workspaceId,
        user: { status: 'active', deletedAt: null },
        OR: [
          { role: { in: ['Owner', 'Admin'] } },
          { user: { projectMemberships: { some: { projectId: project.id } } } }
        ]
      },
      include: { user: { select: { id: true, username: true, displayName: true } } },
      orderBy: { createdAt: 'asc' }
    });
    return memberships.map(({ user }) => user);
  }

  async resolve(project: Project, selection: MentionSelection): Promise<string[]> {
    const explicit = selection.mentionedUserIds ?? [];
    if (!Array.isArray(explicit) || explicit.length > 100 || explicit.some((id) => typeof id !== 'string')) {
      throw new BadRequestException({ code: 'invalid_mentions', message: 'Mentioned users must be a list of at most 100 user IDs.' });
    }
    if (selection.mentionAll !== undefined && typeof selection.mentionAll !== 'boolean') {
      throw new BadRequestException({ code: 'invalid_mentions', message: 'mentionAll must be a boolean.' });
    }
    const allowed = new Set((await this.candidates(project)).map((user) => user.id));
    if (explicit.some((id) => !allowed.has(id))) {
      throw new BadRequestException({ code: 'invalid_mentions', message: 'A mentioned user is not a project member.' });
    }
    // Persist the selected people, including the author. A self-mention is
    // meaningful on the user's timeline even though it needs no inbox alert.
    return [...new Set(selection.mentionAll ? allowed : explicit)];
  }

  notificationRows(input: {
    project: Project;
    entryId: string;
    actorId: string;
    recipients: string[];
  }) {
    return input.recipients.filter((recipientId) => recipientId !== input.actorId).map((recipientId) => ({
      id: newId(),
      workspaceId: input.project.workspaceId,
      projectId: input.project.id,
      entryId: input.entryId,
      actorId: input.actorId,
      recipientId
    }));
  }

  async createNotifications(tx: Prisma.TransactionClient, rows: ReturnType<MentionsService['notificationRows']>): Promise<void> {
    if (rows.length > 0) await tx.mentionNotification.createMany({ data: rows });
  }

  publish(rows: ReturnType<MentionsService['notificationRows']>): void {
    rows.forEach((row) => this.collaboration.publishMention(row.recipientId, row.id));
  }

  async listForUser(userId: string) {
    const rows = await this.prisma.mentionNotification.findMany({
      where: {
        recipientId: userId,
        entry: { deletedAt: null },
        project: {
          deletedAt: null,
          workspace: { deletedAt: null, memberships: { some: { userId } } },
          OR: [
            { members: { some: { userId } } },
            { workspace: { memberships: { some: { userId, role: { in: ['Owner', 'Admin'] } } } } }
          ]
        }
      },
      include: {
        actor: { select: { id: true, username: true, displayName: true } },
        project: { select: { id: true, name: true } },
        entry: { select: { id: true, title: true, weekStartDate: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });
    return rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      project: row.project,
      entry: { id: row.entry.id, title: row.entry.title, date: row.entry.weekStartDate.toISOString().slice(0, 10) },
      actor: row.actor,
      createdAt: row.createdAt.toISOString(),
      readAt: row.readAt?.toISOString() ?? null
    }));
  }

  async markRead(userId: string, id: string): Promise<void> {
    await this.prisma.mentionNotification.updateMany({
      where: { id, recipientId: userId, readAt: null },
      data: { readAt: new Date() }
    });
  }

  async timeline(userId: string, workspaceIds?: string[]): Promise<MentionTimelineContent> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, workspace: { deletedAt: null } },
      include: { workspace: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' }
    });
    // The entry query checks membership and task authority itself. The filter
    // narrows that predicate; submitted IDs never grant access or reveal names.
    const entries = await this.prisma.progressEntry.findMany({
      where: {
        deletedAt: null, mentionedUserIds: { has: userId },
        project: {
          deletedAt: null, status: 'active',
          ...(workspaceIds === undefined ? {} : { workspaceId: { in: workspaceIds } }),
          workspace: { deletedAt: null, memberships: { some: { userId } } },
          OR: [
            { members: { some: { userId } } },
            { workspace: { memberships: { some: { userId, role: { in: ['Owner', 'Admin'] } } } } }
          ]
        }
      },
      include: { project: { include: {
        members: { where: { userId }, select: { role: true } },
        workspace: { select: { id: true, name: true, memberships: { where: { userId }, select: { role: true } } } }
      } } },
      orderBy: [{ weekStartDate: 'asc' }, { id: 'asc' }]
    });
    return { workspaces: memberships.map((membership) => membership.workspace), items: entries.map((entry) => {
      const workspaceRole = entry.project.workspace.memberships[0]?.role;
      const role = workspaceRole === 'Owner' || workspaceRole === 'Admin' ? 'Lead' : entry.project.members[0]?.role ?? null;
      return { workspace: { id: entry.project.workspace.id, name: entry.project.workspace.name }, project: toPublicProject(entry.project, role), entry: toPublicEntry(entry) };
    }) };
  }
}
