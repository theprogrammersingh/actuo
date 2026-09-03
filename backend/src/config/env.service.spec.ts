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

  describe('converterUrl', () => {
    it('uses the configured URL whenever there is one', () => {
      expect(
        createEnv({ CONVERTER_URL: 'https://cambiaro.programmersingh.dev/' }).converterUrl,
      ).toBe('https://cambiaro.programmersingh.dev/');
    });

    it('honours the configured URL in production too', () => {
      process.env['NODE_ENV'] = 'production';
      expect(
        createEnv({ CONVERTER_URL: 'https://cambiaro.programmersingh.dev/' }).converterUrl,
      ).toBe('https://cambiaro.programmersingh.dev/');
    });

    it('falls back to the local partner server in development', () => {
      // `pnpm run dev` starts it there, so the cross-origin path needs no setup.
      expect(createEnv().converterUrl).toBe('http://localhost:4201/partner-demo/');
    });

    /**
     * The bug this pins: a deployed instance serving `http://localhost:4201`
     * would embed an iframe pointing at each *visitor's* own machine — a broken
     * frame on the surfaces whose job is to demonstrate cross-origin tools.
     * Empty means "not configured", and those surfaces say so.
     */
    it('reports no URL at all in production when none is configured', () => {
      process.env['NODE_ENV'] = 'production';
      expect(createEnv().converterUrl).toBe('');
    });

    it('treats a blank value as unconfigured, not as configured-empty', () => {
      expect(createEnv({ CONVERTER_URL: '   ' }).converterUrl).toBe(
        'http://localhost:4201/partner-demo/',
      );
    });

    /**
     * The value carries a path, not just an origin, because the two things it
     * points at do not agree on one: Cambiaro serves at `/` and the local
     * partner demo at `/partner-demo/`. Consumers take the origin from it.
     */
    it('keeps a path so one value covers both converter and partner demo', () => {
      const url = createEnv({ CONVERTER_URL: 'https://cambiaro.programmersingh.dev/' }).converterUrl;
      expect(new URL(url).origin).toBe('https://cambiaro.programmersingh.dev');
      expect(new URL(createEnv().converterUrl).pathname).toBe('/partner-demo/');
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
