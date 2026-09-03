import { Global, Module } from '@nestjs/common';
import { EnvService } from '../config/env.service.js';
import { SupabaseService } from './supabase.service.js';
import {
  AUDIT_LOG_REPOSITORY,
  BUDGET_REPOSITORY,
  EXPENSE_REPOSITORY,
  FX_RATE_REPOSITORY,
  ORG_REPOSITORY,
  REFRESH_TOKEN_REPOSITORY,
  TOOL_CALL_LOG_REPOSITORY,
  USER_REPOSITORY,
} from './repositories.js';
import {
  SupabaseAuditLogRepository,
  SupabaseBudgetRepository,
  SupabaseExpenseRepository,
  SupabaseFxRateRepository,
  SupabaseOrgRepository,
  SupabaseRefreshTokenRepository,
  SupabaseToolCallLogRepository,
  SupabaseUserRepository,
} from './supabase.repositories.js';

/**
 * Binds each repository interface to its Supabase implementation.
 *
 * Global because every feature module needs some slice of it, and because the
 * binding is the only place the Supabase implementation is named — a test
 * swaps a token with `.overrideProvider(EXPENSE_REPOSITORY)` and no feature
 * module changes.
 *
 * `EnvService` is exported here too: it is the shared "read config safely"
 * dependency, and re-declaring it per module would give each one its own copy.
 */
@Global()
@Module({
  providers: [
    EnvService,
    SupabaseService,
    { provide: USER_REPOSITORY, useClass: SupabaseUserRepository },
    { provide: ORG_REPOSITORY, useClass: SupabaseOrgRepository },
    { provide: EXPENSE_REPOSITORY, useClass: SupabaseExpenseRepository },
    { provide: BUDGET_REPOSITORY, useClass: SupabaseBudgetRepository },
    { provide: FX_RATE_REPOSITORY, useClass: SupabaseFxRateRepository },
    { provide: TOOL_CALL_LOG_REPOSITORY, useClass: SupabaseToolCallLogRepository },
    { provide: REFRESH_TOKEN_REPOSITORY, useClass: SupabaseRefreshTokenRepository },
    { provide: AUDIT_LOG_REPOSITORY, useClass: SupabaseAuditLogRepository },
  ],
  exports: [
    EnvService,
    SupabaseService,
    USER_REPOSITORY,
    ORG_REPOSITORY,
    EXPENSE_REPOSITORY,
    BUDGET_REPOSITORY,
    FX_RATE_REPOSITORY,
    TOOL_CALL_LOG_REPOSITORY,
    REFRESH_TOKEN_REPOSITORY,
    AUDIT_LOG_REPOSITORY,
  ],
})
export class SupabaseModule {}
