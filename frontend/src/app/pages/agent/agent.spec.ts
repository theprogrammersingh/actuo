import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClient } from '../../core/api/api-client.js';
import { Copilot } from '../../copilot/copilot.js';
import { ToolRegistry } from '../../webmcp/tool-registry.js';
import type { NormalizedTool } from '../../webmcp/webmcp.types.js';
import type { ToolInvocation } from '../../webmcp/tool-registry.js';
import { Agent } from './agent.js';

const SELF_ORIGIN = globalThis.location.origin;
/** CONVERTER_URL carries a path, so the origin is derived from it. */
const CONVERTER_URL = 'http://localhost:4201/partner-demo/';
const PARTNER = 'http://localhost:4201';

function remoteTool(overrides: Partial<NormalizedTool> = {}): NormalizedTool {
  return {
    name: 'get_book_price',
    title: 'Get book price',
    description: 'Return the price of one book by its id.',
    inputSchema: { type: 'object', properties: {} },
    origin: PARTNER,
    annotations: { readOnlyHint: true },
    isCrossOrigin: true,
    raw: {} as NormalizedTool['raw'],
    ...overrides,
  };
}

function invocation(overrides: Partial<ToolInvocation> = {}): ToolInvocation {
  return {
    toolName: 'search_expenses',
    input: { query: 'lunch' },
    output: { total: 2 },
    origin: 'local',
    startedAt: 0,
    durationMs: 12,
    ...overrides,
  };
}

describe('Agent tools page', () => {
  let fixture: ComponentFixture<Agent>;
  let api: { get: ReturnType<typeof vi.fn> };
  let copilot: {
    crossOriginTools: ReturnType<typeof signal<readonly NormalizedTool[]>>;
    discoverRemoteTools: ReturnType<typeof vi.fn>;
    clearRemoteTools: ReturnType<typeof vi.fn>;
  };
  let registry: {
    isSupported: ReturnType<typeof signal<boolean>>;
    canExecuteCrossOrigin: ReturnType<typeof signal<boolean>>;
    registeredNames: ReturnType<typeof signal<readonly string[]>>;
    invocationLog: ReturnType<typeof signal<readonly ToolInvocation[]>>;
    onToolChange: ReturnType<typeof vi.fn>;
  };
  let toolChangeUnsubscribe: ReturnType<typeof vi.fn>;

  const host = () => fixture.nativeElement as HTMLElement;
  const text = () => host().textContent ?? '';
  const iframe = () => host().querySelector('iframe');

  /** `null` means "the backend reported no converter", not "use the default". */
  async function create(converterUrl: string | null = CONVERTER_URL): Promise<void> {
    api.get.mockImplementation((path: string) =>
      path === '/config'
        ? Promise.resolve(converterUrl === null ? {} : { converterUrl })
        : Promise.reject(new Error(`unexpected ${path}`)),
    );

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        // The page links to /convert, so RouterLink needs a router to resolve
        // against. No routes are exercised here; the link just has to render.
        provideRouter([]),
        { provide: ApiClient, useValue: api },
        { provide: Copilot, useValue: copilot },
        { provide: ToolRegistry, useValue: registry },
      ],
    });
    fixture = TestBed.createComponent(Agent);
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
    toolChangeUnsubscribe = vi.fn();
    registry = {
      isSupported: signal(true),
      canExecuteCrossOrigin: signal(true),
      registeredNames: signal<readonly string[]>(['search_expenses']),
      invocationLog: signal<readonly ToolInvocation[]>([]),
      onToolChange: vi.fn(() => toolChangeUnsubscribe),
    };
  });

  describe('cross-origin discovery', () => {
    /**
     * The dead feature this page revives: `discoverRemoteTools()` existed,
     * worked and was tested, and nothing in the app ever called it.
     */
    it('asks the configured partner origin for its tools', async () => {
      await create();
      expect(copilot.discoverRemoteTools).toHaveBeenCalledWith([PARTNER]);
    });

    it('embeds the partner page with the tools permission the spec requires', async () => {
      await create();

      const frame = iframe();
      expect(frame).not.toBeNull();
      expect(frame!.getAttribute('allow')).toBe('tools');
      expect(frame!.getAttribute('referrerpolicy')).toBe('no-referrer');
      expect(frame!.getAttribute('src')).toContain(CONVERTER_URL);
    });

    it('tells the embedded page which origin to expose its tools to', async () => {
      await create();
      expect(iframe()!.getAttribute('src')).toContain(
        `actuo=${encodeURIComponent(SELF_ORIGIN)}`,
      );
    });

    it('re-runs discovery when the browser reports a toolchange', async () => {
      await create();
      copilot.discoverRemoteTools.mockClear();

      const listener = registry.onToolChange.mock.calls[0][0] as () => void;
      listener();
      await fixture.whenStable();

      // The partner page registers asynchronously after its own load, so the
      // iframe's `load` event can fire before there is anything to find.
      expect(copilot.discoverRemoteTools).toHaveBeenCalledWith([PARTNER]);
    });

    it('lists what it discovered, with the origin it came from', async () => {
      copilot.crossOriginTools.set([remoteTool()]);
      await create();

      expect(text()).toContain('get_book_price');
      expect(text()).toContain('localhost:4201');
      expect(text()).toContain('Read-only');
    });

    /**
     * With the partner page on this origin its tools come back same-origin and
     * the Copilot filters every one of them out. Showing an empty list would
     * read as a bug; saying so is the honest failure.
     */
    it('explains itself instead of pretending, when the converter is same-origin', async () => {
      await create(`${SELF_ORIGIN}/partner-demo/`);

      expect(iframe()).toBeNull();
      expect(text()).toContain('CONVERTER_URL');
      expect(copilot.discoverRemoteTools).not.toHaveBeenCalled();
    });

    /**
     * The deployed default: `CONVERTER_URL` is unset in production, on purpose,
     * because a localhost fallback there would embed an iframe pointing at each
     * visitor's own machine. An empty card would read as a bug, so the page has
     * to say what is missing.
     */
    it('explains itself when no converter is configured', async () => {
      await create(null);

      expect(iframe()).toBeNull();
      expect(copilot.discoverRemoteTools).not.toHaveBeenCalled();
      expect(text()).toContain('No converter is configured');
      expect(text()).toContain('CONVERTER_URL');
    });

    /**
     * A misconfigured variable must not become a `javascript:` frame src. The
     * scheme check lives in ConverterSession, ahead of the sanitizer bypass.
     */
    it('refuses a converter URL that is not http(s)', async () => {
      await create('javascript:alert(1)');

      expect(iframe()).toBeNull();
      expect(copilot.discoverRemoteTools).not.toHaveBeenCalled();
    });

    /**
     * Leaving the other origin's tools on the Copilot's menu after the iframe
     * is gone means the model keeps calling a document that no longer exists.
     */
    it('drops the remote tools when the page goes away', async () => {
      await create();
      fixture.destroy();

      expect(copilot.clearRemoteTools).toHaveBeenCalled();
      expect(toolChangeUnsubscribe).toHaveBeenCalled();
    });
  });

  describe('browser support', () => {
    it('says WebMCP is missing rather than showing an empty page', async () => {
      registry.isSupported.set(false);
      registry.canExecuteCrossOrigin.set(false);
      await create();

      expect(text()).toContain('document.modelContext');
      expect(text()).toContain('Not available');
    });

    it('names the flag when executeTool is the missing piece', async () => {
      registry.canExecuteCrossOrigin.set(false);
      await create();

      expect(text()).toContain('chrome://flags/#enable-webmcp-testing');
    });

    it('confirms support when both are present', async () => {
      await create();
      expect(text()).toContain('Available');
      expect(text()).not.toContain('chrome://flags');
    });

    it('names the tools this page publishes', async () => {
      await create();
      expect(text()).toContain('search_expenses');
    });
  });

  describe('invocation log', () => {
    it('is empty until something runs', async () => {
      await create();
      expect(text()).toContain('Nothing has run yet');
    });

    it('shows the newest call first', async () => {
      registry.invocationLog.set([
        invocation({ toolName: 'search_expenses' }),
        invocation({ toolName: 'submit_expense' }),
      ]);
      await create();

      const names = Array.from(host().querySelectorAll('li .font-mono')).map(
        (el) => el.textContent?.trim() ?? '',
      );
      expect(names[0]).toBe('submit_expense');
    });

    it('shows a failure with its message, not as a success', async () => {
      registry.invocationLog.set([
        invocation({ toolName: 'submit_expense', output: null, error: 'Category not found' }),
      ]);
      await create();

      expect(text()).toContain('Failed');
      expect(text()).toContain('Category not found');
    });

    it('marks a cross-origin call as one', async () => {
      registry.invocationLog.set([
        invocation({ toolName: 'get_book_price', origin: 'cross-origin' }),
      ]);
      await create();

      expect(text()).toContain('Cross-origin');
    });
  });
});
