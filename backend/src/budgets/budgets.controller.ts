import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import type { Budget, BudgetStatus } from '@actuo/shared';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { BudgetsService } from './budgets.service.js';
import { BudgetStatusQueryDto, CreateBudgetDto, UpdateBudgetDto } from './dto/budget.dto.js';

@Controller('budgets')
export class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  /**
   * Declared before the plain `@Get()` for readability; unlike the expenses
   * controller there is no `:id` route here, so ordering is not load-bearing.
   *
   * Readable by every role: a member needs to see how much of the team budget
   * is left before filing, and this returns aggregates, not anyone's
   * individual expenses.
   */
  @Roles('owner', 'admin', 'member')
  @Get('status')
  status(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: BudgetStatusQueryDto,
  ): Promise<BudgetStatus[]> {
    return this.budgets.status(user, query);
  }

  @Roles('owner', 'admin', 'member')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<Budget[]> {
    return this.budgets.list(user);
  }

  /** Setting the budget is an administrative act (PRD §6.9). */
  @Roles('owner', 'admin')
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBudgetDto,
  ): Promise<Budget> {
    return this.budgets.create(user, dto);
  }

  @Roles('owner', 'admin')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateBudgetDto,
  ): Promise<Budget> {
    return this.budgets.update(user, id, dto);
  }
}
