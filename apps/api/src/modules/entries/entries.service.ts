import {
  ConflictException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import type { Project, ProgressEntry, User, WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { newProgressEntryId } from '@syncpath/domain';
import { parseSafeDate } from '../../common/dates';
import type { CreateEntryBody, ProgressLevel, UpdateEntryBody } from './dto';
import { ENTRY_LOCKED_DELETE_MESSAGE, ENTRY_LOCKED_UPDATE_MESSAGE, isLockedUpdateRejected } from './entryLock';
import { MentionsService } from '../mentions/mentions.service';
import { TimelineHistoryService } from '../timeline-history/timeline-history.service';

@Injectable()
export class EntriesService {
  constructor(private readonly prisma: PrismaService, private readonly mentions: MentionsService, private readonly history: TimelineHistoryService) {}

  async listForProject(input: {
    projectId: string;
    from?: string;
    to?: string;
  }): Promise<ProgressEntry[]> {
    const where: Record<string, unknown> = {
      projectId: input.projectId,
      deletedAt: null
    };
    if (input.from || input.to) {
      const range: Record<string, Date> = {};
      if (input.from) {
        const d = parseSafeDate(input.from);
        if (!Number.isNaN(d.getTime())) range.gte = d;
      }
      if (input.to) {
        const d = parseSafeDate(input.to);
        if (!Number.isNaN(d.getTime())) range.lte = d;
      }
      if (Object.keys(range).length > 0) where.weekStartDate = range;
    }
    return this.prisma.progressEntry.findMany({
      where,
      orderBy: [{ weekStartDate: 'asc' }, { createdAt: 'asc' }]
    });
  }

  async create(input: {
    project: Project;
    user: User;
    body: CreateEntryBody;
  }): Promise<ProgressEntry> {
    const title = (input.body.title ?? '').trim();
    if (!title) {
      throw new ConflictException({ code: 'invalid_title', message: 'Title is required.' });
    }
    const level = this.normaliseLevel(input.body.level);
    const status = input.body.status ?? 'pending';
    const week = parseSafeDate(input.body.weekStartDate);
    if (Number.isNaN(week.getTime())) {
      throw new ConflictException({
        code: 'invalid_week_start_date',
        message: 'weekStartDate must be YYYY-MM-DD.'
      });
    }
    if (week < input.project.startDate || week > input.project.endDate) {
      throw new ConflictException({
        code: 'week_out_of_range',
        message: 'weekStartDate must fall inside the project date range.'
      });
    }
    const recipients = await this.mentions.resolve(input.project, input.body);
    const entryId = newProgressEntryId();
    const rows = this.mentions.notificationRows({ project: input.project, entryId, actorId: input.user.id, recipients });
    const entry = await this.prisma.$transaction(async (tx) => {
      const context = await this.history.begin(tx, input.project.id);
      this.assertDateRange(week, context.before.project.startDate, context.before.project.endDate);
      const created = await tx.progressEntry.create({
        data: {
          id: entryId,
          projectId: input.project.id,
          weekStartDate: week,
          authorId: input.user.id,
          title,
          level,
          summary: input.body.summary ?? null,
          notes: input.body.notes ?? null,
          mentionAll: input.body.mentionAll ?? false,
          mentionedUserIds: recipients,
          status,
          revision: 1
        }
      });
      await this.mentions.createNotifications(tx, rows);
      await this.history.record(tx, context, input.user, 'entry.created', created.id);
      return created;
    });
    this.mentions.publish(rows);
    return entry;
  }

  async getById(entryId: string): Promise<ProgressEntry> {
    const entry = await this.prisma.progressEntry.findUnique({ where: { id: entryId } });
    if (!entry || entry.deletedAt) {
      // Don't distinguish "doesn't exist" from "soft-deleted" — see
      // docs §7.2 (consistent 404 for all inaccessible objects).
      throw new NotFoundException({
        code: 'entry_not_found',
        message: 'Entry not found or inaccessible.'
      });
    }
    return entry;
  }

  async update(input: {
    entry: ProgressEntry;
    user: User;
    changes: UpdateEntryBody;
  }): Promise<ProgressEntry> {
    const { expectedRevision, ...changes } = input.changes;
    if (expectedRevision !== input.entry.revision) {
      throw new ConflictException({
        code: 'revision_conflict',
        message: `expectedRevision ${expectedRevision} does not match current ${input.entry.revision}.`
      });
    }
    this.assertUnlocked(input.entry, changes);
    const data: Record<string, unknown> = {
      revision: input.entry.revision + 1
    };
    if (changes.weekStartDate !== undefined) {
      const week = parseSafeDate(changes.weekStartDate);
      if (Number.isNaN(week.getTime())) {
        throw new ConflictException({
          code: 'invalid_week_start_date',
          message: 'weekStartDate must be YYYY-MM-DD.'
        });
      }
      data.weekStartDate = week;
    }
    if (changes.title !== undefined) data.title = changes.title.trim();
    if (changes.level !== undefined) data.level = this.normaliseLevel(changes.level);
    if (changes.summary !== undefined) data.summary = changes.summary;
    if (changes.notes !== undefined) data.notes = changes.notes;
    if (changes.status !== undefined) data.status = changes.status;
    if (changes.isLocked !== undefined) data.isLocked = changes.isLocked;

    let rows: ReturnType<MentionsService['notificationRows']> = [];
    if (changes.mentionAll !== undefined || changes.mentionedUserIds !== undefined) {
      const project = await this.prisma.project.findUniqueOrThrow({ where: { id: input.entry.projectId } });
      const recipients = await this.mentions.resolve(project, {
        mentionAll: changes.mentionAll ?? input.entry.mentionAll,
        mentionedUserIds: changes.mentionedUserIds ?? input.entry.mentionedUserIds
      });
      data.mentionAll = changes.mentionAll ?? input.entry.mentionAll;
      data.mentionedUserIds = recipients;
      rows = this.mentions.notificationRows({
        project,
        entryId: input.entry.id,
        actorId: input.user.id,
        recipients: recipients.filter((id) => !input.entry.mentionedUserIds.includes(id))
      });
    }

    // Atomic CAS (RV-08): only one writer with the matching revision can
    // succeed; the loser's affected-rows count is 0 → 409.
    const updated = await this.prisma.$transaction(async (tx) => {
      const context = await this.history.begin(tx, input.entry.projectId);
      if (data.weekStartDate instanceof Date) this.assertDateRange(data.weekStartDate, context.before.project.startDate, context.before.project.endDate);
      const result = await tx.progressEntry.updateMany({
        where: {
          id: input.entry.id,
          revision: input.entry.revision,
          deletedAt: null
        },
        data
      });
      if (result.count === 0) {
        throw new ConflictException({
          code: 'revision_conflict',
          message: `expectedRevision ${expectedRevision} no longer matches current revision.`
        });
      }
      await this.mentions.createNotifications(tx, rows);
      await this.history.record(tx, context, input.user, 'entry.updated', input.entry.id);
      return tx.progressEntry.findUniqueOrThrow({ where: { id: input.entry.id } });
    });
    this.mentions.publish(rows);
    return updated;
  }

  async delete(input: { entry: ProgressEntry; user: User; expectedRevision?: number }): Promise<void> {
    if (input.entry.isLocked) {
      throw new ConflictException({
        code: 'entry_locked',
        message: ENTRY_LOCKED_DELETE_MESSAGE
      });
    }
    // A delete is a write too: without the optimistic-lock check a stale tab
    // could silently discard a teammate's just-saved edit.
    if (
      input.expectedRevision !== undefined &&
      input.expectedRevision !== input.entry.revision
    ) {
      throw new ConflictException({
        code: 'revision_conflict',
        message: `expectedRevision ${input.expectedRevision} does not match current ${input.entry.revision}.`
      });
    }
    await this.prisma.$transaction(async (tx) => {
      const revision = await this.history.lock(tx, input.entry.projectId);
      const result = await tx.progressEntry.deleteMany({
        where: { id: input.entry.id, revision: input.entry.revision, isLocked: false, deletedAt: null }
      });
      if (result.count === 0) throw new ConflictException({ code: 'revision_conflict', message: 'The card changed while you were reviewing it.' });
      await this.history.removeEntry(tx, { projectId: input.entry.projectId, revision }, input.entry.id);
    });
  }

  /**
   * Bulk create for the legacy JSON import path. Returns the created rows.
   * Skips invalid rows and reports them via {@link BulkResult.skipped}.
   */
  async bulkCreate(input: {
    project: Project;
    authorId: string;
    rows: Array<{
      weekStartDate: string;
      title: string;
      level: ProgressLevel;
      summary?: string;
      notes?: string;
      status?: 'pending' | 'completed';
    }>;
  }): Promise<{
    created: ProgressEntry[];
    skipped: Array<{ index: number; reason: string }>;
  }> {
    const created: ProgressEntry[] = [];
    const skipped: Array<{ index: number; reason: string }> = [];
    const author = await this.prisma.user.findUniqueOrThrow({ where: { id: input.authorId } });
    for (let i = 0; i < input.rows.length; i++) {
      const row = input.rows[i];
      try {
        // Explicit empty-string check so callers can see the row was
        // rejected, instead of having it silently coerced to the project
        // start date by clampDate().
        if (!row.weekStartDate || !/^\d{4}-\d{2}-\d{2}$/.test(row.weekStartDate)) {
          skipped.push({ index: i, reason: 'invalid_date' });
          continue;
        }
        const week = parseSafeDate(row.weekStartDate);
        if (Number.isNaN(week.getTime())) {
          skipped.push({ index: i, reason: 'invalid_date' });
          continue;
        }
        if (!row.title?.trim()) {
          skipped.push({ index: i, reason: 'missing_title' });
          continue;
        }
        const level = this.normaliseLevel(row.level);
        const entry = await this.prisma.$transaction(async (tx) => {
          const context = await this.history.begin(tx, input.project.id);
          const imported = await tx.progressEntry.create({
            data: {
              id: newProgressEntryId(),
              projectId: input.project.id,
              weekStartDate: week,
              authorId: input.authorId,
              title: row.title.trim(),
              level,
              summary: row.summary ?? null,
              notes: row.notes ?? null,
              status: row.status ?? 'pending',
              revision: 1
            }
          });
          await this.history.record(tx, context, author, 'entry.imported', imported.id);
          return imported;
        });
        created.push(entry);
      } catch (err) {
        skipped.push({
          index: i,
          reason: err instanceof Error ? err.message : 'unknown'
        });
      }
    }
    return { created, skipped };
  }

  private normaliseLevel(input: unknown): ProgressLevel {
    if (input === 'primary' || input === 1) return 'primary';
    if (input === 'secondary' || input === 2) return 'secondary';
    if (input === 'minor' || input === 3) return 'minor';
    throw new ConflictException({
      code: 'invalid_level',
      message: 'level must be primary|secondary|minor (or 1|2|3).'
    });
  }

  private assertDateRange(date: Date, start: string, end: string): void {
    const value = date.toISOString().slice(0, 10);
    if (value < start || value > end) throw new ConflictException({ code: 'week_out_of_range', message: 'weekStartDate must fall inside the current project date range.' });
  }

  /**
   * A locked card is immutable. This is the server-side authority behind the
   * lock: the UI disables dragging and the editor, but a stale tab, a replayed
   * request, or a second client would otherwise still get through.
   *
   * The lock flag itself stays writable — that is how a card gets unlocked —
   * and a PATCH carrying nothing but the flag is accepted in either direction.
   * Anything that touches content, date (a move), level, status, or mentions
   * while the lock is set is a 409.
   */
  private assertUnlocked(entry: ProgressEntry, changes: Omit<UpdateEntryBody, 'expectedRevision'>): void {
    if (!isLockedUpdateRejected(entry.isLocked, changes)) return;
    throw new ConflictException({
      code: 'entry_locked',
      message: ENTRY_LOCKED_UPDATE_MESSAGE
    });
  }
}

/** Helper exposed for the imports module. */
export type WorkspaceRoleType = WorkspaceRole;
