import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Thrown when a required environment variable is missing or blank.
 *
 * The rule this class exists to enforce: **never fail at import time, and
 * never fail in tests.** `backend/.env` ships blank (the Supabase credentials
 * are pasted in later), so the app must still build, boot and serve
 * `/api/health` and `/api/config` without them. Anything that genuinely needs
 * a secret asks for it at call time and gets this error, naming the variable
 * and the endpoint that wanted it.
 */
export class MissingEnvError extends Error {
  constructor(key: string, usedBy: string) {
    super(
      `[actuo] Missing required environment variable ${key}. ` +
        `${usedBy} cannot run without it. Copy backend/.env.example to ` +
        `backend/.env and fill it in.`,
    );
    this.name = 'MissingEnvError';
  }
}

@Injectable()
export class EnvService {
  constructor(private readonly config: ConfigService) {}

  private optional(key: string): string | undefined {
    const value = this.config.get<string>(key);
    // A blank value in .env is "not configured", not "configured as empty".
    return value && value.trim().length > 0 ? value.trim() : undefined;
  }

  private require(key: string, usedBy: string): string {
    const value = this.optional(key);
    if (!value) throw new MissingEnvError(key, usedBy);
    return value;
  }

  // --- Supabase (PRD §8.2: this service is the only Supabase client) --------

  get supabaseConfigured(): boolean {
    return Boolean(this.optional('SUPABASE_URL') && this.optional('SUPABASE_SERVICE_ROLE_KEY'));
  }

  requireSupabase(): { url: string; serviceRoleKey: string } {
    return {
      url: this.require('SUPABASE_URL', 'The Supabase client'),
      serviceRoleKey: this.require('SUPABASE_SERVICE_ROLE_KEY', 'The Supabase client'),
    };
  }

  // --- Auth (PRD §6.1) ------------------------------------------------------

  requireAccessSecret(): string {
    return this.require('JWT_ACCESS_SECRET', 'Access-token signing');
  }

  requireRefreshSecret(): string {
    return this.require('JWT_REFRESH_SECRET', 'Refresh-token signing');
  }

  get accessTtl(): string {
    return this.optional('JWT_ACCESS_TTL') ?? '15m';
  }

  get refreshTtl(): string {
    return this.optional('JWT_REFRESH_TTL') ?? '30d';
  }

  // --- Non-secret client config (GET /api/config) ---------------------------

  get baseCurrency(): string {
    return this.optional('BASE_CURRENCY') ?? 'INR';
  }

  /**
   * Where the WebMCP partner-demo page is served from (PRD §7 cross-origin row),
   * or `''` when no second origin is configured.
   *
   * It has to be a *different* origin than the app or the demo proves nothing:
   * `getTools({fromOrigins})` would return same-origin tools and the Copilot
   * would filter every one of them out. Locally that is the static server on
   * :4201 (`npm run dev:partner`); on a deploy it is whatever host the page
   * ends up on, which is why this is configuration and not a constant.
   *
   * The localhost default is **development only**. Serving it from a deployed
   * instance would make `/agent` embed an iframe pointing at each visitor's own
   * machine — a broken frame on the one page whose job is to demonstrate
   * cross-origin tools. Unset in production, `/agent` says it has no second
   * origin, which is true and useful.
   */
  get partnerOrigin(): string {
    const configured = this.optional('PARTNER_DEMO_ORIGIN');
    if (configured) return configured;
    return process.env['NODE_ENV'] === 'production' ? '' : 'http://localhost:4201';
  }
}
