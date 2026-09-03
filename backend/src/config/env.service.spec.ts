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

    /**
     * A real, public second origin, so the cross-origin path needs no setup and
     * runs exactly as it does on a deploy. It used to be a stand-in served on
     * :4201 from inside this repo; dev and production exercising different
     * things is how a path stays broken in one of them without anyone noticing.
     */
    it('defaults to the public converter in development', () => {
      expect(createEnv().converterUrl).toBe('https://cambiaro.programmersingh.dev/');
    });

    /**
     * Production is not defaulted on purpose: a deploy should name the converter
     * it trusts rather than inherit one. Empty means "not configured", and the
     * converter surfaces say so instead of framing a third party nobody chose.
     */
    it('reports no URL at all in production when none is configured', () => {
      process.env['NODE_ENV'] = 'production';
      expect(createEnv().converterUrl).toBe('');
    });

    it('treats a blank value as unconfigured, not as configured-empty', () => {
      expect(createEnv({ CONVERTER_URL: '   ' }).converterUrl).toBe(
        'https://cambiaro.programmersingh.dev/',
      );
    });

    /**
     * The value is a full URL, not a bare origin, because a converter need not
     * sit at the root of its host — a GitHub Pages *project* site is served from
     * `<user>.github.io/<repo>/`. Consumers take the origin from it for
     * `getTools({fromOrigins})` and keep the path for the frame src.
     */
    it('carries a path through, for a converter not served at the root', () => {
      const url = createEnv({
        CONVERTER_URL: 'https://theprogrammersingh.github.io/cambiaro/',
      }).converterUrl;
      expect(new URL(url).origin).toBe('https://theprogrammersingh.github.io');
      expect(new URL(url).pathname).toBe('/cambiaro/');
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
