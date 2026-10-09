import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  readSessionCookieOptions,
  readSessionToken
} from '../../common/session/session';
import { SessionsService } from './sessions.service';
import { IS_PUBLIC_KEY } from './public.decorator';

declare module 'fastify' {
  interface FastifyRequest {
    user?: import('@prisma/client').User;
    session?: import('@prisma/client').Session;
  }
}

/**
 * Session cookie guard.
 *
 * Resolution chain:
 *   1. Read the session cookie (HttpOnly, base64url token).
 *   2. Look up the session by SHA-256 of the token.
 *   3. Reject if revoked or expired.
 *   4. Attach user + session to the request for downstream handlers.
 *
 * Anything that returns 401 here uses the standard error envelope
 * (code / message / requestId) per docs §6.1.
 *
 * Registered globally in AppModule (APP_GUARD). Use @Public() on a
 * controller or handler to opt out of authentication.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionsService,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const opts = readSessionCookieOptions();
    const token = readSessionToken(req, opts.name);
    if (!token) {
      throw new UnauthorizedException({
        code: 'no_session',
        message: 'Authentication required.'
      });
    }
    const session = await this.sessions.resolve(token);
    if (!session) {
      throw new UnauthorizedException({
        code: 'invalid_session',
        message: 'Session is invalid or expired.'
      });
    }
    const user = await this.prisma.user.findUnique({
      where: { id: session.userId }
    });
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException({
        code: 'user_inactive',
        message: 'User account is inactive.'
      });
    }
    req.user = user;
    req.session = session;
    return true;
  }
}
