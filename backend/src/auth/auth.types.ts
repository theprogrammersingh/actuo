import type { Role } from '@actuo/shared';

/**
 * What `JwtAuthGuard` attaches to the request, and what `@CurrentUser()` hands
 * a controller.
 *
 * `role` is deliberately optional and deliberately NOT read from the token.
 * It is filled in by `RolesGuard` from the `memberships` table on the requests
 * that need it (CLAUDE.md rule 5: never trust a client role claim). A handler
 * that must branch on role should be behind `@Roles(...)`, which guarantees
 * the field is populated.
 */
export interface AuthenticatedUser {
  userId: string;
  orgId: string;
  email: string;
  role?: Role;
}

/** Claims carried by the access token. */
export interface AccessTokenPayload {
  sub: string;
  email: string;
  org: string;
  typ: 'access';
}

/** Claims carried by the refresh token. `jti` is the rotation handle. */
export interface RefreshTokenPayload {
  sub: string;
  org: string;
  jti: string;
  typ: 'refresh';
}
