import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { Expense, Page } from '@actuo/shared';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { ExpensesService } from './expenses.service.js';
import {
  CreateExpenseDto,
  DecisionDto,
  SearchExpensesQueryDto,
  UpdateExpenseDto,
} from './dto/expense.dto.js';

/**
 * PRD §8.6. All paths are under the global `/api` prefix.
 *
 * Every route carries `@Roles(...)`, including the ones every role may reach.
 * That is deliberate: `RolesGuard` only performs the membership lookup when the
 * decorator is present, so annotating a route is what guarantees
 * `user.role` is populated and verified against the database. A route without
 * it would reach the service with an undefined role, and the service fails
 * closed on that — noisily, but late.
 */
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  /**
   * DECLARATION ORDER IS LOAD-BEARING.
   *
   * `search` must be declared before `:id`, or Express matches
   * `GET /api/expenses/search` against the `:id` route and the request fails
   * as an invalid UUID instead of searching.
   */
  @Roles('owner', 'admin', 'member')
  @Get('search')
  search(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SearchExpensesQueryDto,
  ): Promise<Page<Expense>> {
    return this.expenses.list(user, query);
  }

  @Roles('owner', 'admin', 'member')
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SearchExpensesQueryDto,
  ): Promise<Page<Expense>> {
    return this.expenses.list(user, query);
  }

  @Roles('owner', 'admin', 'member')
  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<Expense> {
    return this.expenses.findOne(user, id);
  }

  @Roles('owner', 'admin', 'member')
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateExpenseDto,
  ): Promise<Expense> {
    return this.expenses.create(user, dto);
  }

  @Roles('owner', 'admin', 'member')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateExpenseDto,
  ): Promise<Expense> {
    return this.expenses.update(user, id, dto);
  }

  /** Soft delete — the row stays for the audit trail (PRD §6.2). */
  @Roles('owner', 'admin', 'member')
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<{ id: string; deleted: true }> {
    return this.expenses.remove(user, id);
  }

  // --- state machine (PRD §6.4) --------------------------------------------

  @Roles('owner', 'admin', 'member')
  @HttpCode(HttpStatus.OK)
  @Post(':id/submit')
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<Expense> {
    return this.expenses.transition(user, id, 'submit', null);
  }

  /**
   * Approver-only. The `@Roles` list here is the RBAC boundary the e2e test
   * pins: a `member` gets 403 before the handler runs.
   */
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.OK)
  @Post(':id/approve')
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: DecisionDto,
  ): Promise<Expense> {
    return this.expenses.transition(user, id, 'approve', dto.comment ?? null);
  }

  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.OK)
  @Post(':id/reject')
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: DecisionDto,
  ): Promise<Expense> {
    return this.expenses.transition(user, id, 'reject', dto.comment ?? null);
  }

  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.OK)
  @Post(':id/reimburse')
  reimburse(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<Expense> {
    return this.expenses.transition(user, id, 'reimburse', null);
  }

  /** rejected -> draft, so a rejected expense can be corrected and resubmitted. */
  @Roles('owner', 'admin', 'member')
  @HttpCode(HttpStatus.OK)
  @Post(':id/rework')
  rework(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<Expense> {
    return this.expenses.transition(user, id, 'rework', null);
  }
}
