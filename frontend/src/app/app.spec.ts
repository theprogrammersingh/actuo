import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { Session } from './core/session/session.js';
import { ToolSession } from './webmcp/tool-session.js';
import { Copilot } from './copilot/copilot.js';

function createSession(overrides: Record<string, unknown> = {}) {
  return {
    isAuthenticated: signal(false),
    role: signal<string | null>(null),
    pendingApprovals: signal(0),
    ready: signal(true),
    logout: vi.fn().mockResolvedValue(undefined),
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

describe('App shell', () => {
  let session: ReturnType<typeof createSession>;
  let tools: ReturnType<typeof createToolSession>;

  function create() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: Session, useValue: session },
        { provide: ToolSession, useValue: tools },
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
