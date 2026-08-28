import '@angular/compiler';
import { Injector, PLATFORM_ID } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KEY_STORAGE_KEY, KeyStore, MODEL_STORAGE_KEY, maskApiKey } from './key-store';
import { DEFAULT_GEMINI_MODEL_ID } from './models';

const TEST_KEY = 'AIzaSyDEMOkeyDEMOkeyDEMOkeyDEMOkey7f3k';

/** Records every method call so SSR tests can assert "nothing was touched". */
function memoryStorage() {
  const map = new Map<string, string>();
  const touched: string[] = [];
  const storage = {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => {
      touched.push(`getItem:${k}`);
      return map.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      touched.push(`setItem:${k}`);
      map.set(k, v);
    },
    removeItem: (k: string) => {
      touched.push(`removeItem:${k}`);
      map.delete(k);
    },
    clear: () => {
      touched.push('clear');
      map.clear();
    },
  } satisfies Storage;
  return { storage, map, touched };
}

function makeStore(platform: 'browser' | 'server'): KeyStore {
  return Injector.create({
    providers: [
      { provide: PLATFORM_ID, useValue: platform },
      { provide: KeyStore, useClass: KeyStore, deps: [] },
    ],
  }).get(KeyStore);
}

describe('maskApiKey', () => {
  it('shows only the first and last four characters', () => {
    expect(maskApiKey(TEST_KEY)).toBe('AIza…7f3k');
  });

  it('reveals nothing at all for a short value', () => {
    expect(maskApiKey('short')).toBe('••••••••');
    expect(maskApiKey('short')).not.toContain('s');
  });

  it('is null when there is no key', () => {
    expect(maskApiKey(null)).toBeNull();
    expect(maskApiKey('')).toBeNull();
  });
});

describe('KeyStore in the browser', () => {
  let fake: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    fake = memoryStorage();
    vi.stubGlobal('localStorage', fake.storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts empty, with the default model', () => {
    const store = makeStore('browser');
    expect(store.isBrowser).toBe(true);
    expect(store.hasKey()).toBe(false);
    expect(store.apiKey()).toBeNull();
    expect(store.maskedKey()).toBeNull();
    expect(store.model()).toBe(DEFAULT_GEMINI_MODEL_ID);
  });

  it('persists the key to localStorage and exposes it as signals', () => {
    const store = makeStore('browser');
    store.setKey(TEST_KEY);

    expect(store.apiKey()).toBe(TEST_KEY);
    expect(store.hasKey()).toBe(true);
    expect(store.maskedKey()).toBe('AIza…7f3k');
    expect(fake.map.get(KEY_STORAGE_KEY)).toBe(TEST_KEY);
  });

  it('trims whitespace from a pasted key', () => {
    const store = makeStore('browser');
    store.setKey(`  ${TEST_KEY}\n`);
    expect(store.apiKey()).toBe(TEST_KEY);
  });

  it('refuses a blank key rather than silently storing one', () => {
    const store = makeStore('browser');
    expect(() => store.setKey('   ')).toThrow(/cannot be empty/);
    expect(store.hasKey()).toBe(false);
    expect(fake.map.has(KEY_STORAGE_KEY)).toBe(false);
  });

  it('rehydrates the key and model from a previous session', () => {
    fake.map.set(KEY_STORAGE_KEY, TEST_KEY);
    fake.map.set(MODEL_STORAGE_KEY, 'gemini-2.5-flash');

    const store = makeStore('browser');
    expect(store.apiKey()).toBe(TEST_KEY);
    expect(store.model()).toBe('gemini-2.5-flash');
  });

  it('persists the model choice alongside the key (PRD §8.3)', () => {
    const store = makeStore('browser');
    store.setModel('gemini-3-flash');
    expect(store.model()).toBe('gemini-3-flash');
    expect(fake.map.get(MODEL_STORAGE_KEY)).toBe('gemini-3-flash');
  });

  it('clearKey wipes storage immediately and leaves the model alone', () => {
    const store = makeStore('browser');
    store.setKey(TEST_KEY);
    store.setModel('gemini-3-flash');

    store.clearKey();

    expect(store.apiKey()).toBeNull();
    expect(store.hasKey()).toBe(false);
    expect(store.maskedKey()).toBeNull();
    expect(fake.map.has(KEY_STORAGE_KEY)).toBe(false);
    expect(store.model()).toBe('gemini-3-flash');
    expect(fake.map.get(MODEL_STORAGE_KEY)).toBe('gemini-3-flash');
  });

  it('clear() wipes both and resets the model to the default', () => {
    const store = makeStore('browser');
    store.setKey(TEST_KEY);
    store.setModel('gemini-3-flash');

    store.clear();

    expect(fake.map.size).toBe(0);
    expect(store.model()).toBe(DEFAULT_GEMINI_MODEL_ID);
  });

  it('keeps working, and reports it, when localStorage refuses to write', () => {
    // Safari private browsing / blocked site data / quota.
    vi.stubGlobal('localStorage', {
      ...fake.storage,
      getItem: () => null,
      setItem: () => {
        throw new DOMException('QuotaExceededError');
      },
    });

    const store = makeStore('browser');
    expect(() => store.setKey(TEST_KEY)).not.toThrow();

    // The Copilot still works this session; settings can warn it will not persist.
    expect(store.apiKey()).toBe(TEST_KEY);
    expect(store.persistent()).toBe(false);
  });

  it('survives localStorage itself throwing on access', () => {
    vi.stubGlobal('localStorage', undefined);
    const store = makeStore('browser');
    expect(store.hasKey()).toBe(false);
    expect(() => store.setKey(TEST_KEY)).not.toThrow();
    expect(store.apiKey()).toBe(TEST_KEY);
  });
});

describe('KeyStore under SSR', () => {
  let fake: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    fake = memoryStorage();
    // Deliberately present: proves the guard is `isPlatformBrowser`, not
    // "localStorage happens to be undefined on the server".
    vi.stubGlobal('localStorage', fake.storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('never touches localStorage during construction', () => {
    const store = makeStore('server');
    expect(store.isBrowser).toBe(false);
    expect(fake.touched).toEqual([]);
  });

  it('never touches localStorage on write or clear', () => {
    const store = makeStore('server');

    store.setKey(TEST_KEY);
    store.setModel('gemini-3-flash');
    store.clearKey();
    store.clear();

    expect(fake.touched).toEqual([]);
    expect(fake.map.size).toBe(0);
  });

  it('reports no key, so SSR renders the key-setup state rather than crashing', () => {
    fake.map.set(KEY_STORAGE_KEY, TEST_KEY);
    const store = makeStore('server');

    expect(store.hasKey()).toBe(false);
    expect(store.apiKey()).toBeNull();
    expect(store.maskedKey()).toBeNull();
    expect(store.model()).toBe(DEFAULT_GEMINI_MODEL_ID);
  });

  it('constructs without a localStorage global at all', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => makeStore('server')).not.toThrow();
  });
});
