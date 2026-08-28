import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import type { Page, ToolCallLogEntry } from '@actuo/shared';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { ToolCallLogService } from './tool-call-log.service.js';
import { AppendToolCallDto, ListToolCallsQueryDto } from './dto/tool-call.dto.js';

/**
 * `GET /api/tool-calls?actor=agent` powers the Copilot debug panel and the
 * audit-log viewer (PRD §6.9). `POST` is what the frontend `ToolRegistry`
 * calls after every tool execution.
 */
@Controller('tool-calls')
export class ToolCallsController {
  constructor(private readonly toolCalls: ToolCallLogService) {}

  @Roles('owner', 'admin', 'member')
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListToolCallsQueryDto,
  ): Promise<Page<ToolCallLogEntry>> {
    return this.toolCalls.list(user, query);
  }

  @Roles('owner', 'admin', 'member')
  @Post()
  append(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AppendToolCallDto,
  ): Promise<ToolCallLogEntry> {
    return this.toolCalls.append(user, dto);
  }
}
