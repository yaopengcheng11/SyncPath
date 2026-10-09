import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicEntry } from '@syncpath/api-client';
import { classifySharedContentError, createShareUrl, sharedEntriesToLogs, startSharedContentPolling } from './sharedContentState';

const entry = (id: string, projectId: string): PublicEntry => ({
  id, projectId, authorId: 'author', weekStartDate: '2026-10-05', title: `Card ${id}`,
  level: 'secondary', summary: 'Summary', notes: 'Notes', status: 'completed', isLocked: true,
  mentionAll: false, mentionedUserIds: [], revision: 3, createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T01:00:00.000Z'
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

afterEach(() => { vi.useRealTimers(); });

describe('read-only sharing state', () => {
  it('builds a LAN URL with the deployment path and removes unrelated query parameters', () => {
    expect(createShareUrl('abc_123-xyz', 'http://192.168.1.18:5183/syncpath/?debug=1#dashboard')).toBe('http://192.168.1.18:5183/syncpath/#/share/abc_123-xyz');
    expect(createShareUrl('token', 'http://localhost:5183/')).toBe('http://localhost:5183/#/share/token');
  });

  it('only supplies entries belonging to the selected task to the timeline', () => {
    const logs = sharedEntriesToLogs([entry('a', 'task-a'), entry('b', 'task-b')], 'task-a');
    expect(Object.values(logs).flat()).toHaveLength(1);
    expect(logs['2026-10-05'][0]).toMatchObject({ id: 'a', author: 'Card a', level: 2, status: 'completed', isLocked: true, revision: 3, summary: 'Summary', notes: 'Notes' });
  });

  it('maps expired sessions and disabled shares to clear actionable states', () => {
    expect(classifySharedContentError({ status: 401 })).toBe('signin');
    expect(classifySharedContentError({ status: 403 })).toBe('unavailable');
    expect(classifySharedContentError({ status: 404 })).toBe('unavailable');
    expect(classifySharedContentError({ status: 0 })).toBe('network');
    expect(classifySharedContentError(new Error('timeout'))).toBe('network');
  });

  it('serializes polling and refreshes, then reports revocation without another success callback', async () => {
    vi.useFakeTimers();
    const first = deferred<string>();
    const second = deferred<string>();
    const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const onData = vi.fn();
    const onError = vi.fn();
    const poller = startSharedContentPolling({ load, onData, onError });
    poller.refresh(); poller.refresh();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(load).toHaveBeenCalledTimes(1);
    first.resolve('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(onData).toHaveBeenCalledWith('visible');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(load).toHaveBeenCalledTimes(2);
    second.reject({ status: 404 });
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledWith({ status: 404 });
    expect(onData).toHaveBeenCalledTimes(1);
    poller.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('aborts the old request and ignores late results after the user or share changes', async () => {
    vi.useFakeTimers();
    const pending = deferred<string>();
    const load = vi.fn().mockReturnValue(pending.promise);
    const onData = vi.fn();
    const onError = vi.fn();
    const poller = startSharedContentPolling({ load, onData, onError });
    const signal = load.mock.calls[0][0] as AbortSignal;
    poller.stop();
    expect(signal.aborted).toBe(true);
    pending.resolve('old private content');
    await vi.advanceTimersByTimeAsync(0);
    expect(onData).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    poller.refresh();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('aborts hung requests after the deadline and cannot restore their late content', async () => {
    vi.useFakeTimers();
    const pending = deferred<string>();
    const load = vi.fn().mockReturnValue(pending.promise);
    const onData = vi.fn();
    const onError = vi.fn();
    const poller = startSharedContentPolling({ load, onData, onError, timeoutMs: 1_000 });
    const signal = load.mock.calls[0][0] as AbortSignal;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(signal.aborted).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);
    pending.resolve('stale content');
    await vi.advanceTimersByTimeAsync(0);
    expect(onData).not.toHaveBeenCalled();
    poller.stop();
  });
});
