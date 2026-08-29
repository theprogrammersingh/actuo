import { Controller, Get, Query } from '@nestjs/common';
import type { AuditLogEntry, Page } from '@actuo/shared';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { AuditService } from './audit.service.js';
import { ListAuditQueryDto } from './dto/audit.dto.js';

/**
 * `GET /api/audit-log` — what changed in this organization (PRD §6.2).
 *
 * Owner/admin only, and deliberately narrower than `GET /api/tool-calls`, which
 * every role may read. This one spans *other people's* actions across the whole
 * org: a member seeing who filed and who approved what is a different
 * disclosure from a member seeing which tools an agent ran.
 *
 * Read-only by design. Nothing writes through HTTP — entries are appended by
 * the service that made the change, so a row cannot be forged by a client.
 */
@Controller('audit-log')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Roles('owner', 'admin')
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListAuditQueryDto,
  ): Promise<Page<AuditLogEntry>> {
    return this.audit.list(user, query);
  }
}
