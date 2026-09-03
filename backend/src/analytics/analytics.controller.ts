import { Controller, Get, Query } from '@nestjs/common';
import type { AnalyticsSummary } from '@actuo/shared';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { AnalyticsService } from './analytics.service.js';
import { AnalyticsQueryDto } from './dto/analytics.dto.js';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /**
   * `GET /api/analytics/summary` — month-over-month spend summary.
   *
   * Readable by every role: a member needs visibility into team spend trends.
   * Returns aggregates, not individual expense rows.
   */
  @Get('summary')
  @Roles('owner', 'admin', 'member')
  summary(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AnalyticsQueryDto,
  ): Promise<AnalyticsSummary> {
    return this.analytics.summary(user, query);
  }
}
