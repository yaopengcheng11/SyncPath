import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException
} from '@nestjs/common';
import type { User } from '@prisma/client';

/**
 * Extracts the authenticated user attached to the request by {@link AuthGuard}.
 *
 * Usage:  @CurrentUser() user: User
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): User => {
    const req = ctx.switchToHttp().getRequest<{ user?: User }>();
    if (!req.user) {
      throw new UnauthorizedException({
        code: 'no_session',
        message: 'Authentication required.'
      });
    }
    return req.user;
  }
);
