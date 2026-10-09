import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { Session, User } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { newSessionId } from '@syncpath/domain';
import {
  generateSessionToken,
  hashToken,
  readSessionCookieOptions
} from '../../common/session/session';

@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    user: User,
    meta: { userAgent?: string; ipAddress?: string }
  ): Promise<{ session: Session; token: string; ttlDays: number }> {
    const { token, tokenHash } = generateSessionToken();
    const opts = readSessionCookieOptions();
    const expiresAt = new Date(
      Date.now() + opts.ttlDays * 24 * 60 * 60 * 1000
    );

    const session = await this.prisma.session.create({
      data: {
        id: newSessionId(),
        userId: user.id,
        tokenHash,
        userAgent: meta.userAgent ?? null,
        ipAddress: meta.ipAddress ?? null,
        expiresAt
      }
    });

    return { session, token, ttlDays: opts.ttlDays };
  }

  async resolve(token: string | undefined): Promise<Session | null> {
    if (!token) return null;
    const tokenHash = hashToken(token);
    const session = await this.prisma.session.findUnique({
      where: { tokenHash }
    });
    if (!session) return null;
    if (session.revokedAt) return null;
    if (session.expiresAt.getTime() < Date.now()) {
      return null;
    }
    return session;
  }

  async revoke(token: string | undefined): Promise<void> {
    if (!token) {
      throw new UnauthorizedException({
        code: 'no_session',
        message: 'No active session.'
      });
    }
    const tokenHash = hashToken(token);
    await this.prisma.session.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() }
    });
  }
}
