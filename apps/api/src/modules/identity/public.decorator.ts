import { SetMetadata } from '@nestjs/common';

/**
 * Marker metadata key used by {@link SessionAuthGuard} to skip auth.
 *
 * Usage:
 *   @Public()
 *   @Get('health')
 *   check() { ... }
 */
export const IS_PUBLIC_KEY = 'auth:isPublic';
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
