import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from './auth.types.js';

/**
 * Injects the authenticated caller into a handler parameter.
 *
 *   @Get()
 *   list(@CurrentUser() user: AuthenticatedUser) { ... }
 *
 * The value comes from `JwtAuthGuard`, which verifies the token signature
 * server-side. Controllers must take `orgId` and `userId` from here and never
 * from the request body or a query parameter — that is the whole tenancy
 * boundary in one sentence.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    return ctx.switchToHttp().getRequest().user as AuthenticatedUser;
  },
);
