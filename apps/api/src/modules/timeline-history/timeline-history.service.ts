import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type TimelineVersion, type User } from '@prisma/client';
import { newId } from '@syncpath/domain';
import { PrismaService } from '../../common/prisma/prisma.service';
import { toPublicEntry } from '../entries/dto';
import type { TimelineChange, TimelineSnapshot, TimelineVersionDetail, TimelineVersionPage, TimelineVersionSummary } from './dto';

const CARD_FIELDS = ['title', 'weekStartDate', 'level', 'summary', 'notes', 'status', 'isLocked', 'mentionAll', 'mentionedUserIds'] as const;
const TASK_FIELDS = ['name', 'description', 'startDate', 'endDate', 'visibility', 'status', 'color', 'holidayRegion', 'deletedAt'] as const;
export interface TimelineWriteContext { projectId: string; revision: number; before: TimelineSnapshot }

@Injectable()
export class TimelineHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /** All timeline writers take this lock before changing cards or settings.
   * Existing entry/project revision CAS still decides whether a draft is stale.
   * The separate counter serializes snapshots without invalidating task drafts.
   */
  async lock(tx: Prisma.TransactionClient, projectId: string): Promise<number> {
    // Acquire the parent first, matching workspace deletion's lock order.
    // Without this, a writer holding the project could block on a notification
    // FK while deletion held the workspace and waited for that same project.
    const parents = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT workspace.id FROM workspaces AS workspace
      JOIN projects AS project ON project.workspace_id = workspace.id
      WHERE project.id = ${projectId} AND project.deleted_at IS NULL AND workspace.deleted_at IS NULL
      FOR KEY SHARE OF workspace
    `;
    if (parents.length === 0) throw new NotFoundException({ code: 'project_not_found', message: 'Project not found or inaccessible.' });
    const rows = await tx.$queryRaw<Array<{ timeline_revision: number }>>`
      SELECT timeline_revision FROM projects WHERE id = ${projectId} AND deleted_at IS NULL FOR UPDATE
    `;
    if (rows.length === 0) throw new NotFoundException({ code: 'project_not_found', message: 'Project not found or inaccessible.' });
    return rows[0].timeline_revision;
  }

  async begin(tx: Prisma.TransactionClient, projectId: string): Promise<TimelineWriteContext> {
    const revision = await this.lock(tx, projectId);
    const before = await this.snapshot(tx, projectId);
    return { projectId, revision, before };
  }

  /** Remove every persisted copy of a permanently deleted card while retaining
   * the remaining cards' snapshots and changes. The caller holds the project
   * lock, so another writer cannot reintroduce a pre-deletion snapshot.
   */
  async removeEntry(tx: Prisma.TransactionClient, context: Pick<TimelineWriteContext, 'projectId' | 'revision'>, entryId: string): Promise<void> {
    await tx.timelineVersion.deleteMany({ where: { projectId: context.projectId, entryId } });
    await tx.$executeRaw`
      UPDATE timeline_versions
      SET snapshot = jsonb_set(snapshot, '{entries}', COALESCE(
        (SELECT jsonb_agg(card.value ORDER BY card.position)
         FROM jsonb_array_elements(snapshot->'entries') WITH ORDINALITY AS card(value, position)
         WHERE card.value->>'id' <> ${entryId}), '[]'::jsonb
      )), changes = COALESCE(
        (SELECT jsonb_agg(change.value ORDER BY change.position)
         FROM jsonb_array_elements(changes) WITH ORDINALITY AS change(value, position)
         WHERE NOT (change.value->>'entity' = 'card' AND change.value->>'entityId' = ${entryId})), '[]'::jsonb
      )
      WHERE project_id = ${context.projectId}
        AND (
          EXISTS (SELECT 1 FROM jsonb_array_elements(snapshot->'entries') AS card WHERE card->>'id' = ${entryId})
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(changes) AS change WHERE change->>'entity' = 'card' AND change->>'entityId' = ${entryId})
        )
    `;
    // Advance the counter without writing a deletion version that would retain
    // the removed card's title, fields, or identifier.
    await tx.project.update({ where: { id: context.projectId }, data: { timelineRevision: context.revision + 1 } });
  }

  async record(tx: Prisma.TransactionClient, context: TimelineWriteContext, user: Pick<User, 'id' | 'username' | 'displayName'>, action: string, entryId: string | null = null): Promise<void> {
    const after = await this.snapshot(tx, context.projectId);
    const changes = diffTimeline(context.before, after);
    if (changes.length === 0) return;
    const mentionChanges = changes.filter((change) => change.field === 'mentionedUserIds');
    if (mentionChanges.length > 0) {
      const ids = [...new Set(mentionChanges.flatMap((change) => [change.before, change.after].flatMap((value) => value ? JSON.parse(value) as string[] : [])))];
      const users = await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true, displayName: true } });
      const labels = new Map(users.map((member) => [member.id, member.displayName ? `${member.displayName} (@${member.username})` : `@${member.username}`]));
      for (const change of mentionChanges) for (const side of ['before', 'after'] as const) {
        change[side] = change[side] ? (JSON.parse(change[side]!) as string[]).map((id) => labels.get(id) ?? id).join(', ') : null;
      }
    }
    if (context.revision === 0 && !await tx.timelineVersion.findUnique({ where: { projectId_version: { projectId: context.projectId, version: 0 } } })) {
      await tx.timelineVersion.create({ data: {
        id: newId(), projectId: context.projectId, version: 0, action: 'baseline',
        actor: Prisma.DbNull, changes: [], snapshot: toJson(context.before)
      } });
    }
    const version = context.revision + 1;
    await tx.project.update({ where: { id: context.projectId }, data: { timelineRevision: version } });
    await tx.timelineVersion.create({ data: {
      id: newId(), projectId: context.projectId, version, action, entryId,
      actor: { id: user.id, username: user.username, displayName: user.displayName },
      changes: toJson(changes), snapshot: toJson(after)
    } });
  }

  async list(projectId: string, beforeVersion: number | undefined, limit: number): Promise<TimelineVersionPage> {
    const rows = await this.prisma.timelineVersion.findMany({
      where: { projectId, ...(beforeVersion === undefined ? {} : { version: { lt: beforeVersion } }) },
      orderBy: { version: 'desc' }, take: limit + 1,
      select: { id: true, projectId: true, version: true, createdAt: true, actor: true, action: true, entryId: true, changes: true }
    });
    const selected = rows.slice(0, limit);
    return { items: selected.map(summary), nextBeforeVersion: rows.length > limit ? selected[selected.length - 1].version : null };
  }

  async detail(projectId: string, id: string): Promise<TimelineVersionDetail> {
    const row = await this.prisma.timelineVersion.findFirst({ where: { id, projectId } });
    if (!row) throw new NotFoundException({ code: 'timeline_version_not_found', message: 'Timeline version not found or inaccessible.' });
    return { ...summary(row), snapshot: row.snapshot as unknown as TimelineSnapshot };
  }

  private async snapshot(tx: Prisma.TransactionClient, projectId: string): Promise<TimelineSnapshot> {
    const project = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
    const entries = await tx.progressEntry.findMany({ where: { projectId, deletedAt: null }, orderBy: [{ weekStartDate: 'asc' }, { id: 'asc' }] });
    return {
      project: {
        id: project.id, workspaceId: project.workspaceId, name: project.name, description: project.description,
        startDate: project.startDate.toISOString().slice(0, 10), endDate: project.endDate.toISOString().slice(0, 10),
        visibility: project.visibility, status: project.status, color: project.color, holidayRegion: project.holidayRegion,
        revision: project.revision, deletedAt: project.deletedAt?.toISOString() ?? null
      },
      entries: entries.map(toPublicEntry)
    };
  }
}

function toJson(value: unknown): Prisma.InputJsonValue { return value as Prisma.InputJsonValue; }
function summary(row: Omit<TimelineVersion, 'snapshot'>): TimelineVersionSummary {
  return { id: row.id, projectId: row.projectId, version: row.version, createdAt: row.createdAt.toISOString(), action: row.action,
    entryId: row.entryId, actor: row.actor as unknown as TimelineVersionSummary['actor'], changes: row.changes as unknown as TimelineChange[] };
}
function textValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}
export function diffTimeline(before: TimelineSnapshot, after: TimelineSnapshot): TimelineChange[] {
  const changes: TimelineChange[] = [];
  for (const field of TASK_FIELDS) {
    const old = textValue(before.project[field]); const next = textValue(after.project[field]);
    if (old !== next) changes.push({ entity: 'task', entityId: after.project.id, title: after.project.name, field, before: old, after: next });
  }
  const oldEntries = new Map(before.entries.map((entry) => [entry.id, entry]));
  const newEntries = new Map(after.entries.map((entry) => [entry.id, entry]));
  for (const id of new Set([...oldEntries.keys(), ...newEntries.keys()])) {
    const old = oldEntries.get(id); const next = newEntries.get(id);
    if (!old || !next) {
      changes.push({ entity: 'card', entityId: id, title: (next ?? old)!.title, field: !old ? 'created' : 'deleted', before: old?.title ?? null, after: next?.title ?? null });
      continue;
    }
    for (const field of CARD_FIELDS) {
      const oldValue = textValue(old[field]); const nextValue = textValue(next[field]);
      if (oldValue !== nextValue) changes.push({ entity: 'card', entityId: id, title: next.title, field, before: oldValue, after: nextValue });
    }
  }
  return changes;
}
