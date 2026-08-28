/**
 * The BYOK promise, enforced at the UI layer.
 *
 * `src/app/ai/key-privacy.spec.ts` proves the *AI layer* never sends the key
 * anywhere but Google. This file proves the same thing one level up, where it
 * is far easier to break: these are the screens that hold the key in a signal,
 * render it, and sit next to components that talk to Actuo's API. A single
 * well-meaning "let's sync settings to the server" would pass every other test
 * in the suite and fail this one.
 *
 * The check is behavioural, not structural-only: a recording `ApiClient` and a
 * `fetch` spy watch the real components run a full set → test → clear flow, and
 * the key must appear in exactly one place — the `x-goog-api-key` header on a
 * request to `generativelanguage.googleapis.com`.
 */

import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Category, Organization, Page, ToolCallLogEntry } from '@actuo/shared';

import { GEMINI_API_KEY_HEADER, GEMINI_API_ORIGIN, KeyStore } from '../../ai';
import { ApiClient, ApiError } from '../../core/api/api-client.js';
import { AiSettings } from './ai-settings.js';
import { Settings } from './settings.js';

const TEST_KEY = 'AIzaSySETTINGSsecretSECRETsecret9x8y7';

const ORG: Organization = {
  id: 'org-1',
  name: 'Northwind Design',
  baseCurrency: 'INR',
  createdAt: '2026-01-04T09:00:00.000Z',
};

interface Recorded {
  method: string;
  path: string;
  body?: unknown;
  params?: unknown;
}

/** Records the full surface of every Actuo API call this screen makes. */
class RecordingApi {
  readonly calls: Recorded[] = [];
  readonly tokens: Array<string | null> = [];

  setAccessToken(token: string | null): void {
    this.tokens.push(token);
  }

  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    this.calls.push({ method: 'GET', path, params });
    if (path === '/orgs/current') return ORG as T;
    if (path === '/orgs/current/categories') return [] as Category[] as T;
    if (path === '/tool-calls') {
      return { items: [], total: 0, limit: 25, offset: 0 } as Page<ToolCallLogEntry> as T;
    }
    throw new ApiError(`No stub for GET ${path}`, 404, null);
  }
  async post<T>(path: string, body?: unknown): Promise<T> {
    this.calls.push({ method: 'POST', path, body });
    throw new ApiError('unexpected POST', 404, null);
  }
  async patch<T>(path: string, body?: unknown): Promise<T> {
    this.calls.push({ method: 'PATCH', path, body });
    throw new ApiError('unexpected PATCH', 404, null);
  }
  async delete<T>(path: string): Promise<T> {
    this.calls.push({ method: 'DELETE', path });
    throw new ApiError('unexpected DELETE', 404, null);
  }

  /** Everything a request could carry, flattened into one searchable string. */
  surface(): string {
    return JSON.stringify({ calls: this.calls, tokens: this.tokens });
  }
}

interface Seen {
  url: string;
  origin: string;
  init: RequestInit;
}

const seen: Seen[] = [];

function surfaceOf(call: Seen): string {
  return JSON.stringify({
    url: call.url,
    headers: call.init.headers ?? null,
    body: typeof call.init.body === 'string' ? call.init.body : null,
  });
}

const nonGoogle = () => seen.filter((call) => call.origin !== GEMINI_API_ORIGIN);
const google = () => seen.filter((call) => call.origin === GEMINI_API_ORIGIN);

describe('the Gemini key never reaches Actuo from the settings screens', () => {
  let api: RecordingApi;

  beforeEach(() => {
    localStorage.clear();
    seen.length = 0;
    api = new RecordingApi();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init: RequestInit = {}) => {
        const url = String(input);
        seen.push({ url, origin: new URL(url, 'https://app.actuo.test').origin, init });

        if (url.startsWith(GEMINI_API_ORIGIN)) {
          return new Response(
            JSON.stringify({
              candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        // Stands in for `/api/config`, which ModelCatalog really does call.
        return new Response(JSON.stringify({ geminiModels: ['gemini-3-pro'] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  /**
   * Deliberately uses the real `testGeminiKey` and the real `ModelCatalog`:
   * mocking them out would make this test agree with itself rather than with
   * the code that ships.
   */
  async function mount<T>(component: new (...args: never[]) => T) {
    await TestBed.configureTestingModule({
      imports: [component as never],
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: ApiClient, useValue: api as unknown as ApiClient },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(component as never);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  function element(fixture: { nativeElement: unknown }): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function typeKey(host: HTMLElement, value: string): void {
    const input = host.querySelector('ui-input input') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  function click(host: HTMLElement, label: string): void {
    const target = (Array.from(host.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (button) => button.textContent?.includes(label),
    );
    if (!target) throw new Error(`No button labelled "${label}"`);
    target.click();
  }

  it('runs the whole set → test → clear flow without touching ApiClient', async () => {
    const fixture = await mount(AiSettings);
    const host = element(fixture);

    typeKey(host, TEST_KEY);
    fixture.detectChanges();
    click(host, 'Save key');
    fixture.detectChanges();
    click(host, 'Test key');
    await fixture.whenStable();
    fixture.detectChanges();
    click(host, 'Clear key');
    fixture.detectChanges();
    click(host, 'Clear it');
    fixture.detectChanges();

    // The BYOK panel has no business calling Actuo at all.
    expect(api.calls).toEqual([]);
    expect(api.tokens).toEqual([]);
    // ...and the test really did happen, so this is not vacuous.
    expect(google().length).toBeGreaterThanOrEqual(1);
  });

  it('sends the key to Google, in a header, and to nowhere else', async () => {
    const fixture = await mount(AiSettings);
    const host = element(fixture);

    typeKey(host, TEST_KEY);
    fixture.detectChanges();
    click(host, 'Test key');
    await fixture.whenStable();
    fixture.detectChanges();

    // `/api/config` really ran, so the non-Google set is non-empty.
    expect(nonGoogle().length).toBeGreaterThan(0);
    for (const call of nonGoogle()) {
      const surface = surfaceOf(call);
      expect(surface, `key found in a request to ${call.origin}`).not.toContain(TEST_KEY);
      expect(surface, `an API key was sent to ${call.origin}`).not.toMatch(
        /AIza[0-9A-Za-z_-]{10,}/,
      );
      expect(surface).not.toContain(GEMINI_API_KEY_HEADER);
    }

    for (const call of google()) {
      const headers = call.init.headers as Record<string, string>;
      expect(headers[GEMINI_API_KEY_HEADER]).toBe(TEST_KEY);
      // Header, never query string — URLs end up in logs and history.
      expect(call.url).not.toContain(TEST_KEY);
      expect(call.url).not.toContain('key=');
    }
  });

  it('keeps the key out of every Actuo call the full Settings page makes', async () => {
    const fixture = await mount(Settings);
    const host = element(fixture);

    typeKey(host, TEST_KEY);
    fixture.detectChanges();
    click(host, 'Save key');
    fixture.detectChanges();
    click(host, 'Test key');
    await fixture.whenStable();
    fixture.detectChanges();

    // This page genuinely does talk to Actuo — org, categories, audit log.
    expect(api.calls.length).toBeGreaterThanOrEqual(3);
    expect(TestBed.inject(KeyStore).apiKey()).toBe(TEST_KEY);

    const surface = api.surface();
    expect(surface).not.toContain(TEST_KEY);
    expect(surface).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/);
    expect(surface).not.toContain(GEMINI_API_KEY_HEADER);
  });

  it('never puts the key where the access token goes', async () => {
    const fixture = await mount(Settings);
    const host = element(fixture);

    typeKey(host, TEST_KEY);
    fixture.detectChanges();
    click(host, 'Save key');
    fixture.detectChanges();

    expect(api.tokens).not.toContain(TEST_KEY);
  });
});

/**
 * Structural backstop. The behavioural tests above cover the paths that run
 * today; these cover the shapes a future change would take.
 */
describe('the settings, auth and session sources have no route to the key', () => {
  function sources(): Array<[string, string]> {
    // Vite requires the patterns to be literals at the call site, so this
    // cannot be wrapped in a helper.
    const glob = (
      import.meta as unknown as {
        glob(patterns: string[], options: object): Record<string, unknown>;
      }
    ).glob(['./*.ts', '../auth/*.ts', '../../core/session/*.ts'], {
      query: '?raw',
      import: 'default',
      eager: true,
    });

    return Object.entries(glob)
      .filter(([path]) => !path.endsWith('.spec.ts'))
      .map(([path, source]) => [path, String(source)] as [string, string]);
  }

  it('finds the files it is meant to be checking', () => {
    const paths = sources().map(([path]) => path);
    expect(paths).toEqual(
      expect.arrayContaining([
        './ai-settings.ts',
        './settings.ts',
        '../auth/login.ts',
        '../auth/signup.ts',
        '../../core/session/session.ts',
      ]),
    );
  });

  it('names the Gemini key header nowhere — only the transport may', () => {
    for (const [path, source] of sources()) {
      expect(source, `${path} mentions the Gemini key header`).not.toContain('x-goog-api-key');
    }
  });

  it('never hands anything key-shaped to an ApiClient method', () => {
    // e.g. `this.api.post('/settings', { apiKey })` — the exact shape of the
    // change that would break the promise.
    const leak = /\bapi\.(get|post|patch|delete)\b[^;]*\bapiKey\b/s;
    for (const [path, source] of sources()) {
      expect(source, `${path} passes a key into an Actuo API call`).not.toMatch(leak);
    }
  });

  it('keeps Session ignorant of the AI layer entirely', () => {
    const session = sources().find(([path]) => path.endsWith('core/session/session.ts'));
    expect(session).toBeDefined();
    const imports = [...session![1].matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]!);
    for (const specifier of imports) {
      expect(specifier, `session.ts imports ${specifier}`).not.toMatch(/\/ai(\/|'|$)|\.\.\/ai/);
      expect(specifier).not.toMatch(/key-store|gemini/i);
    }
  });
});
