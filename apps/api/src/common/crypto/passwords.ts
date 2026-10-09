import * as bcrypt from 'bcryptjs';

/**
 * Password hashing helpers.
 *
 * Source of truth: docs §4.4 ("使用服务器会话与成熟密码哈希库"). bcryptjs is
 * pure JS and avoids the node-gyp build of native bcrypt; performance is
 * sufficient for a single-instance R0/R1 demo. Switch to `argon2` in R2 if
 * load testing warrants it.
 */
const ROUNDS = 12;

export async function hashPassword(plaintext: string): Promise<string> {
  if (!plaintext || plaintext.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  return bcrypt.hash(plaintext, ROUNDS);
}

export async function verifyPassword(
  plaintext: string,
  hash: string
): Promise<boolean> {
  if (!plaintext || !hash) return false;
  return bcrypt.compare(plaintext, hash);
}
