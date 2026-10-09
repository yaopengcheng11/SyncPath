// Stable ID generators for the domain layer.
//
// Source of truth: docs/SYNCPATH_DEVELOPMENT_FRAMEWORK_ACCEPTANCE.md §6.1
// ("统一约定：UUID 标识；分页使用 cursor；日期 ISO 格式").
//
// We use UUIDv7 (time-ordered) where available so that primary-key order
// matches insertion order on disk. Falls back to UUIDv4 in runtimes that
// lack the crypto.randomUUID version field.

export type Brand<T, B extends string> = T & { readonly __brand: B };

export type UserId = Brand<string, 'UserId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type WorkspaceId = Brand<string, 'WorkspaceId'>;
export type MembershipId = Brand<string, 'MembershipId'>;
export type ProjectId = Brand<string, 'ProjectId'>;
export type ProjectMemberId = Brand<string, 'ProjectMemberId'>;
export type ProgressEntryId = Brand<string, 'ProgressEntryId'>;
export type CommentId = Brand<string, 'CommentId'>;

interface WebCryptoLike {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  randomUUID?(): string;
}

function webCrypto(): WebCryptoLike | undefined {
  const g: { crypto?: WebCryptoLike } = globalThis as unknown as {
    crypto?: WebCryptoLike;
  };
  return g.crypto;
}

/**
 * Generate a UUIDv7 (time-ordered) when the runtime supports it, else
 * UUIDv4. Returns a lowercase hex string with dashes — no `Brand` wrapper
 * applied; callers cast as needed.
 */
export function newId(): string {
  const c = webCrypto();
  if (c && typeof c.randomUUID === 'function') {
    return uuidV7Like(c);
  }
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return formatUuid(bytes);
}

function uuidV7Like(c: WebCryptoLike): string {
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  const ts = Date.now();
  bytes[0] = (ts / 2 ** 40) & 0xff;
  bytes[1] = (ts / 2 ** 32) & 0xff;
  bytes[2] = (ts / 2 ** 24) & 0xff;
  bytes[3] = (ts / 2 ** 16) & 0xff;
  bytes[4] = (ts / 2 ** 8) & 0xff;
  bytes[5] = ts & 0xff;
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return formatUuid(bytes);
}

function formatUuid(bytes: Uint8Array): string {
  const hex: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    hex.push(bytes[i].toString(16).padStart(2, '0'));
  }
  return (
    hex.slice(0, 4).join('') + '-' +
    hex.slice(4, 6).join('') + '-' +
    hex.slice(6, 8).join('') + '-' +
    hex.slice(8, 10).join('') + '-' +
    hex.slice(10, 16).join('')
  );
}

export const newUserId = (): UserId => newId() as UserId;
export const newSessionId = (): SessionId => newId() as SessionId;
export const newWorkspaceId = (): WorkspaceId => newId() as WorkspaceId;
export const newMembershipId = (): MembershipId => newId() as MembershipId;
export const newProjectId = (): ProjectId => newId() as ProjectId;
export const newProjectMemberId = (): ProjectMemberId =>
  newId() as ProjectMemberId;
export const newProgressEntryId = (): ProgressEntryId =>
  newId() as ProgressEntryId;
export const newCommentId = (): CommentId => newId() as CommentId;
