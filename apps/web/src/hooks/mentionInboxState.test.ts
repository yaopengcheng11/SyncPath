import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicMentionNotification } from '@syncpath/api-client';
import { MentionInboxState } from './mentionInboxState';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const notification = (id: string, readAt: string | null = null): PublicMentionNotification => ({
  id, workspaceId: 'workspace',
  project: { id: 'task', name: 'Task' }, entry: { id: 'entry', title: 'Card', date: '2026-10-05' },
  actor: { id: 'author', username: 'colleague', displayName: 'Colleague' },
  createdAt: '2026-10-09T00:00:00.000Z', readAt
});

afterEach(() => { vi.useRealTimers(); });

describe('account-wide notification state', () => {
  it('shares items, open state, and unread counts between home and task consumers without another data source', async () => {
    const list = vi.fn().mockResolvedValue([notification('mention')]);
    const state = new MentionInboxState({ list, markRead: vi.fn().mockResolvedValue(undefined) });
    state.start();
    await vi.waitFor(() => { expect(state.getSnapshot().items).toHaveLength(1); });
    state.setOpen(true);
    const home = state.getSnapshot();
    const unsubscribe = state.subscribe(vi.fn());
    unsubscribe();
    const task = state.getSnapshot();
    expect(task).toBe(home);
    expect(task).toMatchObject({ unread: 1, open: true });
    expect(list).toHaveBeenCalledTimes(1);
    state.stop();
  });

  it('serializes refreshes and runs only one follow-up request for events received during a pending request', async () => {
    const first = deferred<PublicMentionNotification[]>();
    const second = deferred<PublicMentionNotification[]>();
    const list = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const state = new MentionInboxState({ list, markRead: vi.fn() });
    state.start();
    const completed = state.refresh();
    void state.refresh();
    await Promise.resolve();
    expect(list).toHaveBeenCalledTimes(1);
    first.resolve([notification('old')]);
    await vi.waitFor(() => { expect(list).toHaveBeenCalledTimes(2); });
    second.resolve([notification('new')]);
    await completed;
    expect(state.getSnapshot().items.map((item) => item.id)).toEqual(['new']);
    state.stop();
  });

  it('does not let a response begun before a successful read turn the same notification unread again', async () => {
    const stale = deferred<PublicMentionNotification[]>();
    const read = deferred<void>();
    const readAt = '2026-10-09T01:00:00.000Z';
    const list = vi.fn().mockResolvedValueOnce([notification('mention')]).mockReturnValueOnce(stale.promise).mockResolvedValue([notification('mention', readAt)]);
    const state = new MentionInboxState({ list, markRead: () => read.promise, now: () => readAt });
    state.start();
    await vi.waitFor(() => { expect(state.getSnapshot().unread).toBe(1); });
    const refresh = state.refresh();
    await Promise.resolve();
    const marked = state.markRead('mention');
    expect(state.getSnapshot().unread).toBe(0);
    read.resolve();
    expect(await marked).toBe(true);
    stale.resolve([notification('mention')]);
    await refresh;
    expect(state.getSnapshot().items[0].readAt).toBe(readAt);
    expect(state.getSnapshot().unread).toBe(0);
    state.stop();
  });

  it('aborts old-account requests, clears its snapshot, and ignores late results after a different account signs in', async () => {
    const oldRequest = deferred<PublicMentionNotification[]>();
    let oldSignal!: AbortSignal;
    const oldAccount = new MentionInboxState({ list: (signal) => { oldSignal = signal; return oldRequest.promise; }, markRead: vi.fn() });
    oldAccount.start();
    await Promise.resolve();
    oldAccount.stop();
    expect(oldSignal.aborted).toBe(true);
    const newAccount = new MentionInboxState({ list: vi.fn().mockResolvedValue([notification('new-account')]), markRead: vi.fn() });
    newAccount.start();
    await vi.waitFor(() => { expect(newAccount.getSnapshot().items).toHaveLength(1); });
    oldRequest.resolve([notification('old-account-private')]);
    await Promise.resolve();
    expect(oldAccount.getSnapshot()).toMatchObject({ items: [], unread: 0, open: false });
    expect(newAccount.getSnapshot().items[0].id).toBe('new-account');
    newAccount.stop();
  });

  it('clears cached content on an error and times out requests even when their implementation ignores cancellation', async () => {
    vi.useFakeTimers();
    const late = deferred<PublicMentionNotification[]>();
    let signal!: AbortSignal;
    const list = vi.fn().mockResolvedValueOnce([notification('mention')]).mockImplementationOnce((requestSignal: AbortSignal) => { signal = requestSignal; return late.promise; });
    const onError = vi.fn();
    const state = new MentionInboxState({ list, markRead: vi.fn(), onError });
    state.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.getSnapshot().items).toHaveLength(1);
    const refresh = state.refresh();
    await vi.advanceTimersByTimeAsync(10_000);
    await refresh;
    expect(signal.aborted).toBe(true);
    expect(state.getSnapshot()).toMatchObject({ items: [], error: true, unread: 0, loading: false });
    late.resolve([notification('late-private')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(state.getSnapshot().items).toEqual([]);
    expect(onError).toHaveBeenCalledTimes(1);
    state.stop();
  });

  it('deduplicates concurrent read clicks and prevents navigation after logout while that write was pending', async () => {
    const pending = deferred<void>();
    let signal!: AbortSignal;
    const markRead = vi.fn((_: string, requestSignal: AbortSignal) => { signal = requestSignal; return pending.promise; });
    const state = new MentionInboxState({ list: vi.fn().mockResolvedValue([notification('mention')]), markRead });
    state.start();
    await vi.waitFor(() => { expect(state.getSnapshot().unread).toBe(1); });
    const first = state.markRead('mention');
    expect(state.markRead('mention')).toBe(first);
    await Promise.resolve();
    expect(markRead).toHaveBeenCalledTimes(1);
    state.stop();
    expect(signal.aborted).toBe(true);
    expect(await first).toBe(false);
    pending.resolve();
    state.stop();
  });
});
