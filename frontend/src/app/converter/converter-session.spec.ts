import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClient } from '../core/api/api-client.js';
import { Copilot } from '../copilot/copilot.js';
import { ToolRegistry } from '../webmcp/tool-registry.js';
import type { NormalizedTool } from '../webmcp/webmcp.types.js';
import { ConverterSession } from './converter-session.js';

const SELF_ORIGIN = globalThis.location.origin;
const CONVERTER_URL = 'https://cambiaro.example/';
const CONVERTER_ORIGIN = 'https://cambiaro.example';

describe('ConverterSession', () => {
  let api: { get: ReturnType<typeof vi.fn> };
  let copilot: {
    crossOriginTools: ReturnType<typeof signal<readonly NormalizedTool[]>>;
    discoverRemoteTools: ReturnType<typeof vi.fn>;
    clearRemoteTools: ReturnType<typeof vi.fn>;
  };
  let registry: { onToolChange: ReturnType<typeof vi.fn> };
  let unsubscribe: ReturnType<typeof vi.fn>;

  function create(converterUrl: string | null = CONVERTER_URL): ConverterSession {
    api.get.mockImplementation((path: string) =>
      path === '/config'
        ? Promise.resolve(converterUrl === null ? {} : { converterUrl })
        : Promise.reject(new Error(`unexpected ${path}`)),
    );

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiClient, useValue: api },
        { provide: Copilot, useValue: copilot },
        { provide: ToolRegistry, useValue: registry },
      ],
    });
    return TestBed.inject(ConverterSession);
  }

  /** Let the cached `/config` promise and the discovery it chains resolve. */
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    api = { get: vi.fn() };
    copilot = {
      crossOriginTools: signal<readonly NormalizedTool[]>([]),
      discoverRemoteTools: vi.fn().mockResolvedValue(undefined),
      clearRemoteTools: vi.fn(),
    };
    unsubscribe = vi.fn();
    registry = { onToolChange: vi.fn(() => unsubscribe) };
  });

  describe('where the converter is', () => {
    it('derives the origin from a URL that carries a path', async () => {
      const session = create('http://localhost:4201/partner-demo/');
      await session.ensureConfig();

      // One variable covers both the converter (at /) and the local partner
      // demo (at /partner-demo/); two that had to agree would be one too many.
      expect(session.converterOrigin()).toBe('http://localhost:4201');
      expect(session.isAvailable()).toBe(true);
    });

    it('reports nothing available when none is configured', async () => {
      const session = create(null);
      await session.ensureConfig();

      expect(session.converterOrigin()).toBe('');
      expect(session.isAvailable()).toBe(false);
      expect(session.frameUrl()).toBeNull();
    });

    /**
     * A misconfigured variable must not become a `javascript:` frame src. This
     * runs *before* the sanitizer bypass in `CurrencyConverter`, which is what
     * makes that bypass defensible.
     */
    it('refuses a URL whose scheme is not http or https', async () => {
      for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd']) {
        const session = create(bad);
        await session.ensureConfig();
        expect(session.converterOrigin()).toBe('');
        expect(session.frameUrl()).toBeNull();
      }
    });

    it('survives a malformed URL rather than taking the surfaces down', async () => {
      const session = create('not a url at all');
      await session.ensureConfig();
      expect(session.converterOrigin()).toBe('');
    });

    it('says so when the converter is on this app own origin', async () => {
      const session = create(`${SELF_ORIGIN}/partner-demo/`);
      await session.ensureConfig();

      // getTools() returns same-origin descriptors too, and the Copilot filters
      // them out — so this would discover nothing and explain nothing.
      expect(session.isSameOrigin()).toBe(true);
      expect(session.isAvailable()).toBe(false);
    });

    it('passes this origin along so the converter can expose its tools back', async () => {
      const session = create();
      await session.ensureConfig();

      expect(session.frameUrl()).toBe(
        `${CONVERTER_URL}?actuo=${encodeURIComponent(SELF_ORIGIN)}`,
      );
    });

    it('appends the handshake to a URL that already has a query', async () => {
      const session = create('https://cambiaro.example/?theme=dark');
      await session.ensureConfig();
      expect(session.frameUrl()).toContain('&actuo=');
    });

    it('asks the backend once however many surfaces mount', async () => {
      const session = create();
      const releases = [session.acquire(), session.acquire(), session.acquire()];
      await settle();

      expect(api.get).toHaveBeenCalledTimes(1);
      releases.forEach((release) => release());
    });
  });

  describe('one frame at a time', () => {
    /**
     * `getTools()` returns a descriptor per *window*, so two live frames on the
     * same origin publish two tools called `convertCurrency` — and the Copilot
     * would hand Gemini both.
     */
    it('opening one surface closes any other', () => {
      const session = create();

      session.open('dashboard');
      expect(session.isOpen('dashboard')).toBe(true);

      session.open('expense:e1');
      expect(session.isOpen('dashboard')).toBe(false);
      expect(session.isOpen('expense:e1')).toBe(true);
    });

    it('toggles a surface off without opening another', () => {
      const session = create();

      session.toggle('convert');
      expect(session.isOpen('convert')).toBe(true);
      session.toggle('convert');
      expect(session.openedSurface()).toBeNull();
    });

    it('closing a surface that is not open leaves the open one alone', () => {
      const session = create();
      session.open('agent');
      session.close('dashboard');
      expect(session.isOpen('agent')).toBe(true);
    });
  });

  describe('discovery lifecycle', () => {
    it('discovers for the first mount', async () => {
      const session = create();
      const release = session.acquire();
      await settle();

      expect(copilot.discoverRemoteTools).toHaveBeenCalledWith([CONVERTER_ORIGIN]);
      release();
    });

    /**
     * The bug this pins: during a route change Angular constructs the incoming
     * component before destroying the outgoing one. A naive clear-on-destroy
     * would wipe the tools the new surface had just discovered.
     */
    it('keeps the tools while any mount remains', async () => {
      const session = create();
      const first = session.acquire();
      const second = session.acquire();
      await settle();

      first();
      expect(copilot.clearRemoteTools).not.toHaveBeenCalled();

      second();
      expect(copilot.clearRemoteTools).toHaveBeenCalled();
    });

    it('ignores a release called twice', async () => {
      const session = create();
      const first = session.acquire();
      const second = session.acquire();
      await settle();

      first();
      first();
      expect(copilot.clearRemoteTools).not.toHaveBeenCalled();
      second();
      expect(copilot.clearRemoteTools).toHaveBeenCalledTimes(1);
    });

    /**
     * The converter registers asynchronously, after its own load and (being a
     * separate app) after it boots — so the iframe's `load` can fire before
     * there is anything to find.
     */
    it('re-discovers when the browser reports a toolchange', async () => {
      const session = create();
      const release = session.acquire();
      await settle();
      copilot.discoverRemoteTools.mockClear();

      const listener = registry.onToolChange.mock.calls[0][0] as () => void;
      listener();
      await settle();

      expect(copilot.discoverRemoteTools).toHaveBeenCalledWith([CONVERTER_ORIGIN]);
      release();
    });

    it('unsubscribes from toolchange once nothing is mounted', async () => {
      const session = create();
      const release = session.acquire();
      await settle();

      release();
      expect(unsubscribe).toHaveBeenCalled();
    });

    it('subscribes to toolchange once, not once per mount', async () => {
      const session = create();
      const releases = [session.acquire(), session.acquire()];
      await settle();

      expect(registry.onToolChange).toHaveBeenCalledTimes(1);
      releases.forEach((release) => release());
    });

    it('does not discover when nothing is mounted', async () => {
      const session = create();
      await session.ensureConfig();
      await session.rediscover();

      expect(copilot.discoverRemoteTools).not.toHaveBeenCalled();
    });

    it('does not discover a same-origin converter', async () => {
      const session = create(`${SELF_ORIGIN}/partner-demo/`);
      const release = session.acquire();
      await settle();

      expect(copilot.discoverRemoteTools).not.toHaveBeenCalled();
      release();
    });

    it('leaves the surfaces working when the backend is down', async () => {
      api.get.mockRejectedValue(new Error('offline'));
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          { provide: ApiClient, useValue: api },
          { provide: Copilot, useValue: copilot },
          { provide: ToolRegistry, useValue: registry },
        ],
      });
      const session = TestBed.inject(ConverterSession);

      await session.ensureConfig();
      expect(session.converterUrl()).toBe('');
      expect(session.isResolved()).toBe(true);
      expect(session.isAvailable()).toBe(false);
    });
  });
});
