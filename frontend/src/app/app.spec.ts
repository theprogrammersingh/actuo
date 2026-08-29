import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { Session } from './core/session/session.js';
import { ToolSession } from './webmcp/tool-session.js';
import { ToolCallAudit } from './webmcp/tool-call-audit.js';
import { ToolRegistry, type ToolInvocation } from './webmcp/tool-registry.js';
import { Copilot } from './copilot/copilot.js';

function createSession(overrides: Record<string, unknown> = {}) {
  return {
    isAuthenticated: signal(false),
    role: signal<string | null>(null),
    pendingApprovals: signal(0),
    ready: signal(true),
    logout: vi.fn().mockResolvedValue(undefined),
    refreshPendingApprovals: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

function createToolSession() {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    setRole: vi.fn(),
    setPendingApprovals: vi.fn(),
  };
}

/**
 * A registry stub that hands back the observer the shell registers, so a test
 * can play an invocation through it without a real WebMCP implementation.
 */
function createRegistry(mutating: (name: string) => boolean = () => true) {
  let observer: ((invocation: ToolInvocation) => void) | null = null;
  const unsubscribe = vi.fn();
  return {
    unsubscribe,
    emit(invocation: Partial<ToolInvocation> & { toolName: string }) {
      observer?.({
        input: {},
        output: {},
        origin: 'local',
        startedAt: 0,
        durationMs: 1,
        ...invocation,
      });
    },
    stub: {
      observe: vi.fn((fn: (invocation: ToolInvocation) => void) => {
        observer = fn;
        return unsubscribe;
      }),
      isMutating: vi.fn(mutating),
      registeredNames: signal<readonly string[]>([]),
    },
  };
}

describe('App shell', () => {
  let session: ReturnType<typeof createSession>;
  let tools: ReturnType<typeof createToolSession>;
  let registry: ReturnType<typeof createRegistry>;
  let audit: { record: ReturnType<typeof vi.fn> };

  function create() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: Session, useValue: session },
        { provide: ToolSession, useValue: tools },
        { provide: ToolRegistry, useValue: registry.stub },
        { provide: ToolCallAudit, useValue: audit },
        {
          provide: Copilot,
          useValue: {
            isOpen: signal(false),
            isBusy: signal(false),
            entries: signal([]),
            needsKey: signal(false),
            toggle: vi.fn(),
            close: vi.fn(),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    session = createSession();
    tools = createToolSession();
    registry = createRegistry();
    audit = { record: vi.fn() };
  });

  it('renders only the outlet when signed out, with no app chrome', () => {
    const fixture = create();
    expect(fixture.nativeElement.querySelector('nav')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-copilot-panel')).toBeNull();
  });

  it('renders both navigations and the Copilot once signed in', () => {
    session.isAuthenticated.set(true);
    const fixture = create();

    // §3.1: a bottom tab bar on phones and a left rail from sm: up.
    expect(fixture.nativeElement.querySelectorAll('nav[aria-label="Main"]')).toHaveLength(2);
    expect(fixture.nativeElement.querySelector('app-copilot-panel')).not.toBeNull();
  });

  it('publishes WebMCP tools when a session appears', () => {
    session.isAuthenticated.set(true);
    create();

    expect(tools.start).toHaveBeenCalled();
    expect(tools.stop).not.toHaveBeenCalled();
  });

  it('retires every tool on sign-out', () => {
    session.isAuthenticated.set(true);
    const fixture = create();

    session.isAuthenticated.set(false);
    fixture.detectChanges();

    expect(tools.stop).toHaveBeenCalled();
  });

  /**
   * The state-gated tool depends on both of these, and each change fires
   * `toolchange` — so the shell must keep them in step with the session.
   */
  it('feeds role and pending count through to the tool session', () => {
    session.isAuthenticated.set(true);
    const fixture = create();

    session.role.set('admin');
    session.pendingApprovals.set(3);
    fixture.detectChanges();

    expect(tools.setRole).toHaveBeenCalledWith('admin');
    expect(tools.setPendingApprovals).toHaveBeenCalledWith(3);
  });

  /**
   * The bug this pins: nothing called `refreshPendingApprovals()`, so the count
   * stayed at 0, the gate in `ToolSession` never opened, and `approve_expense`
   * never registered. The tool existed and was tested; the app never published
   * it.
   */
  it('asks the server for the pending queue as soon as there is a session', () => {
    session.isAuthenticated.set(true);
    create();

    expect(session.refreshPendingApprovals).toHaveBeenCalled();
  });

  it('does not poll the pending queue while signed out', () => {
    create();
    expect(session.refreshPendingApprovals).not.toHaveBeenCalled();
  });

  it('re-checks the pending queue after a mutating tool call', () => {
    session.isAuthenticated.set(true);
    create();
    session.refreshPendingApprovals.mockClear();

    registry.emit({ toolName: 'approve_expense' });

    expect(session.refreshPendingApprovals).toHaveBeenCalled();
  });

  it('does not re-check after a read-only tool call', () => {
    registry = createRegistry(() => false);
    session.isAuthenticated.set(true);
    create();
    session.refreshPendingApprovals.mockClear();

    // `search_expenses` runs on almost every Copilot question; polling on it
    // would be a request per question for a count that cannot have changed.
    registry.emit({ toolName: 'search_expenses' });

    expect(session.refreshPendingApprovals).not.toHaveBeenCalled();
  });

  /**
   * Second dead feature: `tool_call_log` had a table, a repository, a route and
   * a viewer, and no writer — so the audit trail showed seed rows forever.
   */
  it('writes every tool invocation to the audit trail as an agent action', () => {
    session.isAuthenticated.set(true);
    create();

    registry.emit({ toolName: 'search_expenses', input: { query: 'barista' }, output: { total: 2 } });

    expect(audit.record).toHaveBeenCalledWith({
      actor: 'agent',
      toolName: 'search_expenses',
      input: { query: 'barista' },
      output: { total: 2 },
    });
  });

  it('records a failed tool call with its error rather than dropping it', () => {
    session.isAuthenticated.set(true);
    create();

    registry.emit({ toolName: 'submit_expense', output: null, error: 'Category not found' });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ output: { error: 'Category not found' } }),
    );
  });

  it('unsubscribes from the registry when the shell goes away', () => {
    session.isAuthenticated.set(true);
    const fixture = create();

    fixture.destroy();

    expect(registry.unsubscribe).toHaveBeenCalled();
  });

  it('signs out through the session', async () => {
    session.isAuthenticated.set(true);
    const fixture = create();

    const signOut = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ).find((b) => (b as HTMLElement).textContent?.includes('Sign out')) as HTMLButtonElement;
    signOut.click();

    expect(session.logout).toHaveBeenCalled();
  });
});
