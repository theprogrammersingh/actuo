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
   * Base URL of the embedded currency converter (PRD §6.5, §7 cross-origin row),
   * or `''` when none is configured.
   *
   * A full URL rather than a bare origin, because a converter need not live at
   * the root of its host: a GitHub Pages *project* site is served from
   * `<user>.github.io/<repo>/`, and only a custom domain puts it at `/`. The
   * `?actuo=` handshake has to be appended to a real URL in any case. Callers
   * derive the origin for `getTools({fromOrigins})` with `new URL(value).origin`,
   * so one value carries both without a second "path" variable to keep in step.
   *
   * It has to be a *different* origin than the app, or the cross-origin path
   * proves nothing: `getTools()` would return same-origin tools and the Copilot
   * filters every one of them out. The default satisfies that from localhost as
   * well as from a deploy, which is why dev and production now run the same
   * path rather than dev exercising a stand-in.
   *
   * Production is deliberately **not** defaulted. A deploy should name the
   * converter it trusts rather than inherit one, and unset the surfaces say so —
   * which is true, and better than a silent third-party dependency nobody chose.
   */
  get converterUrl(): string {
    const configured = this.optional('CONVERTER_URL');
    if (configured) return configured;
    return process.env['NODE_ENV'] === 'production'
      ? ''
      : 'https://cambiaro.programmersingh.dev/';
  }
}
