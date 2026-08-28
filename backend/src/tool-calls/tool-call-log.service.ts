import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Page, ToolCallLogEntry } from '@actuo/shared';
import {
  TOOL_CALL_LOG_REPOSITORY,
  type ToolCallLogRepository,
} from '../supabase/repositories.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { AppendToolCallDto, ListToolCallsQueryDto } from './dto/tool-call.dto.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * The `tool_call_log` write path (PRD §8.7).
 *
 * Every WebMCP tool invocation lands here — whether a human clicked the button
 * or the Copilot called the tool — which makes this both the audit trail and
 * the demo artifact ("here is everything the agent did this session").
 *
 * The frontend's `ToolRegistry` is the single choke point that calls
 * `POST /api/tool-calls`; other backend services can call `append()` directly.
 */
@Injectable()
export class ToolCallLogService {
  private readonly logger = new Logger(ToolCallLogService.name);

  constructor(
    @Inject(TOOL_CALL_LOG_REPOSITORY) private readonly repo: ToolCallLogRepository,
  ) {}

  /**
   * Appends one entry.
   *
   * `orgId` and `actorId` come from the verified session, never from the body:
   * a client that could name its own org would be able to write into another
   * tenant's audit trail.
   *
   * NOTE: nothing here touches an LLM, and no field carries an API key. The
   * `input`/`output` payloads are tool arguments and tool results — they are
   * the record of a call the *browser* already made. If a future change makes
   * this service reach out to Gemini, that is the bug CLAUDE.md rule 2 exists
   * to prevent.
   */
  append(user: AuthenticatedUser, dto: AppendToolCallDto): Promise<ToolCallLogEntry> {
    return this.repo.append({
      orgId: user.orgId,
      actorId: user.userId,
      actor: dto.actor,
      toolName: dto.toolName,
      input: dto.input ?? null,
      output: dto.output ?? null,
    });
  }

  /**
   * Fire-and-forget variant for internal callers.
   *
   * A failed log write must never fail the action it describes — the point of
   * the log is observability, and turning it into a new failure mode would
   * make the app less reliable than having no log at all.
   */
  async appendQuietly(
    user: AuthenticatedUser,
    dto: AppendToolCallDto,
  ): Promise<ToolCallLogEntry | null> {
    try {
      return await this.append(user, dto);
    } catch (error) {
      this.logger.warn(
        `tool_call_log write failed for ${dto.toolName}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /** Recent entries for the caller's org, newest first, filterable by actor. */
  list(user: AuthenticatedUser, query: ListToolCallsQueryDto): Promise<Page<ToolCallLogEntry>> {
    return this.repo.list(user.orgId, {
      actor: query.actor,
      limit: Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT),
      offset: query.offset ?? 0,
    });
  }
}
