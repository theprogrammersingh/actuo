import '@angular/compiler';
import { Injector, PLATFORM_ID } from '@angular/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { ALL_TOOL_CONTRACTS, SEARCH_EXPENSES, SUBMIT_EXPENSE } from '@actuo/shared';

import { GeminiClient } from './gemini-client';
import { KeyStore } from './key-store';
import { GEMINI_API_KEY_HEADER, GEMINI_FETCH, type FetchLike } from './gemini-transport';
import { isGeminiError, type GeminiError } from './gemini-errors';
import type { GeminiTurn, WireGenerateContentRequest } from './gemini-protocol';

const TEST_KEY = 'AIzaSyTESTKEYtestkeyTESTKEYtestkey1234';

interface RecordedCall {
  url: string;
  init: RequestInit;
  body: WireGenerateContentRequest;
}

/** A queue-backed `fetch` that records everything it was asked to send. */
function fakeFetch(responses: Array<Response | (() => Promise<Response>)>) {
  const calls: RecordedCall[] = [];
  const queue = [...responses];

  const impl: FetchLike = async (url, init = {}) => {
    calls.push({
      url,
      init,
      body: JSON.parse(String(init.body ?? '{}')) as WireGenerateContentRequest,
    });
    const next = queue.shift();
    if (!next) throw new Error(`fake fetch: unexpected call ${calls.length} to ${url}`);
    return typeof next === 'function' ? next() : next;
  };

  return { impl, calls };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function textResponse(text: string): Response {
  return json({
    candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7, totalTokenCount: 18 },
  });
}

function functionCallResponse(
  calls: Array<{ name: string; args: Record<string, unknown>; id?: string }>,
  extraText?: string,
): Response {
  const parts: unknown[] = [];
  if (extraText) parts.push({ text: extraText });
  for (const call of calls) parts.push({ functionCall: call });
  return json({
    candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }],
  });
}

/**
 * A root-less injector with PLATFORM_ID 'server' — KeyStore therefore never
 * touches localStorage, and `setKey` only updates the in-memory signal, which
 * is all these tests need.
 */
function makeClient(fetchImpl: FetchLike, key: string | null = TEST_KEY) {
  const injector = Injector.create({
    providers: [
      { provide: PLATFORM_ID, useValue: 'server' },
      { provide: GEMINI_FETCH, useValue: fetchImpl },
      { provide: KeyStore, useClass: KeyStore, deps: [] },
      { provide: GeminiClient, useClass: GeminiClient, deps: [] },
    ],
  });
  const keys = injector.get(KeyStore);
  if (key) keys.setKey(key);
  return { client: injector.get(GeminiClient), keys };
}

const TOOLS = ALL_TOOL_CONTRACTS.map((contract) => ({
  name: contract.name,
  description: contract.description,
  inputSchema: contract.inputSchema,
}));

async function expectGeminiError(promise: Promise<unknown>): Promise<GeminiError> {
  try {
    await promise;
  } catch (error) {
    if (isGeminiError(error)) return error;
    throw error;
  }
  throw new Error('expected the call to reject with a GeminiError');
}

describe('GeminiClient', () => {
  describe('request shape', () => {
    it('calls the Gemini REST endpoint for the selected model', async () => {
      const { impl, calls } = fakeFetch([textResponse('hi')]);
      const { client, keys } = makeClient(impl);
      keys.setModel('gemini-3-flash');

      await client.generate({ turns: [{ role: 'user', text: 'hi' }] });

      expect(calls[0]!.url).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent',
      );
      expect(calls[0]!.init.method).toBe('POST');
    });

    it('sends the key as a header and never in the URL', async () => {
      const { impl, calls } = fakeFetch([textResponse('hi')]);
      const { client } = makeClient(impl);

      await client.generate({ turns: [{ role: 'user', text: 'hi' }] });

      const headers = calls[0]!.init.headers as Record<string, string>;
      expect(headers[GEMINI_API_KEY_HEADER]).toBe(TEST_KEY);
      expect(calls[0]!.url).not.toContain(TEST_KEY);
      expect(calls[0]!.url).not.toContain('key=');
      // No Actuo cookie rides along to Google.
      expect(calls[0]!.init.credentials).toBe('omit');
    });

    it('converts tool contracts into functionDeclarations', async () => {
      const { impl, calls } = fakeFetch([textResponse('hi')]);
      const { client } = makeClient(impl);

      await client.generate({
        turns: [{ role: 'user', text: 'find my travel spend' }],
        tools: TOOLS,
        systemInstruction: 'You are the Actuo Copilot.',
      });

      const body = calls[0]!.body;
      const declarations = body.tools![0].functionDeclarations;
      expect(declarations.map((d) => d.name)).toContain('search_expenses');
      expect(body.toolConfig).toEqual({ functionCallingConfig: { mode: 'AUTO' } });
      expect(body.systemInstruction).toEqual({
        parts: [{ text: 'You are the Actuo Copilot.' }],
      });

      // The Gemini dialect, not raw JSON Schema — see gemini-schema.spec.ts.
      const search = declarations.find((d) => d.name === 'search_expenses')!;
      expect(search.parameters!.type).toBe('OBJECT');
      expect(JSON.stringify(search)).not.toContain('additionalProperties');
    });

    it('omits tools and toolConfig when no tools are offered', async () => {
      const { impl, calls } = fakeFetch([textResponse('hi')]);
      const { client } = makeClient(impl);

      await client.generate({ turns: [{ role: 'user', text: 'hi' }] });

      expect(calls[0]!.body.tools).toBeUndefined();
      expect(calls[0]!.body.toolConfig).toBeUndefined();
    });

    it('maps toolMode onto the functionCallingConfig enum', async () => {
      const { impl, calls } = fakeFetch([textResponse('a'), textResponse('b')]);
      const { client } = makeClient(impl);

      await client.generate({ turns: [{ role: 'user', text: 'x' }], tools: TOOLS, toolMode: 'any' });
      await client.generate({ turns: [{ role: 'user', text: 'x' }], tools: TOOLS, toolMode: 'none' });

      expect(calls[0]!.body.toolConfig!.functionCallingConfig.mode).toBe('ANY');
      expect(calls[1]!.body.toolConfig!.functionCallingConfig.mode).toBe('NONE');
    });

    it('rejects with kind "no-key" before making any request when no key is stored', async () => {
      const { impl, calls } = fakeFetch([]);
      const { client } = makeClient(impl, null);

      const error = await expectGeminiError(client.generate({ turns: [{ role: 'user', text: 'x' }] }));
      expect(error.kind).toBe('no-key');
      expect(error.keyProblem).toBe(true);
      expect(calls).toHaveLength(0);
    });
  });

  describe('response parsing', () => {
    it('returns text when the model answers in prose', async () => {
      const { impl } = fakeFetch([textResponse('You spent ₹4,200 on travel.')]);
      const { client } = makeClient(impl);

      const result = await client.generate({ turns: [{ role: 'user', text: 'travel spend?' }] });

      expect(result.text).toBe('You spent ₹4,200 on travel.');
      expect(result.functionCalls).toEqual([]);
      expect(result.finishReason).toBe('STOP');
      expect(result.usage).toMatchObject({ promptTokens: 11, responseTokens: 7, totalTokens: 18 });
      expect(result.turn).toEqual({ role: 'model', text: 'You spent ₹4,200 on travel.' });
    });

    it('returns the model\'s chosen function calls with parsed args', async () => {
      const { impl } = fakeFetch([
        functionCallResponse([
          { name: 'search_expenses', args: { query: 'travel', limit: 5 } },
        ]),
      ]);
      const { client } = makeClient(impl);

      const result = await client.generate({
        turns: [{ role: 'user', text: 'travel spend?' }],
        tools: TOOLS,
      });

      expect(result.text).toBe('');
      expect(result.functionCalls).toEqual([
        { name: 'search_expenses', args: { query: 'travel', limit: 5 } },
      ]);
    });

    it('returns parallel function calls, preserving ids', async () => {
      const { impl } = fakeFetch([
        functionCallResponse([
          { id: 'call-1', name: 'search_expenses', args: { query: 'travel' } },
          { id: 'call-2', name: 'get_budget_status', args: {} },
        ]),
      ]);
      const { client } = makeClient(impl);

      const result = await client.generate({ turns: [{ role: 'user', text: 'x' }], tools: TOOLS });

      expect(result.functionCalls).toHaveLength(2);
      expect(result.functionCalls[0]).toEqual({
        id: 'call-1',
        name: 'search_expenses',
        args: { query: 'travel' },
      });
      expect(result.functionCalls[1]!.args).toEqual({});
    });

    it('defaults missing args to an empty object', async () => {
      const { impl } = fakeFetch([
        json({ candidates: [{ content: { parts: [{ functionCall: { name: 'get_budget_status' } }] } }] }),
      ]);
      const { client } = makeClient(impl);

      const result = await client.generate({ turns: [{ role: 'user', text: 'x' }], tools: TOOLS });
      expect(result.functionCalls[0]).toEqual({ name: 'get_budget_status', args: {} });
    });

    it('separates Gemini 3 thought summaries from the visible answer', async () => {
      const { impl } = fakeFetch([
        json({
          candidates: [
            {
              content: {
                parts: [
                  { text: 'Checking budgets first.', thought: true },
                  { text: 'You are under budget.' },
                ],
              },
              finishReason: 'STOP',
            },
          ],
        }),
      ]);
      const { client } = makeClient(impl);

      const result = await client.generate({ turns: [{ role: 'user', text: 'x' }] });
      expect(result.text).toBe('You are under budget.');
      expect(result.thoughts).toBe('Checking budgets first.');
    });

    it('reports a blocked prompt as kind "blocked", not a generic failure', async () => {
      const { impl } = fakeFetch([json({ promptFeedback: { blockReason: 'SAFETY' } })]);
      const { client } = makeClient(impl);

      const error = await expectGeminiError(client.generate({ turns: [{ role: 'user', text: 'x' }] }));
      expect(error.kind).toBe('blocked');
      expect(error.message).toContain('safety filters');
    });

    it('reports an empty candidate list as kind "malformed-response"', async () => {
      const { impl } = fakeFetch([json({ candidates: [] })]);
      const { client } = makeClient(impl);

      const error = await expectGeminiError(client.generate({ turns: [{ role: 'user', text: 'x' }] }));
      expect(error.kind).toBe('malformed-response');
    });

    it('reports a 200 that is not JSON as kind "malformed-response"', async () => {
      const { impl } = fakeFetch([new Response('<html>nope</html>', { status: 200 })]);
      const { client } = makeClient(impl);

      const error = await expectGeminiError(client.generate({ turns: [{ role: 'user', text: 'x' }] }));
      expect(error.kind).toBe('malformed-response');
    });
  });

  describe('multi-turn function calling', () => {
    it('round-trips a tool result back to the model and gets a final answer', async () => {
      const { impl, calls } = fakeFetch([
        functionCallResponse([
          { name: 'search_expenses', args: { query: 'travel', status: 'approved' } },
        ]),
        textResponse('You have 3 approved travel expenses totalling ₹4,200.'),
      ]);
      const { client } = makeClient(impl);

      const turns: GeminiTurn[] = [{ role: 'user', text: 'how much approved travel spend?' }];

      // -- turn 1: the model asks for a tool ---------------------------------
      const first = await client.generate({ turns, tools: TOOLS });
      expect(first.functionCalls).toHaveLength(1);
      expect(first.functionCalls[0]!.name).toBe('search_expenses');

      // -- run the tool, feed the result back --------------------------------
      turns.push(first.turn);
      turns.push({
        role: 'tool',
        results: [
          {
            name: 'search_expenses',
            response: { count: 3, total: 4200, currency: 'INR' },
          },
        ],
      });

      const second = await client.generate({ turns, tools: TOOLS });
      expect(second.functionCalls).toEqual([]);
      expect(second.text).toContain('₹4,200');

      // -- the second request carried the whole conversation -----------------
      const contents = calls[1]!.body.contents;
      expect(contents).toHaveLength(3);
      expect(contents[0]).toEqual({
        role: 'user',
        parts: [{ text: 'how much approved travel spend?' }],
      });
      expect(contents[1]).toEqual({
        role: 'model',
        parts: [
          {
            functionCall: {
              name: 'search_expenses',
              args: { query: 'travel', status: 'approved' },
            },
          },
        ],
      });
      // Tool results go back as a `user` turn — `contents` accepts no other role.
      expect(contents[2]).toEqual({
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'search_expenses',
              response: { count: 3, total: 4200, currency: 'INR' },
            },
          },
        ],
      });
    });

    it('chains a second tool call across three turns', async () => {
      const { impl, calls } = fakeFetch([
        functionCallResponse([{ name: 'get_budget_status', args: { category: 'Travel' } }]),
        functionCallResponse([{ name: 'search_expenses', args: { query: 'Travel' } }], 'Digging deeper.'),
        textResponse('Travel is 82% used, driven by two flights.'),
      ]);
      const { client } = makeClient(impl);

      const turns: GeminiTurn[] = [{ role: 'user', text: 'why is travel nearly out of budget?' }];

      let result = await client.generate({ turns, tools: TOOLS });
      let guard = 0;
      while (result.functionCalls.length > 0 && guard++ < 5) {
        turns.push(result.turn);
        turns.push({
          role: 'tool',
          results: result.functionCalls.map((call) => ({
            name: call.name,
            response: { ok: true },
          })),
        });
        result = await client.generate({ turns, tools: TOOLS });
      }

      expect(guard).toBe(2);
      expect(result.text).toContain('82%');
      // Turn 2's model turn carried both prose and a call; both are replayed.
      expect(calls[2]!.body.contents[3]).toEqual({
        role: 'model',
        parts: [
          { text: 'Digging deeper.' },
          { functionCall: { name: 'search_expenses', args: { query: 'Travel' } } },
        ],
      });
    });

    it('echoes the call id on the matching functionResponse', async () => {
      const { impl, calls } = fakeFetch([textResponse('done')]);
      const { client } = makeClient(impl);

      await client.generate({
        turns: [
          { role: 'user', text: 'x' },
          { role: 'model', functionCalls: [{ id: 'call-9', name: 'search_expenses', args: {} }] },
          { role: 'tool', results: [{ id: 'call-9', name: 'search_expenses', response: { n: 1 } }] },
        ],
      });

      const parts = calls[0]!.body.contents[2]!.parts as Array<{
        functionResponse: { id?: string };
      }>;
      expect(parts[0]!.functionResponse.id).toBe('call-9');
    });

    it('wraps a non-object tool result so Gemini gets the object it requires', async () => {
      const { impl, calls } = fakeFetch([textResponse('ok')]);
      const { client } = makeClient(impl);

      await client.generate({
        turns: [
          { role: 'user', text: 'x' },
          { role: 'model', functionCalls: [{ name: 'generate_report', args: {} }] },
          {
            role: 'tool',
            results: [
              { name: 'generate_report', response: 'date,amount\n2026-08-01,120' },
              { name: 'search_expenses', response: [1, 2, 3] },
            ],
          },
        ],
      });

      const parts = calls[0]!.body.contents[2]!.parts as Array<{
        functionResponse: { response: Record<string, unknown> };
      }>;
      expect(parts[0]!.functionResponse.response).toEqual({
        result: 'date,amount\n2026-08-01,120',
      });
      expect(parts[1]!.functionResponse.response).toEqual({ result: [1, 2, 3] });
    });

    it('sends a tool failure as a structured error the model can recover from', async () => {
      const { impl, calls } = fakeFetch([textResponse('ok')]);
      const { client } = makeClient(impl);

      await client.generate({
        turns: [
          { role: 'user', text: 'x' },
          { role: 'model', functionCalls: [{ name: 'submit_expense', args: {} }] },
          {
            role: 'tool',
            results: [{ name: 'submit_expense', error: 'User declined the confirmation.' }],
          },
        ],
      });

      const parts = calls[0]!.body.contents[2]!.parts as Array<{
        functionResponse: { response: Record<string, unknown> };
      }>;
      expect(parts[0]!.functionResponse.response).toEqual({
        error: 'User declined the confirmation.',
      });
    });
  });

  describe('cancellation', () => {
    /** A fetch that only ever settles by rejecting when its signal aborts. */
    function hangingFetch() {
      let seenSignal: AbortSignal | undefined;
      const impl: FetchLike = (_url, init = {}) =>
        new Promise<Response>((_resolve, reject) => {
          seenSignal = init.signal ?? undefined;
          if (!seenSignal) {
            reject(new Error('no AbortSignal was propagated to fetch'));
            return;
          }
          seenSignal.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        });
      return { impl, getSignal: () => seenSignal };
    }

    it('propagates the AbortSignal to fetch and rejects with kind "aborted"', async () => {
      const { impl, getSignal } = hangingFetch();
      const { client } = makeClient(impl);
      const controller = new AbortController();

      const pending = client.generate(
        { turns: [{ role: 'user', text: 'generate a huge report' }], tools: TOOLS },
        { signal: controller.signal },
      );

      // The signal we handed in is the one fetch received.
      await Promise.resolve();
      expect(getSignal()).toBe(controller.signal);

      controller.abort();

      const error = await expectGeminiError(pending);
      expect(error.kind).toBe('aborted');
      expect(error.retryable).toBe(false);
      expect(error.message).toBe('The Gemini request was cancelled.');
    });

    it('does not even call fetch when the signal is already aborted', async () => {
      const { impl, calls } = fakeFetch([textResponse('never')]);
      const { client } = makeClient(impl);
      const controller = new AbortController();
      controller.abort();

      const error = await expectGeminiError(
        client.generate({ turns: [{ role: 'user', text: 'x' }] }, { signal: controller.signal }),
      );

      expect(error.kind).toBe('aborted');
      expect(calls).toHaveLength(0);
    });

    it('reports an abort during the request as "aborted", not "network"', async () => {
      const controller = new AbortController();
      const impl: FetchLike = async () => {
        controller.abort();
        throw new DOMException('The operation was aborted.', 'AbortError');
      };
      const { client } = makeClient(impl);

      const error = await expectGeminiError(
        client.generate({ turns: [{ role: 'user', text: 'x' }] }, { signal: controller.signal }),
      );
      expect(error.kind).toBe('aborted');
    });
  });

  describe('error mapping', () => {
    async function failWith(response: Response | (() => Promise<Response>)) {
      const { client } = makeClient(fakeFetch([response]).impl);
      return expectGeminiError(client.generate({ turns: [{ role: 'user', text: 'x' }] }));
    }

    it('401 -> invalid-key, with a message that names the fix', async () => {
      const error = await failWith(
        json({ error: { code: 401, message: 'API key not valid.', status: 'UNAUTHENTICATED' } }, 401),
      );
      expect(error.kind).toBe('invalid-key');
      expect(error.status).toBe(401);
      expect(error.keyProblem).toBe(true);
      expect(error.retryable).toBe(false);
      expect(error.message).toContain('aistudio.google.com/apikey');
    });

    it('400 API_KEY_INVALID -> invalid-key, because that is what Gemini actually returns', async () => {
      const error = await failWith(
        json(
          {
            error: {
              code: 400,
              message: 'API key not valid. Please pass a valid API key.',
              status: 'INVALID_ARGUMENT',
            },
          },
          400,
        ),
      );
      expect(error.kind).toBe('invalid-key');
    });

    it('403 -> permission-denied, distinct from a bad key', async () => {
      const error = await failWith(
        json({ error: { code: 403, message: 'Requests from referer are blocked.' } }, 403),
      );
      expect(error.kind).toBe('permission-denied');
      expect(error.keyProblem).toBe(true);
      expect(error.message).toContain('Requests from referer are blocked.');
    });

    it('404 -> model-not-found, naming the model that does not exist', async () => {
      const { client, keys } = makeClient(
        fakeFetch([json({ error: { code: 404, message: 'models/gemini-9-ultra is not found' } }, 404)])
          .impl,
      );
      keys.setModel('gemini-9-ultra');

      const error = await expectGeminiError(client.generate({ turns: [{ role: 'user', text: 'x' }] }));
      expect(error.kind).toBe('model-not-found');
      expect(error.model).toBe('gemini-9-ultra');
      expect(error.message).toContain('gemini-9-ultra');
      expect(error.message).toContain('Settings');
    });

    it('429 -> rate-limited and retryable, reading Retry-After', async () => {
      const error = await failWith(
        json({ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }, 429, { 'retry-after': '31' }),
      );
      expect(error.kind).toBe('rate-limited');
      expect(error.retryable).toBe(true);
      expect(error.retryAfterSeconds).toBe(31);
      expect(error.message).toContain('31s');
    });

    it('429 -> reads retryDelay out of Google error details when there is no header', async () => {
      const error = await failWith(
        json(
          {
            error: {
              code: 429,
              status: 'RESOURCE_EXHAUSTED',
              details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '48s' }],
            },
          },
          429,
        ),
      );
      expect(error.retryAfterSeconds).toBe(48);
    });

    it('500 -> server-error and retryable', async () => {
      const error = await failWith(json({ error: { code: 500, message: 'Internal error' } }, 500));
      expect(error.kind).toBe('server-error');
      expect(error.retryable).toBe(true);
      expect(error.keyProblem).toBe(false);
    });

    it('other 4xx -> invalid-request, quoting what Gemini objected to', async () => {
      const error = await failWith(
        json({ error: { code: 400, message: 'Invalid JSON payload: unknown field "foo".' } }, 400),
      );
      expect(error.kind).toBe('invalid-request');
      expect(error.message).toContain('unknown field');
    });

    it('a fetch rejection -> network, and says the failure was browser-to-Google', async () => {
      const impl: FetchLike = async () => {
        throw new TypeError('Failed to fetch');
      };
      const { client } = makeClient(impl);

      const error = await expectGeminiError(client.generate({ turns: [{ role: 'user', text: 'x' }] }));
      expect(error.kind).toBe('network');
      expect(error.retryable).toBe(true);
      expect(error.message).toContain('generativelanguage.googleapis.com');
      expect(error.message).toContain("nothing was sent to Actuo's servers");
    });

    it('a non-JSON error body still produces a typed error', async () => {
      const error = await failWith(new Response('<html>502 Bad Gateway</html>', { status: 502 }));
      expect(error.kind).toBe('server-error');
      expect(error.status).toBe(502);
    });

    it('never leaks the API key into an error message, even if the server echoes it', async () => {
      const error = await failWith(
        json({ error: { code: 400, message: `API key ${TEST_KEY} was rejected for project x` } }, 400),
      );
      expect(error.message).not.toContain(TEST_KEY);
      expect(error.detail ?? '').not.toContain(TEST_KEY);
      expect(JSON.stringify(error.message + (error.detail ?? ''))).toContain('[redacted]');
    });
  });

  describe('testKey', () => {
    it('passes on any 2xx, without depending on the response having candidates', async () => {
      // A valid key can still yield an empty candidate list (safety, token cap).
      const { impl, calls } = fakeFetch([json({ candidates: [] })]);
      const { client } = makeClient(impl);

      const result = await client.testKey();

      expect(result.ok).toBe(true);
      expect(result.model).toBe('gemini-3-pro');
      expect(result.message).toContain('Key works');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      // One cheap call: no tools, tiny output budget.
      expect(calls).toHaveLength(1);
      expect(calls[0]!.body.tools).toBeUndefined();
      expect(calls[0]!.body.generationConfig).toEqual({ temperature: 0, maxOutputTokens: 8 });
    });

    it('tests a key the user has typed but not saved yet', async () => {
      const { impl, calls } = fakeFetch([json({ candidates: [] })]);
      const { client } = makeClient(impl, null);

      const result = await client.testKey({ apiKey: 'AIzaUNSAVEDkeyUNSAVEDkeyUNSAVED1234', model: 'gemini-3-flash' });

      expect(result.ok).toBe(true);
      const headers = calls[0]!.init.headers as Record<string, string>;
      expect(headers[GEMINI_API_KEY_HEADER]).toBe('AIzaUNSAVEDkeyUNSAVEDkeyUNSAVED1234');
      expect(calls[0]!.url).toContain('gemini-3-flash');
    });

    it('fails with the typed error rather than throwing', async () => {
      const { impl } = fakeFetch([json({ error: { code: 401, status: 'UNAUTHENTICATED' } }, 401)]);
      const { client } = makeClient(impl);

      const result = await client.testKey();

      expect(result.ok).toBe(false);
      expect(result.error?.kind).toBe('invalid-key');
      expect(result.message).toBe(result.error!.message);
    });

    it('fails cleanly when no key is stored at all', async () => {
      const { impl, calls } = fakeFetch([]);
      const { client } = makeClient(impl, null);

      const result = await client.testKey();

      expect(result.ok).toBe(false);
      expect(result.error?.kind).toBe('no-key');
      expect(calls).toHaveLength(0);
    });
  });

  describe('ready', () => {
    it('tracks the key store', () => {
      const { impl } = fakeFetch([]);
      const { client, keys } = makeClient(impl, null);

      expect(client.ready()).toBe(false);
      keys.setKey(TEST_KEY);
      expect(client.ready()).toBe(true);
      keys.clearKey();
      expect(client.ready()).toBe(false);
    });
  });

  describe('buildRequest', () => {
    let build: (r: Parameters<GeminiClient['buildRequest']>[0]) => WireGenerateContentRequest;

    beforeEach(() => {
      const { client } = makeClient(fakeFetch([]).impl);
      build = (r) => client.buildRequest(r);
    });

    it('never contains the API key — the key lives only in the headers', () => {
      const body = build({
        turns: [{ role: 'user', text: 'x' }],
        tools: TOOLS,
        apiKey: TEST_KEY,
      });
      expect(JSON.stringify(body)).not.toContain(TEST_KEY);
    });

    it('drops empty turns rather than sending empty parts arrays', () => {
      const body = build({
        turns: [
          { role: 'user', text: '' },
          { role: 'model' },
          { role: 'tool', results: [] },
          { role: 'user', text: 'real' },
        ],
      });
      expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'real' }] }]);
    });

    it('keeps schema conversion identical to toGeminiSchema', () => {
      const body = build({
        turns: [{ role: 'user', text: 'x' }],
        tools: [
          { name: SEARCH_EXPENSES.name, description: 'd', inputSchema: SEARCH_EXPENSES.inputSchema },
          { name: SUBMIT_EXPENSE.name, description: 'd', inputSchema: SUBMIT_EXPENSE.inputSchema },
        ],
      });
      const serialized = JSON.stringify(body.tools);
      expect(serialized).not.toContain('additionalProperties');
      expect(serialized).not.toContain('"format":"date"');
      expect(serialized).not.toContain('exclusiveMinimum');
    });
  });
});
