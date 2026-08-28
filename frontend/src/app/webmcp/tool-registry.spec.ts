import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SEARCH_EXPENSES, SUBMIT_EXPENSE } from '@actuo/shared';
import { ToolRegistry, parseToolResult } from './tool-registry.js';

/** A minimal stand-in for document.modelContext. */
function createModelContext(overrides: Record<string, unknown> = {}) {
  const target = new EventTarget();
  return Object.assign(target, {
    registerTool: vi.fn().mockResolvedValue(undefined),
    getTools: vi.fn().mockResolvedValue([]),
    ...overrides,
  });
}

function configure(modelContext: unknown, origin = 'https://actuo.app') {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: DOCUMENT,
        useValue: { modelContext, location: { origin } } as unknown as Document,
      },
    ],
  });
  return TestBed.inject(ToolRegistry);
}

describe('ToolRegistry', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('reports WebMCP as unsupported when the browser has no modelContext', () => {
    const registry = configure(undefined);
    expect(registry.isSupported()).toBe(false);
    expect(registry.canExecuteCrossOrigin()).toBe(false);
  });

  it('publishes registered tools to WebMCP when it is available', async () => {
    const context = createModelContext();
    const registry = configure(context);

    await registry.register({ contract: SEARCH_EXPENSES, execute: async () => ({ items: [] }) });

    expect(context.registerTool).toHaveBeenCalledOnce();
    const [descriptor] = context.registerTool.mock.calls[0];
    expect(descriptor.name).toBe('search_expenses');
    expect(descriptor.inputSchema).toEqual(SEARCH_EXPENSES.inputSchema);
    expect(descriptor.annotations).toEqual({ readOnlyHint: true });
  });

  /**
   * The core reason this class exists: the Copilot must work with no WebMCP and
   * no executeTool(), because both are gated behind a Chrome flag.
   */
  it('invokes tools locally even when WebMCP is entirely absent', async () => {
    const registry = configure(undefined);
    const execute = vi.fn().mockResolvedValue({ ok: true });

    await registry.register({ contract: SEARCH_EXPENSES, execute });
    const result = await registry.invoke('search_expenses', { query: 'lunch' });

    expect(result).toEqual({ ok: true });
    expect(execute).toHaveBeenCalledWith({ query: 'lunch' }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('records every invocation, including failures', async () => {
    const registry = configure(undefined);
    await registry.register({ contract: SEARCH_EXPENSES, execute: async () => ({ n: 1 }) });
    await registry.register({
      contract: SUBMIT_EXPENSE,
      execute: async () => {
        throw new Error('nope');
      },
    });

    await registry.invoke('search_expenses', {});
    await expect(registry.invoke('submit_expense', {})).rejects.toThrow('nope');

    const log = registry.invocationLog();
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ toolName: 'search_expenses', origin: 'local' });
    expect(log[1]).toMatchObject({ toolName: 'submit_expense', error: 'nope' });
  });

  it('propagates cancellation into the tool execute callback', async () => {
    const registry = configure(undefined);
    const controller = new AbortController();

    await registry.register({
      contract: SEARCH_EXPENSES,
      execute: (_args, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('cancelled')));
        }),
    });

    const pending = registry.invoke('search_expenses', {}, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('cancelled');
  });

  it('throws a clear error for unknown tools', async () => {
    const registry = configure(undefined);
    await expect(registry.invoke('nope', {})).rejects.toThrow('Unknown tool: nope');
  });

  it('unregisters a tool by aborting its registration signal', async () => {
    const context = createModelContext();
    const registry = configure(context);

    await registry.register({ contract: SEARCH_EXPENSES, execute: async () => null });
    const [, options] = context.registerTool.mock.calls[0];
    expect(options.signal.aborted).toBe(false);

    registry.unregister('search_expenses');

    // Aborting the signal is what retires the tool and fires `toolchange`.
    expect(options.signal.aborted).toBe(true);
    expect(registry.has('search_expenses')).toBe(false);
    expect(registry.registeredNames()).not.toContain('search_expenses');
  });

  it('marks discovered tools from other origins as cross-origin', async () => {
    const context = createModelContext({
      getTools: vi.fn().mockResolvedValue([
        {
          name: 'list_books',
          title: '',
          description: 'List books.',
          inputSchema: JSON.stringify({ type: 'object' }),
          origin: 'https://partner-demo.app',
          window: globalThis.window,
        },
      ]),
    });
    const registry = configure(context);

    const tools = await registry.discover({ fromOrigins: ['https://partner-demo.app'] });

    expect(tools).toHaveLength(1);
    expect(tools[0].isCrossOrigin).toBe(true);
    expect(tools[0].title).toBe('list_books');
    expect(tools[0].inputSchema).toEqual({ type: 'object' });
  });

  it('survives a rejected discovery instead of breaking the page', async () => {
    // The polyfill rejects non-empty fromOrigins with NotSupportedError.
    const context = createModelContext({
      getTools: vi.fn().mockRejectedValue(new DOMException('nope', 'NotSupportedError')),
    });
    const registry = configure(context);

    await expect(registry.discover({ fromOrigins: ['https://x.app'] })).resolves.toEqual([]);
  });

  it('explains how to enable the flag when executeTool is unavailable', async () => {
    const context = createModelContext();
    const registry = configure(context);

    await expect(
      registry.invokeCrossOrigin(
        { name: 'list_books', raw: {} as WebMCP.RegisteredTool } as never,
        {},
      ),
    ).rejects.toThrow(/enable-webmcp-testing/);
  });

  it('passes cross-origin arguments to executeTool as a JSON string', async () => {
    const executeTool = vi.fn().mockResolvedValue('{"count":2}');
    const context = createModelContext({ executeTool });
    const registry = configure(context);

    const raw = { name: 'list_books' } as WebMCP.RegisteredTool;
    const result = await registry.invokeCrossOrigin(
      { name: 'list_books', raw } as never,
      { genre: 'sci-fi' },
    );

    expect(registry.canExecuteCrossOrigin()).toBe(true);
    // The API takes a serialized string, not an object.
    expect(executeTool).toHaveBeenCalledWith(raw, '{"genre":"sci-fi"}', expect.anything());
    expect(result).toEqual({ count: 2 });
  });
});

describe('parseToolResult', () => {
  it('parses JSON payloads', () => {
    expect(parseToolResult('{"a":1}')).toEqual({ a: 1 });
  });

  it('passes plain strings through', () => {
    expect(parseToolResult('done')).toBe('done');
  });

  it('maps null to null', () => {
    expect(parseToolResult(null)).toBeNull();
  });
});
