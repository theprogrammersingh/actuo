import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../core/api/api-client.js';
import { ToolRegistry } from './tool-registry.js';
import { ToolSession } from './tool-session.js';

describe('ToolSession (state-gated approve_expense)', () => {
  let session: ToolSession;
  let registry: ToolRegistry;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiClient, useValue: { get: vi.fn(), post: vi.fn() } },
        // No WebMCP in the test environment: registration falls back to the
        // local map, which is exactly the no-flag browser case.
        {
          provide: DOCUMENT,
          useValue: { modelContext: undefined, location: { origin: 'https://actuo.app' } },
        },
      ],
    });
    session = TestBed.inject(ToolSession);
    registry = TestBed.inject(ToolRegistry);
  });

  it('publishes the always-on tools on start', async () => {
    await session.start();
    expect([...registry.registeredNames()].sort()).toEqual([
      'download_report',
      'fetch_categories',
      'generate_report',
      'get_budget_status',
      'get_spend_summary',
      'search_expenses',
      'submit_expense',
    ]);
  });

  it('does not expose approve_expense to a member, even with items pending', async () => {
    await session.start();
    session.setRole('member');
    session.setPendingApprovals(3);
    TestBed.tick();

    expect(registry.has('approve_expense')).toBe(false);
  });

  it('does not expose approve_expense to an admin with nothing pending', async () => {
    await session.start();
    session.setRole('admin');
    session.setPendingApprovals(0);
    TestBed.tick();

    expect(registry.has('approve_expense')).toBe(false);
  });

  it('exposes approve_expense only when role AND pending work coincide', async () => {
    await session.start();
    session.setRole('admin');
    session.setPendingApprovals(2);
    TestBed.tick();

    expect(registry.has('approve_expense')).toBe(true);
  });

  it('retires approve_expense when the queue empties', async () => {
    await session.start();
    session.setRole('owner');
    session.setPendingApprovals(1);
    TestBed.tick();
    expect(registry.has('approve_expense')).toBe(true);

    session.setPendingApprovals(0);
    TestBed.tick();
    expect(registry.has('approve_expense')).toBe(false);
  });

  it('retires approve_expense on demotion', async () => {
    await session.start();
    session.setRole('owner');
    session.setPendingApprovals(1);
    TestBed.tick();
    expect(registry.has('approve_expense')).toBe(true);

    session.setRole('member');
    TestBed.tick();
    expect(registry.has('approve_expense')).toBe(false);
  });

  it('clears every tool on sign-out', async () => {
    await session.start();
    session.setRole('owner');
    session.setPendingApprovals(1);
    TestBed.tick();

    session.stop();
    expect(registry.registeredNames()).toHaveLength(0);
  });
});
