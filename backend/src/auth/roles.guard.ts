import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@actuo/shared';
import { ORG_REPOSITORY, type OrgRepository } from '../supabase/repositories.js';
import { ROLES_KEY } from './roles.decorator.js';
import type { AuthenticatedUser } from './auth.types.js';

/**
 * Server-side RBAC (CLAUDE.md rule 5 / PRD §9).
 *
 * The caller's role is read from the `memberships` table for the org in their
 * verified access token. It is never taken from the request body, a header, or
 * a token claim — a role claim the client can influence is not a permission
 * check, it is a suggestion.
 *
 * Registered globally alongside JwtAuthGuard, but it only does work on routes
 * that actually carry `@Roles(...)`; unannotated routes skip the membership
 * lookup entirely, so this costs nothing on the read-heavy paths.
 *
 * Roles are flat, not hierarchical: `@Roles('owner', 'admin')` must list both.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ORG_REPOSITORY) private readonly orgs: OrgRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;
    if (!user) {
      // Reachable only if a route is both @Public() and @Roles() — a coding
      // error. Refuse rather than silently allowing.
      throw new UnauthorizedException('Authentication required.');
    }

    const membership = await this.orgs.findMembership(user.userId, user.orgId);
    if (!membership) {
      // Authenticated, but not a member of the org they claim. Treated as a
      // forbidden action rather than a 404 so the tenancy failure is visible
      // in logs instead of looking like a missing route.
      throw new ForbiddenException('You are not a member of this organization.');
    }

    if (!required.includes(membership.role)) {
      throw new ForbiddenException(
        `This action requires one of: ${required.join(', ')}. Your role is ${membership.role}.`,
      );
    }

    // Hand the verified role downstream so services can branch on it without
    // repeating the lookup.
    user.role = membership.role;
    return true;
  }
}
