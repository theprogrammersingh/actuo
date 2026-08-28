import { Controller, Get, Inject, NotFoundException } from '@nestjs/common';
import type { Category, Organization } from '@actuo/shared';
import { ORG_REPOSITORY, type OrgMember, type OrgRepository } from '../supabase/repositories.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';

/**
 * The minimum org surface the rest of the app needs to function.
 *
 * Everything is scoped to `current` — the org in the caller's access token —
 * rather than PRD §8.6's `/orgs/:id/...`. With one active org per session, an
 * `:id` in the path is a parameter the server must then prove the caller may
 * use, which is a tenancy check waiting to be forgotten. `current` cannot be
 * pointed at another tenant at all.
 *
 * Invites (`POST /orgs/:id/invite`) are not implemented — see the module note.
 */
@Controller('orgs')
export class OrgsController {
  constructor(@Inject(ORG_REPOSITORY) private readonly orgs: OrgRepository) {}

  @Roles('owner', 'admin', 'member')
  @Get('current')
  async current(@CurrentUser() user: AuthenticatedUser): Promise<Organization> {
    const org = await this.orgs.findOrg(user.orgId);
    if (!org) throw new NotFoundException('Organization not found.');
    return org;
  }

  /** Powers the category picker on the expense form and the budget editor. */
  @Roles('owner', 'admin', 'member')
  @Get('current/categories')
  categories(@CurrentUser() user: AuthenticatedUser): Promise<Category[]> {
    return this.orgs.listCategories(user.orgId);
  }

  /** Admin-only: the member list exposes every colleague's email address. */
  @Roles('owner', 'admin')
  @Get('current/members')
  members(@CurrentUser() user: AuthenticatedUser): Promise<OrgMember[]> {
    return this.orgs.listMembers(user.orgId);
  }
}
