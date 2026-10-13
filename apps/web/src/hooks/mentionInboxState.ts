import type { PublicMentionNotification } from '@syncpath/api-client';

export interface MentionInboxSnapshot {
  items: PublicMentionNotification[];
  open: boolean;
  error: boolean;
  loading: boolean;
  unread: number;
}

interface MentionInboxDependencies {
  list: (signal: AbortSignal) => Promise<PublicMentionNotification[]>;
  markRead: (notificationId: string, signal: AbortSignal) => Promise<void>;
  onError?: (error: unknown) => void;
  now?: () => string;
}

/** One signed-in account owns this state, independently of the current view. */
export class MentionInboxState {
  private snapshot: MentionInboxSnapshot = { items: [], open: false, error: false, loading: false, unread: 0 };
  private listeners = new Set<() => void>();
  private active = false;
  private generation = 0;
  private readRevision = 0;
  private refreshRequested = false;
  private refreshPromise: Promise<void> | null = null;
  private controllers = new Set<AbortController>();
  private pendingReads = new Map<string, { readAt: string; promise: Promise<boolean> }>();

  constructor(private readonly dependencies: MentionInboxDependencies) {}

  getSnapshot = (): MentionInboxSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  start = (): void => {
    if (this.active) return;
    this.active = true;
    this.generation += 1;
    void this.refresh();
  };

  stop = (): void => {
    this.active = false;
    this.generation += 1;
    this.refreshRequested = false;
    this.refreshPromise = null;
    this.pendingReads.clear();
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    this.update({ items: [], open: false, error: false, loading: false });
  };

  setOpen = (open: boolean): void => {
    if (!this.active) return;
    this.update({ open });
  };

  toggle = (): void => {
    if (!this.active) return;
    const open = !this.snapshot.open;
    this.setOpen(open);
    if (open) void this.refresh();
  };

  refresh = (): Promise<void> => {
    if (!this.active) return Promise.resolve();
    this.refreshRequested = true;
    if (this.refreshPromise) return this.refreshPromise;
    const generation = this.generation;
    const request = this.drainRefresh(generation);
    this.refreshPromise = request;
    void request.finally(() => {
      if (this.generation === generation) this.refreshPromise = null;
    });
    return request;
  };

  markRead = (notificationId: string): Promise<boolean> => {
    if (!this.active) return Promise.resolve(false);
    const pending = this.pendingReads.get(notificationId);
    if (pending) return pending.promise;
    if (this.snapshot.items.find((item) => item.id === notificationId)?.readAt) return Promise.resolve(true);

    const generation = this.generation;
    const readAt = this.dependencies.now?.() ?? new Date().toISOString();
    const controller = new AbortController();
    this.controllers.add(controller);
    this.readRevision += 1;
    this.update({ items: this.snapshot.items.map((item) => item.id === notificationId ? { ...item, readAt } : item) });
    const request = this.commitRead(notificationId, controller, generation);
    this.pendingReads.set(notificationId, { readAt, promise: request });
    return request;
  };

  private isCurrent(generation: number): boolean {
    return this.active && this.generation === generation;
  }

  private update(patch: Partial<Omit<MentionInboxSnapshot, 'unread'>>): void {
    const next = { ...this.snapshot, ...patch };
    this.snapshot = { ...next, unread: next.items.filter((item) => item.readAt === null).length };
    for (const listener of this.listeners) listener();
  }

  private async drainRefresh(generation: number): Promise<void> {
    while (this.isCurrent(generation) && this.refreshRequested) {
      this.refreshRequested = false;
      const readRevision = this.readRevision;
      const controller = new AbortController();
      this.controllers.add(controller);
      const timeout = globalThis.setTimeout(() => controller.abort(), 10_000);
      this.update({ loading: true });
      try {
        const items = await this.waitForRequest(controller, Promise.resolve().then(() => this.dependencies.list(controller.signal)));
        if (!this.isCurrent(generation)) return;
        // A response started before a read mutation cannot overwrite its result.
        if (readRevision !== this.readRevision) {
          this.refreshRequested = true;
          continue;
        }
        this.update({
          items: items.map((item) => {
            const pending = this.pendingReads.get(item.id);
            return pending ? { ...item, readAt: pending.readAt } : item;
          }),
          error: false
        });
      } catch (error) {
        if (!this.isCurrent(generation)) return;
        this.update({ items: [], error: true });
        this.dependencies.onError?.(error);
      } finally {
        globalThis.clearTimeout(timeout);
        this.controllers.delete(controller);
        if (this.isCurrent(generation)) this.update({ loading: false });
      }
    }
  }

  private async commitRead(notificationId: string, controller: AbortController, generation: number): Promise<boolean> {
    const timeout = globalThis.setTimeout(() => controller.abort(), 10_000);
    try {
      await this.waitForRequest(controller, Promise.resolve().then(() => this.dependencies.markRead(notificationId, controller.signal)));
    } catch (error) {
      if (!this.isCurrent(generation)) return false;
      this.update({ items: [], error: true });
      this.dependencies.onError?.(error);
    } finally {
      globalThis.clearTimeout(timeout);
      this.controllers.delete(controller);
      if (this.isCurrent(generation)) {
        this.pendingReads.delete(notificationId);
        this.readRevision += 1;
        void this.refresh();
      }
    }
    return this.isCurrent(generation);
  }

  private waitForRequest<T>(controller: AbortController, request: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => { reject(new DOMException('Notification request was cancelled.', 'AbortError')); };
      controller.signal.addEventListener('abort', onAbort, { once: true });
      if (controller.signal.aborted) onAbort();
      request.then(resolve, reject).finally(() => { controller.signal.removeEventListener('abort', onAbort); });
    });
  }
}
