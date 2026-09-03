import { fileURLToPath } from 'node:url';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { HealthController } from './health/health.controller.js';
import { ConfigController } from './config/config.controller.js';
import { AuditModule } from './audit/audit.module.js';
import { SupabaseModule } from './supabase/supabase.module.js';
import { AuthModule } from './auth/auth.module.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { RolesGuard } from './auth/roles.guard.js';
import { RateLimitGuard } from './common/rate-limit.guard.js';
import { ExpensesModule } from './expenses/expenses.module.js';
import { BudgetsModule } from './budgets/budgets.module.js';
import { ToolCallsModule } from './tool-calls/tool-calls.module.js';
import { OrgsModule } from './orgs/orgs.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';

/**
 * Absolute path to `backend/.env`.
 *
 * `envFilePath: '.env'` resolves against `process.cwd()`, which silently ties
 * the service to being started from `backend/`. In the combined production
 * deploy the entry point is `node server.mjs` at the repo root, so the same
 * binary would find no env file and every database route would answer 503 —
 * a failure that looks like bad credentials rather than a wrong directory.
 *
 * Resolving from this module's own location instead works from any cwd. It
 * lands on `backend/.env` from both `dist/app.module.js` and
 * `src/app.module.ts`, since both sit one level below the package root.
 */
const ENV_FILE = fileURLToPath(new URL('../.env', import.meta.url));

/**
 * GUARD ORDER IS SIGNIFICANT.
 *
 * Nest runs APP_GUARDs in declaration order, so:
 *
 *   1. RateLimitGuard — cheapest, and must reject a flood *before* anything
 *      touches the database or spends argon2 cycles. Runs on `@Public()` auth
 *      routes too, which is precisely where the flooding happens.
 *   2. JwtAuthGuard   — establishes who the caller is. Global, so every route
 *      is authenticated unless it carries `@Public()`; forgetting a decorator
 *      fails closed.
 *   3. RolesGuard     — needs `req.user` from step 2 to look up the caller's
 *      membership role. No-ops on routes without `@Roles(...)`.
 *
 * Note what is NOT here: any Gemini or LLM module. The user's Gemini key lives
 * in the browser and never reaches this service (PRD §8.3, CLAUDE.md rule 2).
 * `/api/config` serves model *ids*, which are public strings.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ENV_FILE }),
    // Global: binds the repository tokens every feature module injects.
    SupabaseModule,
    AuthModule,
    ExpensesModule,
    BudgetsModule,
    ToolCallsModule,
    AuditModule,
    OrgsModule,
    ReportsModule,
    AnalyticsModule,
  ],
  controllers: [AppController, HealthController, ConfigController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
