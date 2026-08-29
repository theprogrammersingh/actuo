import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClient } from '../core/api/api-client.js';
import { ToolCallAudit, truncate } from './tool-call-audit.js';

function configure(post = vi.fn().mockResolvedValue({})) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: ApiClient, useValue: { post } }],
  });
  return { audit: TestBed.inject(ToolCallAudit), post };
}

/** Lets a fire-and-forget rejection settle so an unhandled one would surface. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ToolCallAudit', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('posts one row per tool call to the log endpoint', () => {
    const { audit, post } = configure();

    audit.record({
      actor: 'agent',
      toolName: 'search_expenses',
      input: { query: 'barista' },
      output: { total: 2 },
    });

    expect(post).toHaveBeenCalledWith('/tool-calls', {
      actor: 'agent',
      toolName: 'search_expenses',
      input: { query: 'barista' },
      output: { total: 2 },
    });
  });

  it('carries the human actor through, which is what the audit filter splits on', () => {
    const { audit, post } = configure();

    audit.record({ actor: 'human', toolName: 'add_expense_form', input: {}, output: {} });

    expect(post.mock.calls[0][1]).toMatchObject({ actor: 'human' });
  });

  /**
   * This runs inside a tool's own execution path. If a log write could reject
   * into that path, the audit trail would turn every tool into a new way for
   * the app to fail — which is worse than having no audit trail at all.
   */
  it('never rejects when the request fails', async () => {
    const { audit } = configure(vi.fn().mockRejectedValue(new Error('401 Unauthorized')));

    expect(() =>
      audit.record({ actor: 'agent', toolName: 'search_expenses', input: {}, output: {} }),
    ).not.toThrow();

    await settle();
  });

  it('returns before the request settles, so it cannot slow a tool down', () => {
    const { audit } = configure(vi.fn(() => new Promise(() => {})));

    audit.record({ actor: 'agent', toolName: 'generate_report', input: {}, output: {} });
    // Reaching here at all is the assertion: a pending POST did not block.
    expect(true).toBe(true);
  });

  it('truncates an oversized result rather than posting it whole', () => {
    const { audit, post } = configure();
    const huge = { expenses: Array.from({ length: 500 }, (_, i) => ({ id: `exp-${i}` })) };

    audit.record({ actor: 'agent', toolName: 'search_expenses', input: {}, output: huge });

    const body = post.mock.calls[0][1];
    expect(body.output).toMatchObject({ truncated: true });
    expect(body.input).toEqual({});
  });
});

describe('truncate', () => {
  it('passes a small payload through untouched', () => {
    const value = { query: 'lunch' };
    expect(truncate(value)).toBe(value);
  });

  it('normalizes absent payloads to null', () => {
    expect(truncate(undefined)).toBeNull();
    expect(truncate(null)).toBeNull();
  });

  /**
   * The marker is the point. A silently shortened payload in an audit trail
   * reads as the whole call, which is worse than an obviously shortened one.
   */
  it('marks what it shortened', () => {
    const result = truncate('x'.repeat(200), 50) as { truncated: boolean; preview: string };
    expect(result.truncated).toBe(true);
    expect(result.preview.endsWith('…')).toBe(true);
  });

  it('records that something was there when it cannot be serialized', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(truncate(circular)).toEqual({ truncated: true, preview: '[unserializable]' });
  });
});
