/**
 * The product promise, as a test.
 *
 * "Your Gemini key is stored only in this browser and is never sent to our
 * servers" (PRD §8.3, CLAUDE.md rule 2) is verified live in the demo by opening
 * the DevTools network tab. This file is that check, automated: it installs a
 * single global `fetch` spy, drives every code path in `src/app/ai/` that can
 * make a request, and asserts that the key appears **only** in calls to
 * `https://generativelanguage.googleapis.com`.
 *
 * If a future change routes a Gemini call through an Actuo proxy, adds the key
 * to an interceptor, or posts telemetry containing an error object, this test
 * fails before the demo does.
 */

import '@angular/compiler';
import { Injector, PLATFORM_ID } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_TOOL_CONTRACTS } from '@actuo/shared';

import { GeminiClient } from './gemini-client';
import { KeyStore } from './key-store';
import {
  GEMINI_API_KEY_HEADER,
  GEMINI_API_ORIGIN,
  GEMINI_FETCH,
  assertGeminiUrl,
  callGemini,
} from './gemini-transport';
import { ModelCatalog } from './models';
import { isGeminiError } from './gemini-errors';

const TEST_KEY = 'AIzaSySECRETsecretSECRETsecretSECRET99';

interface Seen {
  url: string;
  origin: string;
  init: RequestInit;
}

const seen: Seen[] = [];

/** Everything a request could carry, flattened into one searchable string. */
function surfaceOf(call: Seen): string {
  return JSON.stringify({
    url: call.url,
    headers: call.init.headers ?? null,
    body: typeof call.init.body === 'string' ? call.init.body : null,
    credentials: call.init.credentials ?? null,
  });
}

/**
 * Source of every non-spec module in this directory, for the structural
 * assertions below. `import.meta.glob` is a Vite feature; TS only knows the
 * standard `ImportMeta`, hence the cast.
 */
function layerSources(): Array<[string, string]> {
  const glob = (import.meta as unknown as {
    glob(pattern: string, options: object): Record<string, unknown>;
  }).glob('./*.ts', { query: '?raw', import: 'default', eager: true });

  return Object.entries(glob)
    .filter(([path]) => !path.endsWith('.spec.ts'))
    .map(([path, source]) => [path, String(source)] as [string, string]);
}

function nonGoogleCalls(): Seen[] {
  return seen.filter((call) => call.origin !== GEMINI_API_ORIGIN);
}

function googleCalls(): Seen[] {
  return seen.filter((call) => call.origin === GEMINI_API_ORIGIN);
}

beforeEach(() => {
  seen.length = 0;
  const spy = vi.fn(async (input: string, init: RequestInit = {}) => {
    seen.push({ url: input, origin: new URL(input, 'https://app.actuo.test').origin, init });

    if (input.startsWith(GEMINI_API_ORIGIN)) {
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ geminiModels: ['gemini-3-pro'] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', spy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeAiLayer() {
  const injector = Injector.create({
    providers: [
      { provide: PLATFORM_ID, useValue: 'browser' },
      // The real late-bound default, so the global fetch spy is what runs.
      { provide: GEMINI_FETCH, useValue: (input: string, init?: RequestInit) => fetch(input, init) },
      { provide: KeyStore, useClass: KeyStore, deps: [] },
      { provide: GeminiClient, useClass: GeminiClient, deps: [] },
      { provide: ModelCatalog, useClass: ModelCatalog, deps: [] },
    ],
  });
  return {
    keys: injector.get(KeyStore),
    client: injector.get(GeminiClient),
    catalog: injector.get(ModelCatalog),
  };
}

describe('the key never leaves the browser for a non-Google origin', () => {
  it('holds across a full session: config fetch, key test, and a multi-turn Copilot exchange', async () => {
    const { keys, client, catalog } = makeAiLayer();
    keys.setKey(TEST_KEY);

    const tools = ALL_TOOL_CONTRACTS.map((contract) => ({
      name: contract.name,
      description: contract.description,
      inputSchema: contract.inputSchema,
    }));

    // Everything in this layer that can touch the network.
    await catalog.refresh();
    await client.testKey();
    await client.generate({
      turns: [
        { role: 'user', text: 'how much have I spent on travel?' },
        { role: 'model', functionCalls: [{ name: 'search_expenses', args: { query: 'travel' } }] },
        { role: 'tool', results: [{ name: 'search_expenses', response: { total: 4200 } }] },
      ],
      tools,
      systemInstruction: 'You are the Actuo Copilot.',
    });

    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(nonGoogleCalls().length).toBeGreaterThan(0); // /api/config really did run

    for (const call of nonGoogleCalls()) {
      const surface = surfaceOf(call);
      expect(surface, `key found in a request to ${call.origin}`).not.toContain(TEST_KEY);
      // Nothing key-shaped at all, in case the key is ever re-derived.
      expect(surface, `an API key was sent to ${call.origin}`).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/);
      expect(surface).not.toContain(GEMINI_API_KEY_HEADER);
    }

    // ...and the Google calls really did carry it, so the test is not vacuous.
    expect(googleCalls().length).toBeGreaterThanOrEqual(2);
    for (const call of googleCalls()) {
      const headers = call.init.headers as Record<string, string>;
      expect(headers[GEMINI_API_KEY_HEADER]).toBe(TEST_KEY);
      // Header, never query string: keeps it out of logs, referrers, history.
      expect(call.url).not.toContain(TEST_KEY);
      expect(call.url).not.toContain('key=');
      expect(call.init.credentials).toBe('omit');
    }
  });

  it('sends nothing anywhere when a Gemini call fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init: RequestInit = {}) => {
        seen.push({ url: input, origin: new URL(input).origin, init });
        return new Response(
          JSON.stringify({ error: { code: 401, message: `key ${TEST_KEY} rejected` } }),
          { status: 401 },
        );
      }),
    );

    const { keys, client } = makeAiLayer();
    keys.setKey(TEST_KEY);

    const result = await client.testKey();

    expect(result.ok).toBe(false);
    // No retry, no report, no telemetry beat to our own origin.
    expect(nonGoogleCalls()).toEqual([]);
    // And the error the UI will render carries no key.
    expect(result.message).not.toContain(TEST_KEY);
    expect(JSON.stringify(result.error?.detail ?? '')).not.toContain(TEST_KEY);
  });

  it('refuses at the transport layer if a Gemini call is ever pointed elsewhere', async () => {
    // Defence in depth: the URL is built from a constant, but if a refactor
    // ever made the base configurable, this is the guard that trips.
    expect(() => assertGeminiUrl('https://api.actuo.test/v1beta/models/x:generateContent')).toThrow(
      /Refusing to send the Gemini API key/,
    );
    expect(() => assertGeminiUrl('/api/gemini/generateContent')).toThrow();
    expect(() => assertGeminiUrl(`${GEMINI_API_ORIGIN}/v1beta/models/x:generateContent`)).not.toThrow();
  });

  it('the transport is the only thing that ever attaches the key, and it targets Google only', async () => {
    const { body } = await callGemini<{ candidates: unknown[] }>(
      'generateContent',
      { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] },
      { apiKey: TEST_KEY, model: 'gemini-3-pro' },
    );

    expect(body.candidates).toBeDefined();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.origin).toBe(GEMINI_API_ORIGIN);
  });

  it('has no import path from the AI layer into the backend', async () => {
    // A structural check, not a network one: importing anything from backend/
    // would be the other way this promise breaks (CLAUDE.md rule 3).
    const sources = layerSources();
    expect(sources.length).toBeGreaterThan(0);

    for (const [path, source] of sources) {
      const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);
      for (const specifier of imports) {
        expect(specifier, `${path} imports ${specifier}`).not.toMatch(/backend/);
        expect(specifier, `${path} imports ${specifier}`).not.toMatch(/supabase/i);
        expect(specifier, `${path} imports ${specifier}`).not.toMatch(/@google\/gen(ai|erative)/);
      }
    }
  });

  it('only one module in the layer mentions the key header at all', async () => {
    const offenders = layerSources()
      .filter(([path]) => !path.endsWith('index.ts'))
      .filter(([, source]) => source.includes("'x-goog-api-key'"))
      .map(([path]) => path);

    expect(offenders).toEqual(['./gemini-transport.ts']);
  });

  it('redacts a key out of anything error-shaped, so logs cannot leak it', async () => {
    const { keys, client } = makeAiLayer();
    keys.setKey(TEST_KEY);

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(`Gateway rejected credential ${TEST_KEY} for models/gemini-3-pro`, {
            status: 502,
          }),
      ),
    );

    try {
      await client.generate({ turns: [{ role: 'user', text: 'x' }] });
      expect.unreachable('expected a GeminiError');
    } catch (error) {
      expect(isGeminiError(error)).toBe(true);
      // The two strings anything would log.
      const serialized = `${String(error)} ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`;
      expect(serialized).not.toContain(TEST_KEY);
      expect(serialized).toContain('[redacted]');
    }
  });
});
