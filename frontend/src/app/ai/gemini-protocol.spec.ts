import { describe, expect, it } from 'vitest';
import {
  parseGenerateContentResponse,
  turnsToContents,
  type WireGenerateContentResponse,
  type WirePart,
} from './gemini-protocol';

/** Narrow view for asserting on the one field these tests care about. */
type Signed = { thoughtSignature?: string; functionCall?: unknown };
const signed = (part: WirePart): Signed => part as unknown as Signed;


/**
 * Gemini 3 attaches an opaque `thoughtSignature` to function-call parts and
 * rejects the next request if the replayed model turn omits it:
 *
 *   HTTP 400 — "Function call is missing a thought_signature in functionCall
 *   parts. This is required for tools to work correctly."
 *
 * Google's SDKs hide this. We call REST directly, so it is ours to preserve —
 * and it only breaks on the SECOND request of a tool loop, which is why no
 * single-turn test caught it.
 */
describe('thought signatures (multi-turn function calling)', () => {
  function responseWithSignature(signature = 'sig-abc123'): WireGenerateContentResponse {
    return {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              { functionCall: { name: 'get_budget_status', args: {} }, thoughtSignature: signature },
            ],
          },
          finishReason: 'STOP',
        },
      ],
      modelVersion: 'gemini-3-pro',
    };
  }

  it('parses the signature onto the function call', () => {
    const result = parseGenerateContentResponse(responseWithSignature(), 'gemini-3-pro');
    expect(result.functionCalls[0].thoughtSignature).toBe('sig-abc123');
  });

  it('keeps the raw parts on the model turn', () => {
    const result = parseGenerateContentResponse(responseWithSignature(), 'gemini-3-pro');
    expect(result.turn).toMatchObject({ role: 'model' });
    expect(result.turn.role === 'model' && result.turn.parts?.[0]).toMatchObject({
      thoughtSignature: 'sig-abc123',
    });
  });

  // The actual regression: replaying the turn must not strip the signature.
  it('round-trips the signature back into contents', () => {
    const result = parseGenerateContentResponse(responseWithSignature(), 'gemini-3-pro');
    const contents = turnsToContents([{ role: 'user', text: 'budget?' }, result.turn]);

    const modelContent = contents.find((c) => c.role === 'model');
    expect(modelContent).toBeDefined();
    const part = signed(modelContent!.parts[0]);
    expect(part.thoughtSignature).toBe('sig-abc123');
    expect(part.functionCall).toBeDefined();
  });

  it('gives each parallel call its own signature, unswapped', () => {
    const response: WireGenerateContentResponse = {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              { functionCall: { id: 'a', name: 'search_expenses', args: {} }, thoughtSignature: 'sig-1' },
              { functionCall: { id: 'b', name: 'get_budget_status', args: {} }, thoughtSignature: 'sig-2' },
            ],
          },
          finishReason: 'STOP',
        },
      ],
    };
    const result = parseGenerateContentResponse(response, 'gemini-3-pro');
    expect(result.functionCalls.map((c) => c.thoughtSignature)).toEqual(['sig-1', 'sig-2']);

    const contents = turnsToContents([result.turn]);
    expect(contents[0].parts.map((p) => signed(p).thoughtSignature)).toEqual(['sig-1', 'sig-2']);
  });

  it('preserves thought text parts, which also carry signatures', () => {
    const response: WireGenerateContentResponse = {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              { text: 'considering budgets', thought: true, thoughtSignature: 'sig-thought' },
              { functionCall: { name: 'get_budget_status', args: {} }, thoughtSignature: 'sig-call' },
            ],
          },
        },
      ],
    };
    const result = parseGenerateContentResponse(response, 'gemini-3-pro');
    // Thought text stays out of the visible answer...
    expect(result.text).toBe('');
    expect(result.thoughts).toBe('considering budgets');
    // ...but is replayed verbatim, because the API wants it back untouched.
    const parts = turnsToContents([result.turn])[0].parts;
    expect(parts).toHaveLength(2);
    expect(signed(parts[0]).thoughtSignature).toBe('sig-thought');
  });

  it('still serializes hand-built turns that carry no raw parts', () => {
    const contents = turnsToContents([
      {
        role: 'model',
        functionCalls: [{ name: 'search_expenses', args: { q: 'x' }, thoughtSignature: 'sig-manual' },
        ],
      },
    ]);
    expect(signed(contents[0].parts[0]).thoughtSignature).toBe('sig-manual');
  });

  it('omits the field entirely when the model sent none', () => {
    const response: WireGenerateContentResponse = {
      candidates: [
        { content: { role: 'model', parts: [{ functionCall: { name: 'search_expenses', args: {} } }] } },
      ],
    };
    const result = parseGenerateContentResponse(response, 'gemini-2.5-flash');
    const part = turnsToContents([result.turn])[0].parts[0];
    expect('thoughtSignature' in part).toBe(false);
  });
});
