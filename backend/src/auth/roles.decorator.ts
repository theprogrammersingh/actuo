import { SetMetadata } from '@nestjs/common';
import type { Role } from '@actuo/shared';

export const ROLES_KEY = 'actuo:roles';

/**
 * Restricts a route to the listed roles, e.g. `@Roles('owner', 'admin')`.
 *
 * `RolesGuard` reads this and resolves the caller's actual role from the
 * `memberships` table for the org in their access token. The list here is the
 * *allowed* set; roles are flat, not ranked, so an owner-only route must say
 * `@Roles('owner')` and an approval route must say `@Roles('owner', 'admin')`.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
