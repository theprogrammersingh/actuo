import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { EnvService, MissingEnvError } from './env.service.js';

/** A ConfigService over a plain map, which is all EnvService uses. */
function createEnv(values: Record<string, string | undefined> = {}) {
  const config = { get: (key: string) => values[key] } as unknown as ConfigService;
  return new EnvService(config);
}

describe('EnvService', () => {
  const originalNodeEnv = process.env['NODE_ENV'];

  beforeEach(() => {
    delete process.env['NODE_ENV'];
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = originalNodeEnv;
  });

  describe('partnerOrigin', () => {
    it('uses the configured origin whenever there is one', () => {
      expect(createEnv({ PARTNER_DEMO_ORIGIN: 'https://books.example' }).partnerOrigin).toBe(
        'https://books.example',
      );
    });

    it('honours the configured origin in production too', () => {
      process.env['NODE_ENV'] = 'production';
      expect(createEnv({ PARTNER_DEMO_ORIGIN: 'https://books.example' }).partnerOrigin).toBe(
        'https://books.example',
      );
    });

    it('falls back to the local partner server in development', () => {
      // `npm run dev` starts it there, so the cross-origin demo needs no setup.
      expect(createEnv().partnerOrigin).toBe('http://localhost:4201');
    });

    /**
     * The bug this pins: a deployed instance serving `http://localhost:4201`
     * would make `/agent` embed an iframe pointing at each *visitor's* own
     * machine — a broken frame on the one page whose job is to demonstrate
     * cross-origin tools. Empty means "not configured", and `/agent` says so.
     */
    it('reports no origin at all in production when none is configured', () => {
      process.env['NODE_ENV'] = 'production';
      expect(createEnv().partnerOrigin).toBe('');
    });

    it('treats a blank value as unconfigured, not as configured-empty', () => {
      expect(createEnv({ PARTNER_DEMO_ORIGIN: '   ' }).partnerOrigin).toBe('http://localhost:4201');
    });
  });

  describe('boot safety', () => {
    /**
     * `backend/.env` ships blank and the deploy supplies secrets at runtime, so
     * nothing may throw at construction — a container that cannot start cannot
     * be inspected. Secrets are demanded at call time instead.
     */
    it('constructs and answers the non-secret config with no environment at all', () => {
      const env = createEnv();
      expect(env.baseCurrency).toBe('INR');
      expect(env.supabaseConfigured).toBe(false);
      expect(env.accessTtl).toBe('15m');
    });

    it('names the missing variable and who wanted it', () => {
      expect(() => createEnv().requireAccessSecret()).toThrow(MissingEnvError);
      expect(() => createEnv().requireAccessSecret()).toThrow(/JWT_ACCESS_SECRET/);
    });
  });
});
