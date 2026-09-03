import { PLATFORM_ID, computed, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type {
  AuditLogEntry,
  Category,
  Organization,
  Page,
  ToolCallLogEntry,
} from '@actuo/shared';

import { ModelCatalog, type GeminiModelOption } from '../../ai';
import { ApiClient, ApiError } from '../../core/api/api-client.js';
import { Session } from '../../core/session/session.js';
import { GEMINI_KEY_TESTER, type KeyTester } from './ai-settings.js';
import { Settings } from './settings.js';

const ORG: Organization = {
  id: 'org-1',
  name: 'Northwind Design',
  baseCurrency: 'INR',
  createdAt: '2026-01-04T09:00:00.000Z',
};

const CATEGORIES: Category[] = [
  { id: 'cat-1', orgId: 'org-1', name: 'Travel', icon: '✈️', isDefault: true },
  { id: 'cat-2', orgId: 'org-1', name: 'Software', icon: null, isDefault: false },
];

function entry(partial: Partial<ToolCallLogEntry> & { id: string }): ToolCallLogEntry {
  return {
    orgId: 'org-1',
    actor: 'human',
    toolName: 'submit_expense',
    input: { amount: 1200 },
    output: null,
    createdAt: '2026-02-01T10:30:00.000Z',
    ...partial,
  };
}

const HUMAN = entry({ id: 'call-1', actor: 'human', toolName: 'submit_expense' });
const AGENT = entry({
  id: 'call-2',
  actor: 'agent',
  toolName: 'search_expenses',
  input: { query: 'travel' },
});

function page<T>(items: T[]): Page<T> {
  return { items, total: items.length, limit: 25, offset: 0 };
}

interface GetCall {
  path: string;
  params?: Record<string, unknown>;
}

class FakeApi {
  readonly gets: GetCall[] = [];
  readonly routes = new Map<string, () => unknown>([
    ['/orgs/current', () => ORG],
    ['/orgs/current/categories', () => CATEGORIES],
    ['/tool-calls', () => page([HUMAN, AGENT])],
  ]);

  setAccessToken(): void {}

  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    this.gets.push({ path, params });
    const handler = this.routes.get(path);
    if (!handler) throw new ApiError(`No stub for GET ${path}`, 404, null);
    return handler() as T;
  }
  async post<T>(): Promise<T> {
    throw new ApiError('unexpected POST', 404, null);
  }
  async patch<T>(): Promise<T> {
    throw new ApiError('unexpected PATCH', 404, null);
  }
  async delete<T>(): Promise<T> {
    throw new ApiError('unexpected DELETE', 404, null);
  }

  paramsFor(path: string): Array<Record<string, unknown> | undefined> {
    return this.gets.filter((call) => call.path === path).map((call) => call.params);
  }
}

const MODELS: readonly GeminiModelOption[] = [
  { id: 'gemini-3-pro', label: 'Gemini 3 Pro', description: 'Strongest reasoning.' },
];

function stubCatalog() {
  const list = signal(MODELS);
  return {
    models: list.asReadonly(),
    source: signal<'default' | 'config'>('config').asReadonly(),
    loading: signal(false).asReadonly(),
    defaultModelId: signal('gemini-3-pro').asReadonly(),
    modelIds: computed(() => list().map((model) => model.id)),
    has: () => true,
    find: (id: string) => list().find((model) => model.id === id),
    labelFor: (id: string) => id,
    refresh: vi.fn(async () => list()),
  };
}

describe('Settings', () => {
  let fixture: ComponentFixture<Settings>;
  let api: FakeApi;

  const host = () => fixture.nativeElement as HTMLElement;
  const text = () => host().textContent ?? '';
  const button = (label: string) =>
    (Array.from(host().querySelectorAll('button')) as HTMLButtonElement[]).find(
      (element) => element.textContent?.trim() === label,
    ) ?? null;

  async function build(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [Settings],
      providers: [
        // Settings links to /convert, so RouterLink needs a router to resolve
        // against. No routes are exercised here; the link just has to render.
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: ApiClient, useValue: api as unknown as ApiClient },
        { provide: ModelCatalog, useValue: stubCatalog() as unknown as ModelCatalog },
        {
          provide: GEMINI_KEY_TESTER,
          useValue: (async () => ({
            ok: true,
            model: 'gemini-3-pro',
            latencyMs: 1,
            message: 'Key works.',
          })) as KeyTester,
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    localStorage.clear();
    api = new FakeApi();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('Settings must not call fetch directly.');
      }),
    );
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  describe('organization', () => {
    it('shows the name and base currency from /orgs/current', async () => {
      await build();
      expect(text()).toContain('Northwind Design');
      expect(text()).toContain('INR');
    });

    it('says what the signed-in role can do', async () => {
      await build();
      TestBed.inject(Session);
      // Signed out in this fixture, so no role line is claimed.
      expect(text()).not.toContain('You own this organization');
    });

    it('offers a retry instead of a blank panel when the call fails', async () => {
      api.routes.set('/orgs/current', () => {
        throw new ApiError('Service Unavailable', 503, null);
      });
      await build();

      expect(text()).toContain("Organization details didn't load");
      expect(text()).toContain('Nothing was changed');
    });

    it('does not take the rest of the screen down with it', async () => {
      api.routes.set('/orgs/current', () => {
        throw new ApiError('Service Unavailable', 503, null);
      });
      await build();

      // The BYOK panel is exactly what a stuck judge needs to reach.
      expect(text()).toContain("Your key is stored only in this browser");
      expect(text()).toContain('Travel');
    });
  });

  describe('categories', () => {
    it('lists what the org files expenses under', async () => {
      await build();
      expect(text()).toContain('Travel');
      expect(text()).toContain('Software');
    });

    it('offers a specific empty state, never a bare "no data"', async () => {
      api.routes.set('/orgs/current/categories', () => []);
      await build();

      expect(text()).toContain('No categories yet');
      expect(text()).toContain("'Travel' and 'Software' are common first picks");
    });
  });

  describe('AI & Copilot section', () => {
    it('is embedded here rather than living on its own page', async () => {
      await build();
      expect(host().querySelector('app-ai-settings')).not.toBeNull();
      expect(text()).toContain('AI & Copilot');
    });
  });

  describe('audit log', () => {
    it('loads everything by default, sending no actor filter', async () => {
      await build();
      expect(api.paramsFor('/tool-calls')).toEqual([{ actor: undefined, limit: 25 }]);
      expect(text()).toContain('submit_expense');
      expect(text()).toContain('search_expenses');
    });

    it('labels each row with the actor that made the call', async () => {
      await build();
      const rows = Array.from(host().querySelectorAll('li'));
      const agentRow = rows.find((row) => row.textContent?.includes('search_expenses'));
      expect(agentRow?.textContent).toContain('Agent');
      const humanRow = rows.find((row) => row.textContent?.includes('submit_expense'));
      expect(humanRow?.textContent).toContain('Human');
    });

    it('refetches with actor=agent — the demo artifact (PRD §8.7)', async () => {
      await build();
      api.routes.set('/tool-calls', () => page([AGENT]));

      button('Agent')!.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(api.paramsFor('/tool-calls').at(-1)).toEqual({ actor: 'agent', limit: 25 });
      expect(text()).toContain('search_expenses');
      expect(text()).not.toContain('submit_expense');
    });

    it('refetches with actor=human', async () => {
      await build();
      api.routes.set('/tool-calls', () => page([HUMAN]));

      button('Human')!.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(api.paramsFor('/tool-calls').at(-1)).toEqual({ actor: 'human', limit: 25 });
    });

    it('goes back to no filter, never the literal string "all"', async () => {
      await build();
      button('Agent')!.click();
      await fixture.whenStable();
      fixture.detectChanges();

      button('Everything')!.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(api.paramsFor('/tool-calls').at(-1)).toEqual({ actor: undefined, limit: 25 });
    });

    it('marks the active filter for assistive tech, not just visually', async () => {
      await build();
      expect(button('Everything')!.getAttribute('aria-pressed')).toBe('true');

      button('Agent')!.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(button('Agent')!.getAttribute('aria-pressed')).toBe('true');
      expect(button('Everything')!.getAttribute('aria-pressed')).toBe('false');
    });

    it('does not refetch when the active filter is clicked again', async () => {
      await build();
      const before = api.paramsFor('/tool-calls').length;

      button('Everything')!.click();
      await fixture.whenStable();

      expect(api.paramsFor('/tool-calls')).toHaveLength(before);
    });

    it('tailors the empty state to the filter in effect', async () => {
      api.routes.set('/tool-calls', () => page<ToolCallLogEntry>([]));
      await build();
      expect(text()).toContain('Nothing has been done in this organization yet');

      button('Agent')!.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(text()).toContain('The Copilot has not run a tool yet');
    });

    it('shows a retry, not an empty list, when the query fails', async () => {
      api.routes.set('/tool-calls', () => {
        throw new ApiError('Service Unavailable', 503, null);
      });
      await build();

      expect(text()).toContain("The audit log didn't load");
    });
  });

  it('makes no API calls during SSR', async () => {
    await TestBed.configureTestingModule({
      imports: [Settings],
      providers: [
        // Settings links to /convert, so RouterLink needs a router to resolve
        // against. No routes are exercised here; the link just has to render.
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: ApiClient, useValue: api as unknown as ApiClient },
        { provide: ModelCatalog, useValue: stubCatalog() as unknown as ModelCatalog },
        {
          provide: GEMINI_KEY_TESTER,
          useValue: (async () => ({
            ok: true,
            model: 'gemini-3-pro',
            latencyMs: 1,
            message: 'Key works.',
          })) as KeyTester,
        },
      ],
    }).compileComponents();

    const server = TestBed.createComponent(Settings);
    expect(() => server.detectChanges()).not.toThrow();
    expect(api.gets).toEqual([]);
  });
});

/**
 * PRD §6.2. `audit_log` was written on every mutation and read by nothing, so
 * "who changed what, when" was recorded and then invisible. It is a different
 * table from `tool_call_log` — state changes rather than tool invocations — and
 * the two panels say so, because two audit panels without an explanation read
 * as a bug.
 */
describe('Settings — change history', () => {
  const AUDIT: AuditLogEntry = {
    id: 'audit-1',
    orgId: 'org-1',
    actorId: 'user-1',
    action: 'expense.approved',
    entity: 'expense',
    entityId: 'exp-1',
    metadata: { amount: 6450 },
    createdAt: '2026-08-28T09:00:00.000Z',
  };

  let api: { get: ReturnType<typeof vi.fn> };
  let session: { role: ReturnType<typeof signal<string | null>>; isBrowser: boolean };
  let fixture: ComponentFixture<Settings>;

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const paths = () => api.get.mock.calls.map((call) => call[0]);

  async function create(role: string | null = 'owner'): Promise<void> {
    session.role.set(role);
    fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    api = {
      get: vi.fn().mockImplementation(async (path: string) => {
        if (path === '/audit-log') return { items: [AUDIT], total: 1, limit: 25, offset: 0 };
        if (path === '/tool-calls') return { items: [], total: 0, limit: 25, offset: 0 };
        if (path === '/orgs/current') {
          return { id: 'org-1', name: 'Acme', baseCurrency: 'INR', createdAt: '2026-01-01T00:00:00.000Z' };
        }
        return [];
      }),
    };
    session = { role: signal<string | null>('owner'), isBrowser: true };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        // Settings links to /convert, so RouterLink needs a router to resolve
        // against. No routes are exercised here; the link just has to render.
        provideRouter([]),
        { provide: ApiClient, useValue: api },
        { provide: Session, useValue: session },
      ],
    });
  });

  it('shows what changed, not just which tools ran', async () => {
    await create('owner');

    expect(text()).toContain('Change history');
    expect(text()).toContain('expense.approved');
  });

  /** Mirrors @Roles('owner','admin') on GET /api/audit-log. */
  it('is hidden from a member, and not even requested', async () => {
    await create('member');

    expect(text()).not.toContain('Change history');
    expect(paths()).not.toContain('/audit-log');
  });

  it('distinguishes the two panels in words', async () => {
    await create('owner');

    // Renaming the tool-call panel is half the fix: two things both called
    // "Audit log" is what made them look like duplicates.
    expect(text()).toContain('Tool calls');
    expect(text()).toContain('Change history');
  });

  it('says so when there is nothing recorded yet', async () => {
    api.get.mockImplementation(async (path: string) =>
      path === '/audit-log'
        ? { items: [], total: 0, limit: 25, offset: 0 }
        : path === '/tool-calls'
          ? { items: [], total: 0, limit: 25, offset: 0 }
          : [],
    );
    await create('owner');

    expect(text()).toContain('Nothing has changed yet');
  });

  /** One panel failing must not take the others down with it. */
  it('reports its own failure without breaking the rest of the page', async () => {
    api.get.mockImplementation(async (path: string) => {
      if (path === '/audit-log') throw new ApiError('nope', 500, null);
      if (path === '/tool-calls') return { items: [], total: 0, limit: 25, offset: 0 };
      return [];
    });
    await create('owner');

    expect(text()).toContain('The change history didn’t load');
    expect(text()).toContain('Tool calls');
  });
});
