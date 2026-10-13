import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma, type ShareLink, type User } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { newId } from '@syncpath/domain';
import { PrismaService } from '../../common/prisma/prisma.service';
import { toPublicProject } from '../projects/dto';
import { toPublicEntry } from '../entries/dto';
import { type CreatedShareLink, type PublicShareLink, type ReceivedShare, type SharedContent, toPublicShareLink } from './dto';

type Database = Prisma.TransactionClient;
type Target = { workspaceId: string; projectId: string | null };

function unavailable(): NotFoundException {
  return new NotFoundException({ code: 'share_not_found', message: 'Share link not found or unavailable.' });
}

@Injectable()
export class SharingService {
  constructor(private readonly prisma: PrismaService) {}

  private async targetForProject(db: Database, projectId: string): Promise<Target> {
    const project = await db.project.findUnique({ where: { id: projectId } });
    if (!project) throw unavailable();
    return { workspaceId: project.workspaceId, projectId: project.id };
  }

  /** Do not infer share authority from creation history: only current roles count. */
  private async canManage(db: Database, target: Target, userId: string, allowArchived = false): Promise<boolean> {
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt || user.status !== 'active') return false;
    const workspace = await db.workspace.findUnique({ where: { id: target.workspaceId } });
    if (!workspace || workspace.deletedAt) return false;
    if (target.projectId) {
      const project = await db.project.findUnique({ where: { id: target.projectId } });
      if (!project || project.workspaceId !== workspace.id || project.deletedAt || (!allowArchived && project.status !== 'active')) return false;
    }
    const membership = await db.membership.findUnique({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId } }
    });
    if (!membership) return false;
    if (membership.role === 'Owner' || membership.role === 'Admin') return true;
    if (!target.projectId) return false;
    const member = await db.projectMember.findUnique({
      where: { projectId_userId: { projectId: target.projectId, userId } }
    });
    return member?.role === 'Lead';
  }

  private async assertManage(db: Database, target: Target, userId: string, allowArchived = false): Promise<void> {
    if (!(await this.canManage(db, target, userId, allowArchived))) {
      throw new ForbiddenException({ code: 'share_management_forbidden', message: 'Current administrator or task Lead permission is required.' });
    }
  }

  async createForWorkspace(workspaceId: string, user: User): Promise<CreatedShareLink> {
    return this.create({ workspaceId, projectId: null }, user);
  }

  async createForProject(projectId: string, user: User): Promise<CreatedShareLink> {
    return this.prisma.$transaction(async (db) => {
      const target = await this.targetForProject(db, projectId);
      return this.createInTransaction(db, target, user);
    });
  }

  private async create(target: Target, user: User): Promise<CreatedShareLink> {
    return this.prisma.$transaction((db) => this.createInTransaction(db, target, user));
  }

  private async createInTransaction(db: Database, target: Target, user: User): Promise<CreatedShareLink> {
    await this.assertManage(db, target, user.id);
    const token = randomBytes(32).toString('base64url');
    const link = await db.shareLink.create({
      data: { id: newId(), ...target, creatorId: user.id, tokenHash: this.hash(token) }
    });
    return { ...toPublicShareLink(link), token };
  }

  async listForWorkspace(workspaceId: string, user: User): Promise<PublicShareLink[]> {
    return this.list({ workspaceId, projectId: null }, user);
  }

  async listForProject(projectId: string, user: User): Promise<PublicShareLink[]> {
    return this.prisma.$transaction(async (db) => {
      const target = await this.targetForProject(db, projectId);
      await this.assertManage(db, target, user.id);
      return this.listInTransaction(db, target);
    });
  }

  private async list(target: Target, user: User): Promise<PublicShareLink[]> {
    return this.prisma.$transaction(async (db) => {
      await this.assertManage(db, target, user.id);
      return this.listInTransaction(db, target);
    });
  }

  private async listInTransaction(db: Database, target: Target): Promise<PublicShareLink[]> {
    const links = await db.shareLink.findMany({ where: target, orderBy: { createdAt: 'desc' } });
    return links.map(toPublicShareLink);
  }

  async revoke(id: string, user: User): Promise<void> {
    await this.prisma.$transaction(async (db) => {
      const link = await db.shareLink.findUnique({ where: { id } });
      if (!link) throw unavailable();
      // Administrators may permanently revoke archived task links before a
      // task is restored; archive itself still makes every resolve unavailable.
      await this.assertManage(db, link, user.id, true);
      await db.shareLink.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
    });
  }

  async resolve(token: unknown, user: User): Promise<SharedContent> {
    this.assertActiveRecipient(user);
    // All malformed/revoked/hidden tokens share the same error envelope.
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw unavailable();
    // Parallel tabs can accept the same link for the first time. PostgreSQL
    // may retry a RepeatableRead INSERT conflict; no existing receipt is ever
    // updated by the regular shared-content polling path.
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(async (db) => {
          const link = await db.shareLink.findUnique({ where: { tokenHash: this.hash(token) } });
          if (!link) throw unavailable();
          const content = await this.sharedContent(db, link);
          await this.rememberReceived(db, link, user.id, content);
          return content;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || attempt >= 2) throw error;
      }
    }
  }

  async listReceived(user: User): Promise<ReceivedShare[]> {
    this.assertActiveRecipient(user);
    return this.prisma.$transaction(async (db) => {
      const receipts = await db.receivedShare.findMany({
        where: { userId: user.id }, include: { link: true }, orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }]
      });
      return Promise.all(receipts.map(async (receipt): Promise<ReceivedShare> => ({
        id: receipt.id,
        kind: receipt.kind === 'project' ? 'project' : 'workspace',
        name: receipt.name,
        workspaceName: receipt.workspaceName,
        sharedBy: { username: receipt.sharerUsername, displayName: receipt.sharerDisplayName },
        receivedAt: receipt.receivedAt.toISOString(),
        status: receipt.link && !receipt.link.revokedAt && await this.canManage(db, receipt.link, receipt.link.creatorId) ? 'active' : 'unavailable'
      })));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async resolveReceived(id: string, user: User): Promise<SharedContent> {
    this.assertActiveRecipient(user);
    return this.prisma.$transaction(async (db) => {
      const receipt = await db.receivedShare.findFirst({ where: { id, userId: user.id }, include: { link: true } });
      if (!receipt?.link) throw unavailable();
      return this.sharedContent(db, receipt.link);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  private assertActiveRecipient(user: User): void {
    if (user.deletedAt || user.status !== 'active') {
      throw new UnauthorizedException({ code: 'user_inactive', message: 'User account is inactive.' });
    }
  }

  /** Tokens and saved receipts always resolve through the same scope/authority check. */
  private async sharedContent(db: Database, link: ShareLink): Promise<SharedContent> {
    if (link.revokedAt || !(await this.canManage(db, link, link.creatorId))) throw unavailable();
    const workspace = await db.workspace.findUniqueOrThrow({ where: { id: link.workspaceId } });
    const projects = await db.project.findMany({
      where: { workspaceId: workspace.id, deletedAt: null, status: 'active', ...(link.projectId ? { id: link.projectId } : {}) },
      orderBy: { createdAt: 'asc' }
    });
    const entries = await db.progressEntry.findMany({
      where: { projectId: { in: projects.map((project) => project.id) }, deletedAt: null },
      orderBy: [{ weekStartDate: 'asc' }, { createdAt: 'asc' }]
    });
    return {
      kind: link.projectId ? 'project' : 'workspace',
      workspace: { id: workspace.id, name: workspace.name },
      projects: projects.map((project) => toPublicProject(project, 'Viewer')),
      entries: entries.map(toPublicEntry)
    };
  }

  private async rememberReceived(db: Database, link: ShareLink, userId: string, content: SharedContent): Promise<void> {
    const existing = await db.receivedShare.findUnique({ where: { userId_linkId: { userId, linkId: link.id } }, select: { id: true } });
    if (existing) return;
    const creator = await db.user.findUniqueOrThrow({ where: { id: link.creatorId } });
    await db.receivedShare.createMany({
      data: [{
        id: newId(), userId, linkId: link.id, kind: content.kind,
        name: link.projectId ? content.projects[0].name : content.workspace.name,
        workspaceName: content.workspace.name,
        sharerUsername: creator.username, sharerDisplayName: creator.displayName
      }],
      skipDuplicates: true
    });
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
