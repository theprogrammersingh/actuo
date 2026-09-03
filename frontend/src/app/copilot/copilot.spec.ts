import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SEARCH_EXPENSES, SUBMIT_EXPENSE } from '@actuo/shared';
import { GeminiClient, KeyStore } from '../ai';
import { ApiClient } from '../core/api/api-client.js';
import { ToolRegistry } from '../webmcp/tool-registry.js';
import { Copilot } from './copilot.js';

/** A generate() that returns each scripted result in turn. */
function scriptedGemini(...results: unknown[]) {
  const generate = vi.fn();
  for (const result of results) generate.mockResolvedValueOnce(result);
  return { generate, ready: () => true, model: () => 'gemini-3-pro' };
}

function textResult(text: string) {
  return { text, functionCalls: [], thoughts: '', model: 'gemini-3-pro', turn: { role: 'model', text } };
}

function callResult(name: string, args: Record<string, unknown>) {
  const functionCalls = [{ name, args }];
  return {
    text: '',
    functionCalls,
    thoughts: '',
    model: 'gemini-3-pro',
    turn: { role: 'model', functionCalls },
  };
}

describe('Copilot', () => {
  let registry: ToolRegistry;

  function setup(gemini: unknown, hasKey = true) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: GeminiClient, useValue: gemini },
        { provide: KeyStore, useValue: { hasKey: () => hasKey } },
        { provide: ApiClient, useValue: { get: vi.fn(), post: vi.fn() } },
        {
          provide: DOCUMENT,
          useValue: { modelContext: undefined, location: { origin: 'https://actuo.app' } },
        },
      ],
    });
    registry = TestBed.inject(ToolRegistry);
    return TestBed.inject(Copilot);
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('routes to key setup instead of failing silently when no key is set', async () => {
    const copilot = setup(scriptedGemini(), false);
    await copilot.send('hello');

    const entries = copilot.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'error', keyProblem: true });
    expect(entries[0].kind === 'error' ? entries[0].text : '').toContain('Settings');
  });

  it('renders a plain answer with no tool cards', async () => {
    const copilot = setup(scriptedGemini(textResult('You spent ₹4,200 on travel.')));
    await copilot.send('travel spend?');

    expect(copilot.entries().map((e) => e.kind)).toEqual(['user', 'assistant']);
  });

  it('runs a read-only tool without asking for confirmation', async () => {
    const gemini = scriptedGemini(
      callResult('search_expenses', { query: 'travel' }),
      textResult('Found 3.'),
    );
    const copilot = setup(gemini);
    const execute = vi.fn().mockResolvedValue({ total: 3 });
    await registry.register({ contract: SEARCH_EXPENSES, execute });

    await copilot.send('find travel expenses');

    expect(execute).toHaveBeenCalledOnce();
    const tool = copilot.entries().find((e) => e.kind === 'tool')!;
    expect(tool).toMatchObject({ name: 'search_expenses', state: 'done', mutates: false });
  });

  /** §3.2.4 — nothing that moves money runs silently. */
  it('waits for confirmation before running a mutating tool', async () => {
    const gemini = scriptedGemini(
      callResult('submit_expense', { amount: 450, currency: 'INR' }),
      textResult('Submitted.'),
    );
    const copilot = setup(gemini);
    const execute = vi.fn().mockResolvedValue({ id: 'exp-1' });
    await registry.register({ contract: SUBMIT_EXPENSE, execute });

    const pending = copilot.send('log ₹450 lunch');
    await vi.waitFor(() => expect(copilot.awaitingConfirmation()).toBe(true));

    // Still not executed while the card is waiting.
    expect(execute).not.toHaveBeenCalled();

    copilot.respondToConfirmation(true);
    await pending;

    expect(execute).toHaveBeenCalledOnce();
    expect(copilot.entries().find((e) => e.kind === 'tool')).toMatchObject({ state: 'done' });
  });

  it('does not run the tool when the user declines, and tells the model why', async () => {
    const gemini = scriptedGemini(
      callResult('submit_expense', { amount: 450, currency: 'INR' }),
      textResult('Cancelled, nothing was filed.'),
    );
    const copilot = setup(gemini);
    const execute = vi.fn();
    await registry.register({ contract: SUBMIT_EXPENSE, execute });

    const pending = copilot.send('log ₹450 lunch');
    await vi.waitFor(() => expect(copilot.awaitingConfirmation()).toBe(true));
    copilot.respondToConfirmation(false);
    await pending;

    expect(execute).not.toHaveBeenCalled();
    expect(copilot.entries().find((e) => e.kind === 'tool')).toMatchObject({ state: 'cancelled' });

    // The refusal is reported back so the model can respond sensibly.
    const secondCall = gemini.generate.mock.calls[1][0];
    const toolTurn = secondCall.turns.at(-1);
    expect(toolTurn.results[0].error).toContain('declined');
  });

  it('feeds a tool failure back to the model rather than throwing', async () => {
    const gemini = scriptedGemini(
      callResult('search_expenses', { query: 'x' }),
      textResult("I couldn't find a category called 'Food' — did you mean 'Dining'?"),
    );
    const copilot = setup(gemini);
    await registry.register({
      contract: SEARCH_EXPENSES,
      execute: vi.fn().mockRejectedValue(new Error('no such category')),
    });

    await copilot.send('food spend');

    expect(copilot.entries().find((e) => e.kind === 'tool')).toMatchObject({
      state: 'error',
      error: 'no such category',
    });
    const toolTurn = gemini.generate.mock.calls[1][0].turns.at(-1);
    expect(toolTurn.results[0].error).toBe('no such category');
    // The conversation continues; the user gets a specific explanation.
    expect(copilot.entries().at(-1)).toMatchObject({ kind: 'assistant' });
  });

  it('stops looping if the model never stops calling tools', async () => {
    const gemini = { generate: vi.fn().mockResolvedValue(callResult('search_expenses', {})), ready: () => true, model: () => 'x' };
    const copilot = setup(gemini);
    await registry.register({ contract: SEARCH_EXPENSES, execute: vi.fn().mockResolvedValue({}) });

    await copilot.send('loop forever');

    // Bounded, and the user is told rather than left with a spinner.
    expect(gemini.generate.mock.calls.length).toBeLessThanOrEqual(6);
    const last = copilot.entries().at(-1)!;
    expect(last.kind).toBe('assistant');
    expect(last.kind === 'assistant' ? last.text : '').toContain('narrow the request');
  });

  it('marks in-flight work cancelled when stopped', async () => {
    const gemini = scriptedGemini(callResult('generate_report', { from: 'a', to: 'b' }));
    const copilot = setup(gemini);
    await registry.register({
      contract: { ...SEARCH_EXPENSES, name: 'generate_report' },
      execute: () => new Promise(() => {}),
    });

    void copilot.send('report');
    await vi.waitFor(() =>
      expect(copilot.entries().some((e) => e.kind === 'tool' && e.state === 'running')).toBe(true),
    );

    copilot.stop();
    expect(copilot.entries().find((e) => e.kind === 'tool')).toMatchObject({ state: 'cancelled' });
    expect(copilot.isBusy()).toBe(false);
  });

  it('passes every registered tool to Gemini as a declaration', async () => {
    const gemini = scriptedGemini(textResult('hi'));
    const copilot = setup(gemini);
    await registry.register({ contract: SEARCH_EXPENSES, execute: vi.fn() });
    await registry.register({ contract: SUBMIT_EXPENSE, execute: vi.fn() });

    await copilot.send('hello');

    // Declarations are handed over raw; GeminiClient does the OpenAPI
    // translation and wrapping itself.
    const { tools } = gemini.generate.mock.calls[0][0];
    expect(tools.map((t: { name: string }) => t.name)).toEqual([
      'search_expenses',
      'submit_expense',
    ]);
    // The schema must still be present, or the model calls tools with no args.
    expect(tools[0].inputSchema).toEqual(SEARCH_EXPENSES.inputSchema);
  });

  /**
   * Cross-origin tools live only as long as the document that registered them.
   * Keeping them on the menu after the partner iframe is gone means the model
   * keeps calling a document that no longer exists, and every call fails with
   * a confusing error instead of the tool simply not being offered.
   */
  describe('cross-origin tools', () => {
    /** A modelContext that reports one tool from another origin. */
    function setupWithRemote() {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          { provide: GeminiClient, useValue: scriptedGemini() },
          { provide: KeyStore, useValue: { hasKey: () => true } },
          { provide: ApiClient, useValue: { get: vi.fn(), post: vi.fn() } },
          {
            provide: DOCUMENT,
            useValue: {
              location: { origin: 'https://actuo.app' },
              modelContext: Object.assign(new EventTarget(), {
                registerTool: vi.fn().mockResolvedValue(undefined),
                getTools: vi.fn().mockResolvedValue([
                  {
                    name: 'get_book_price',
                    title: 'Get book price',
                    description: 'Price of one book.',
                    inputSchema: { type: 'object', properties: {} },
                    origin: 'https://pageturner.example',
                    annotations: { readOnlyHint: true },
                  },
                  // Same-origin tools come back too and must be ignored: the
                  // registry already holds their execute functions locally.
                  {
                    name: 'search_expenses',
                    title: 'Search expenses',
                    description: 'Ours.',
                    inputSchema: { type: 'object', properties: {} },
                    origin: 'https://actuo.app',
                    annotations: { readOnlyHint: true },
                  },
                ]),
              }),
            },
          },
        ],
      });
      return TestBed.inject(Copilot);
    }

    it('keeps only genuinely cross-origin tools', async () => {
      const copilot = setupWithRemote();
      await copilot.discoverRemoteTools(['https://pageturner.example']);

      expect(copilot.crossOriginTools().map((t) => t.name)).toEqual(['get_book_price']);
    });

    it('forgets them when asked', async () => {
      const copilot = setupWithRemote();
      await copilot.discoverRemoteTools(['https://pageturner.example']);

      copilot.clearRemoteTools();

      expect(copilot.crossOriginTools()).toEqual([]);
    });

    /**
     * `getTools()` returns a descriptor per *window*, not per tool. The same
     * page framed here and also open in another tab publishes the same tool
     * twice, and nothing in the app can stop a user opening that tab.
     *
     * Left alone, `toolDeclarations()` hands Gemini two function declarations
     * with the same name — which is a malformed request, not a redundant one —
     * while `runTool()` resolves the call with `.find()` and picks whichever
     * arrived first anyway.
     */
    it('publishes one declaration per name when a page is open twice', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          { provide: GeminiClient, useValue: scriptedGemini() },
          { provide: KeyStore, useValue: { hasKey: () => true } },
          { provide: ApiClient, useValue: { get: vi.fn(), post: vi.fn() } },
          {
            provide: DOCUMENT,
            useValue: {
              location: { origin: 'https://actuo.app' },
              modelContext: Object.assign(new EventTarget(), {
                registerTool: vi.fn().mockResolvedValue(undefined),
                getTools: vi.fn().mockResolvedValue([
                  {
                    name: 'convertCurrency',
                    title: 'Convert currency',
                    description: 'From the framed window.',
                    inputSchema: { type: 'object', properties: {} },
                    origin: 'https://cambiaro.example',
                    annotations: { readOnlyHint: true },
                  },
                  {
                    name: 'convertCurrency',
                    title: 'Convert currency',
                    description: 'From the same page in another tab.',
                    inputSchema: { type: 'object', properties: {} },
                    origin: 'https://cambiaro.example',
                    annotations: { readOnlyHint: true },
                  },
                ]),
              }),
            },
          },
        ],
      });
      const copilot = TestBed.inject(Copilot);
      await copilot.discoverRemoteTools(['https://cambiaro.example']);

      const tools = copilot.crossOriginTools();
      expect(tools).toHaveLength(1);
      // First wins is fine; sending both is not.
      expect(tools[0].description).toContain('framed window');
    });
  });

  it('clears the conversation on reset', async () => {
    const copilot = setup(scriptedGemini(textResult('hi')));
    await copilot.send('hello');
    expect(copilot.entries().length).toBeGreaterThan(0);

    copilot.reset();
    expect(copilot.entries()).toHaveLength(0);
  });
});
