import type { PublicEntry, PublicProject } from '@syncpath/api-client';
import type { Project, WorkLog } from '../types';

export type SharedContentSource =
  | { kind: 'token'; token: string }
  | { kind: 'receipt'; receiptId: string };

export type ShareRoute =
  | { kind: 'home' }
  | { kind: 'received-list' }
  | { kind: 'shared'; source: SharedContentSource };

/** Hash routing keeps an external sharing token out of server access logs. */
export function parseShareRoute(hash: string): ShareRoute {
  if (hash === '#/received-shares' || hash === '#/received-shares/') return { kind: 'received-list' };
  const routes = [
    { prefix: '#/share/', kind: 'token' },
    { prefix: '#/received-share/', kind: 'receipt' }
  ] as const;
  for (const route of routes) {
    if (!hash.startsWith(route.prefix)) continue;
    let value = hash.slice(route.prefix.length);
    try { value = decodeURIComponent(value); } catch { value = ''; }
    return { kind: 'shared', source: route.kind === 'token' ? { kind: 'token', token: value } : { kind: 'receipt', receiptId: value } };
  }
  return { kind: 'home' };
}

export function receivedShareHash(receiptId: string): string {
  return `#/received-share/${encodeURIComponent(receiptId)}`;
}

export function sharedContentScope(userId: string, source: SharedContentSource): string {
  return JSON.stringify([userId, source.kind, source.kind === 'token' ? source.token : source.receiptId]);
}

export function createShareUrl(token: string, base: string): string {
  const url = new URL(base);
  url.search = '';
  url.hash = `/share/${encodeURIComponent(token)}`;
  return url.toString();
}

export function sharedProjectToTimeline(project: PublicProject): Project {
  return { id: project.id, name: project.name, description: project.description ?? '', startDate: project.startDate, endDate: project.endDate, color: project.color, holidayRegion: 'NONE', revision: project.revision };
}

export function sharedEntriesToLogs(entries: PublicEntry[], projectId: string): Record<string, WorkLog[]> {
  const logs: Record<string, WorkLog[]> = {};
  for (const entry of entries) {
    if (entry.projectId !== projectId) continue;
    const log: WorkLog = {
      id: entry.id, author: entry.title, level: entry.level === 'primary' ? 1 : entry.level === 'secondary' ? 2 : 3,
      weekStartDate: entry.weekStartDate, summary: entry.summary ?? '', notes: entry.notes ?? '', goals: [],
      status: entry.status, isLocked: entry.isLocked, revision: entry.revision,
      createdAt: Date.parse(entry.createdAt), updatedAt: Date.parse(entry.updatedAt)
    };
    (logs[entry.weekStartDate] ??= []).push(log);
  }
  return logs;
}

export type SharedContentError = 'signin' | 'unavailable' | 'network';

export function classifySharedContentError(error: unknown): SharedContentError {
  const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
  if (status === 401) return 'signin';
  if (status === 403 || status === 404) return 'unavailable';
  return 'network';
}

/** Serial polling ensures a slow response cannot race a newer revocation result. */
export function startSharedContentPolling<T>(options: {
  load: (signal: AbortSignal) => Promise<T>;
  onData: (data: T) => void;
  onError: (error: unknown) => void;
  onBusy?: (busy: boolean) => void;
  intervalMs?: number;
  timeoutMs?: number;
}): { refresh: () => void; stop: () => void } {
  let active = true;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;

  const refresh = async (): Promise<void> => {
    if (!active || running) return;
    if (timer !== undefined) clearTimeout(timer);
    running = true;
    controller = new AbortController();
    options.onBusy?.(true);
    const signal = controller.signal;
    try {
      const timeout = new Promise<never>((_, reject) => {
        deadline = setTimeout(() => {
          controller?.abort();
          reject(new Error('Shared content request timed out'));
        }, options.timeoutMs ?? 10_000);
      });
      const result = await Promise.race([options.load(signal), timeout]);
      if (active && !signal.aborted) options.onData(result);
    } catch (error) {
      if (active) options.onError(error);
    } finally {
      if (deadline !== undefined) clearTimeout(deadline);
      deadline = undefined;
      running = false;
      if (active) {
        options.onBusy?.(false);
        timer = setTimeout(() => { void refresh(); }, options.intervalMs ?? 3_000);
      }
    }
  };
  void refresh();
  return {
    refresh: () => { void refresh(); },
    stop: () => {
      active = false;
      if (timer !== undefined) clearTimeout(timer);
      if (deadline !== undefined) clearTimeout(deadline);
      controller?.abort();
    }
  };
}
