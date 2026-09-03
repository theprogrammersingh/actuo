import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClient } from '../core/api/api-client.js';
import { PwaService } from '../core/pwa/pwa-service.js';
import { Copilot } from '../copilot/copilot.js';
import { ToolRegistry } from '../webmcp/tool-registry.js';
import type { NormalizedTool } from '../webmcp/webmcp.types.js';
import { ConverterSession } from './converter-session.js';
import { CurrencyConverter } from './currency-converter.js';

const SELF_ORIGIN = globalThis.location.origin;
const CONVERTER_URL = 'https://cambiaro.example/';

describe('CurrencyConverter', () => {
  let fixture: ComponentFixture<CurrencyConverter>;
  let api: { get: ReturnType<typeof vi.fn> };
  let copilot: {
    crossOriginTools: ReturnType<typeof signal<readonly NormalizedTool[]>>;
    discoverRemoteTools: ReturnType<typeof vi.fn>;
    clearRemoteTools: ReturnType<typeof vi.fn>;
  };
  let registry: {
    isSupported: ReturnType<typeof signal<boolean>>;
    canExecuteCrossOrigin: ReturnType<typeof signal<boolean>>;
    onToolChange: ReturnType<typeof vi.fn>;
  };
  let offline: ReturnType<typeof signal<boolean>>;
  let session: ConverterSession;

  const host = () => fixture.nativeElement as HTMLElement;
  const text = () => host().textContent ?? '';
  const iframe = () => host().querySelector('iframe');

  async function create(
    options: { converterUrl?: string | null; open?: boolean } = {},
  ): Promise<void> {
    const { converterUrl = CONVERTER_URL, open = true } = options;

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
        { provide: PwaService, useValue: { isOffline: offline } },
      ],
    });

    session = TestBed.inject(ConverterSession);
    fixture = TestBed.createComponent(CurrencyConverter);
    fixture.componentRef.setInput('surface', 'test');
    if (open) session.open('test');

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    api = { get: vi.fn() };
    copilot = {
      crossOriginTools: signal<readonly NormalizedTool[]>([]),
      discoverRemoteTools: vi.fn().mockResolvedValue(undefined),
      clearRemoteTools: vi.fn(),
    };
    registry = {
      isSupported: signal(true),
      canExecuteCrossOrigin: signal(true),
      onToolChange: vi.fn(() => vi.fn()),
    };
    offline = signal(false);
  });

  describe('mounting', () => {
    /**
     * The iframe is a whole separate app. Three of the four surfaces render
     * this collapsed, and a closed converter must cost nothing — hence `@if`
     * rather than hiding it with a class.
     */
    it('renders nothing at all until its surface is opened', async () => {
      await create({ open: false });

      expect(iframe()).toBeNull();
      expect(text().trim()).toBe('');
      expect(copilot.discoverRemoteTools).not.toHaveBeenCalled();
    });

    it('frames the converter once opened', async () => {
      await create();

      const frame = iframe();
      expect(frame).not.toBeNull();
      expect(frame!.getAttribute('allow')).toBe('tools');
      expect(frame!.getAttribute('referrerpolicy')).toBe('no-referrer');
      expect(frame!.getAttribute('src')).toContain(CONVERTER_URL);
    });

    it('tells the converter which origin to expose its tools to', async () => {
      await create();
      expect(iframe()!.getAttribute('src')).toContain(
        `actuo=${encodeURIComponent(SELF_ORIGIN)}`,
      );
    });

    it('gives the frame an accessible name', async () => {
      await create();
      fixture.componentRef.setInput('title', 'Currency converter for Kaffee Berlin');
      fixture.detectChanges();

      expect(iframe()!.getAttribute('title')).toBe('Currency converter for Kaffee Berlin');
    });

    it('claims discovery only while it is actually showing the frame', async () => {
      await create({ open: false });
      expect(copilot.discoverRemoteTools).not.toHaveBeenCalled();

      session.open('test');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(copilot.discoverRemoteTools).toHaveBeenCalledWith(['https://cambiaro.example']);
    });

    it('releases its claim when destroyed', async () => {
      await create();
      fixture.destroy();

      expect(copilot.clearRemoteTools).toHaveBeenCalled();
    });
  });

  describe('degrading honestly', () => {
    /**
     * A cross-origin frame has no usable error: no `onerror`, and `load` fires
     * for the browser's own error page. So this is gated on what we can know.
     */
    it('does not frame anything while offline, and says why', async () => {
      offline.set(true);
      await create();

      expect(iframe()).toBeNull();
      expect(text()).toContain('Live rates need a connection');
      expect(copilot.discoverRemoteTools).not.toHaveBeenCalled();
    });

    it('names the flag when this browser has no WebMCP, and still frames it', async () => {
      registry.isSupported.set(false);
      await create();

      // The point of the fallback: the converter is fully usable by hand.
      expect(iframe()).not.toBeNull();
      expect(text()).toContain('chrome://flags/#enable-webmcp-testing');
    });

    it('says what is unset rather than showing an empty box', async () => {
      await create({ converterUrl: null });

      expect(iframe()).toBeNull();
      expect(text()).toContain('CONVERTER_URL');
    });

    it('explains a same-origin converter instead of discovering nothing', async () => {
      await create({ converterUrl: `${SELF_ORIGIN}/partner-demo/` });

      expect(iframe()).toBeNull();
      expect(text()).toContain('cross-origin');
    });
  });

  describe('the advisory boundary', () => {
    /**
     * LOAD-BEARING. This component has no return channel by construction: no
     * `output()`, no `postMessage` listener, nothing that reads a value back
     * out of the frame. That absence is what stops a converted figure ever
     * reaching `sumSpend()` or `converted_amount` — wiring one in would mean
     * first inventing the channel, which is a visible, reviewable act.
     *
     * If this test fails because an output was added, the question to answer is
     * not "how do I fix the test" but "what is that number going to be used
     * for". See the class doc, and CLAUDE.md's "never add two currencies".
     */
    it('exposes no output for a converted value', () => {
      const def = (CurrencyConverter as unknown as { ɵcmp: { outputs: Record<string, string> } })
        .ɵcmp;
      expect(Object.keys(def.outputs)).toEqual([]);
    });

    it('takes only scalars in, never an expense', () => {
      const def = (CurrencyConverter as unknown as { ɵcmp: { inputs: Record<string, unknown> } })
        .ɵcmp;
      expect(Object.keys(def.inputs).sort()).toEqual(['height', 'surface', 'title']);
    });

    it('says on screen that the rate changes no Actuo figure', async () => {
      await create();
      expect(text()).toContain('do not change any Actuo figure');
    });
  });
});
