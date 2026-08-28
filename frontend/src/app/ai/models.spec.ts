import '@angular/compiler';
import { Injector, PLATFORM_ID } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_GEMINI_MODELS,
  DEFAULT_GEMINI_MODEL_ID,
  ModelCatalog,
  labelForModelId,
  parseModelConfig,
} from './models';

function makeCatalog(platform: 'browser' | 'server' = 'browser'): ModelCatalog {
  return Injector.create({
    providers: [
      { provide: PLATFORM_ID, useValue: platform },
      { provide: ModelCatalog, useClass: ModelCatalog, deps: [] },
    ],
  }).get(ModelCatalog);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DEFAULT_GEMINI_MODELS', () => {
  it('offers the current line-up, with Gemini 3 Pro as the default', () => {
    expect(DEFAULT_GEMINI_MODELS.map((m) => m.id)).toEqual([
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-3-pro',
      'gemini-3-flash',
      'gemini-3-flash-preview',
      'gemini-flash-latest',
      'gemini-pro-latest',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemma-4-31b-it',
    ]);
    expect(DEFAULT_GEMINI_MODEL_ID).toBe('gemini-3-pro');
    expect(DEFAULT_GEMINI_MODELS.some((m) => m.id === DEFAULT_GEMINI_MODEL_ID)).toBe(true);
  });

  it('lists no id twice, so the dropdown cannot show duplicates', () => {
    const ids = DEFAULT_GEMINI_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * The Copilot only works through function calling. Flagging the exceptions is
   * what lets the settings screen warn before a user discovers mid-demo that
   * their model can talk but cannot act.
   */
  it('flags models that cannot call tools, and only those', () => {
    const withoutTools = DEFAULT_GEMINI_MODELS.filter((m) => m.supportsTools === false).map(
      (m) => m.id,
    );
    expect(withoutTools).toEqual(['gemma-4-31b-it']);

    // Every Gemini model is assumed tool-capable; absent means yes.
    for (const model of DEFAULT_GEMINI_MODELS) {
      if (model.id.startsWith('gemini-')) {
        expect(model.supportsTools, `${model.id} should not be flagged`).not.toBe(false);
      }
    }
  });

  it('the default model can call tools', () => {
    const fallback = DEFAULT_GEMINI_MODELS.find((m) => m.id === DEFAULT_GEMINI_MODEL_ID);
    expect(fallback?.supportsTools).not.toBe(false);
  });
});

describe('labelForModelId', () => {
  it('prettifies an unknown id so a new model still renders sensibly', () => {
    expect(labelForModelId('gemini-4-pro-preview')).toBe('Gemini 4 Pro Preview');
    expect(labelForModelId('gemini-2.5-flash')).toBe('Gemini 2.5 Flash');
  });
});

describe('parseModelConfig', () => {
  it('reads the geminiModels array', () => {
    expect(parseModelConfig({ geminiModels: ['gemini-4-pro'] })).toEqual({
      models: [{ id: 'gemini-4-pro', label: 'Gemini 4 Pro' }],
      defaultModelId: undefined,
    });
  });

  it('reads the exact payload backend/src/config/config.controller.ts serves', () => {
    // Pinned against the live `GET /api/config` contract. If the backend
    // renames a field, this fails here rather than silently reverting the
    // dropdown to the compiled-in defaults.
    const parsed = parseModelConfig({
      geminiModels: [
        { id: 'gemini-3-pro', label: 'Gemini 3 Pro', recommended: false },
        { id: 'gemini-3-flash', label: 'Gemini 3 Flash', recommended: true },
        { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', recommended: false },
      ],
      defaultGeminiModel: 'gemini-3-flash',
      baseCurrency: 'INR',
      currencies: ['INR', 'USD'],
    });

    expect(parsed).toEqual({
      models: [
        { id: 'gemini-3-pro', label: 'Gemini 3 Pro' },
        { id: 'gemini-3-flash', label: 'Gemini 3 Flash' },
        { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      ],
      defaultModelId: 'gemini-3-flash',
    });
  });

  it('accepts object entries with a label and description', () => {
    const parsed = parseModelConfig({
      geminiModels: [{ id: 'models/gemini-4-flash', displayName: 'Gemini 4 Flash', summary: 'Fast.' }],
    });
    expect(parsed!.models[0]).toEqual({
      id: 'gemini-4-flash',
      label: 'Gemini 4 Flash',
      description: 'Fast.',
    });
  });

  it('picks up a default model when the config names one it also lists', () => {
    expect(
      parseModelConfig({ models: ['a', 'b'], defaultModel: 'b' })!.defaultModelId,
    ).toBe('b');
    expect(
      parseModelConfig({ models: ['a', 'b'], defaultModel: 'zzz' })!.defaultModelId,
    ).toBeUndefined();
  });

  it('de-duplicates ids', () => {
    expect(parseModelConfig({ models: ['a', 'a', 'b'] })!.models).toHaveLength(2);
  });

  it('returns null for anything unusable, so the caller keeps its defaults', () => {
    expect(parseModelConfig(null)).toBeNull();
    expect(parseModelConfig('nope')).toBeNull();
    expect(parseModelConfig({})).toBeNull();
    expect(parseModelConfig({ geminiModels: [] })).toBeNull();
    expect(parseModelConfig({ geminiModels: [null, 42, {}] })).toBeNull();
  });
});

describe('ModelCatalog', () => {
  it('starts on the constant list', () => {
    const catalog = makeCatalog();
    expect(catalog.models()).toEqual(DEFAULT_GEMINI_MODELS);
    expect(catalog.source()).toBe('default');
    expect(catalog.loading()).toBe(false);
    expect(catalog.has('gemini-3-pro')).toBe(true);
    expect(catalog.labelFor('gemini-3-flash')).toBe('Gemini 3 Flash');
    expect(catalog.labelFor('gemini-9-ultra')).toBe('Gemini 9 Ultra');
  });

  it('overlays the list from GET /api/config when it is available', async () => {
    const fetchSpy = vi.fn(async () =>
      json({ geminiModels: ['gemini-4-pro', 'gemini-4-flash'], defaultModel: 'gemini-4-flash' }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const catalog = makeCatalog();
    await catalog.refresh();

    expect(fetchSpy).toHaveBeenCalledWith('/api/config', expect.anything());
    expect(catalog.modelIds()).toEqual(['gemini-4-pro', 'gemini-4-flash']);
    expect(catalog.source()).toBe('config');
    expect(catalog.defaultModelId()).toBe('gemini-4-flash');
    expect(catalog.loading()).toBe(false);
  });

  it('never sends credentials or a key to our own origin', async () => {
    const fetchSpy = vi.fn(async (_url: string, _init: RequestInit = {}) =>
      json({ geminiModels: ['gemini-4-pro'] }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await makeCatalog().refresh();

    const init = fetchSpy.mock.calls[0]![1] ?? {};
    expect(JSON.stringify(init)).not.toMatch(/AIza/);
    expect(init.body).toBeUndefined();
    expect(Object.keys(init.headers as Record<string, string>)).toEqual(['Accept']);
  });

  it.each([
    ['a 404', async () => json({ error: 'nope' }, 404)],
    ['an HTML error page', async () => new Response('<html>500</html>', { status: 500 })],
    ['a 200 with no model list', async () => json({ version: '1.0' })],
    ['a network failure', async () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('falls back to the constant list on %s', async (_name, impl) => {
    vi.stubGlobal('fetch', vi.fn(impl));

    const catalog = makeCatalog();
    const models = await catalog.refresh();

    expect(models).toEqual(DEFAULT_GEMINI_MODELS);
    expect(catalog.models()).toEqual(DEFAULT_GEMINI_MODELS);
    expect(catalog.source()).toBe('default');
    expect(catalog.loading()).toBe(false);
  });

  it('does not fetch during SSR — a relative URL has no base on the server', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const catalog = makeCatalog('server');
    const models = await catalog.refresh();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(models).toEqual(DEFAULT_GEMINI_MODELS);
  });

  it('propagates an AbortSignal and treats the abort as "keep the defaults"', async () => {
    const controller = new AbortController();
    const fetchSpy = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const catalog = makeCatalog();
    const pending = catalog.refresh({ signal: controller.signal });
    controller.abort();

    await expect(pending).resolves.toEqual(DEFAULT_GEMINI_MODELS);
    expect(catalog.loading()).toBe(false);
  });
});
