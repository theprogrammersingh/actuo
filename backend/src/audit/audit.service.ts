import { Inject, Injectable } from '@nestjs/common';
import type { AuditLogEntry, Page } from '@actuo/shared';
import { AUDIT_LOG_REPOSITORY, type AuditLogRepository } from '../supabase/repositories.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { ListAuditQueryDto } from './dto/audit.dto.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * The `audit_log` read path (PRD §6.2).
 *
 * The table has been written on every mutation since the start and had no
 * reader at all, so "who changed what, when" was recorded and then invisible.
 * Writing stays where the change happens — `ExpensesService` and `AuthService`
 * append directly through the repository — because an audit row that can be
 * forgotten by a caller is worse than none.
 *
 * Not to be confused with `tool_call_log`, which records *WebMCP tool
 * invocations*. This one records *state changes*, whoever caused them.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(AUDIT_LOG_REPOSITORY) private readonly repo: AuditLogRepository) {}

  /**
   * Recent entries for the caller's org, newest first.
   *
   * `orgId` comes from the verified session and is never a parameter: this
   * endpoint spans everybody's actions, so a client that could name its own org
   * would be reading another tenant's history.
   */
  list(user: AuthenticatedUser, query: ListAuditQueryDto): Promise<Page<AuditLogEntry>> {
    return this.repo.list(user.orgId, {
      entity: query.entity,
      limit: Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT),
      offset: query.offset ?? 0,
    });
  }
}
