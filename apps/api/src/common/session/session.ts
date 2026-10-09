import * as crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Session cookie utilities.
 *
 * Design notes (docs §4.4 + §6.1):
 *   - Cookie name configurable via SESSION_COOKIE_NAME.
 *   - HttpOnly always; Secure when COOKIE_SECURE=true (any non-dev env).
 *   - SameSite=Lax so cross-origin form posts still work in the future;
 *     for an SPA-only API we could safely set SameSite=Strict.
 *   - Token is 32 random bytes, base64url-encoded; the database stores the
 *     SHA-256 of the token, not the token itself, so a DB leak does not
 *     yield active session credentials.
 */

export const DEFAULT_COOKIE_NAME = 'syncpath_session';
export const DEFAULT_TTL_DAYS = 30;

export interface SessionCookieOptions {
  name: string;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  ttlDays: number;
}

export function readSessionCookieOptions(): SessionCookieOptions {
  return {
    name: process.env.SESSION_COOKIE_NAME ?? DEFAULT_COOKIE_NAME,
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: (process.env.COOKIE_SAMESITE as
      | 'lax'
      | 'strict'
      | 'none'
      | undefined) ?? 'lax',
    ttlDays: Number(process.env.SESSION_TTL_DAYS ?? DEFAULT_TTL_DAYS)
  };
}

/** Generate a fresh opaque session token. */
export function generateSessionToken(): { token: string; tokenHash: string } {
  const buf = crypto.randomBytes(32);
  const token = buf.toString('base64url');
  const tokenHash = hashToken(token);
  return { token, tokenHash };
}

/** Hash a token for storage. Constant-time compare via SHA-256 is fine here
 *  because the input is already random 256 bits. */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Read the session token from the request cookie, if present. */
export function readSessionToken(
  req: FastifyRequest,
  name: string
): string | undefined {
  const cookies = (req as unknown as { cookies?: Record<string, string> })
    .cookies;
  return cookies?.[name];
}

/** Set the session cookie on the reply. */
export function setSessionCookie(
  reply: FastifyReply,
  token: string,
  options: SessionCookieOptions
): void {
  reply.setCookie(options.name, token, {
    httpOnly: true,
    secure: options.secure,
    sameSite: options.sameSite,
    path: '/',
    maxAge: options.ttlDays * 24 * 60 * 60
  });
}

/** Clear the session cookie on logout. */
export function clearSessionCookie(
  reply: FastifyReply,
  name: string
): void {
  reply.clearCookie(name, { path: '/' });
}
