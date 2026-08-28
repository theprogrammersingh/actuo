import { describe, expect, it } from 'vitest';
import { normalizeRegisteredTool, parseInputSchema } from './webmcp.types.js';

const SCHEMA = { type: 'object', properties: { q: { type: 'string' } } };

function descriptor(overrides: Partial<WebMCP.RegisteredTool> = {}): WebMCP.RegisteredTool {
  return {
    name: 'search_expenses',
    title: 'Search expenses',
    description: 'Search expenses.',
    inputSchema: SCHEMA,
    window: globalThis.window,
    origin: 'https://actuo.app',
    ...overrides,
  } as WebMCP.RegisteredTool;
}

describe('parseInputSchema', () => {
  // Chrome 154+ returns an object.
  it('passes an object schema through', () => {
    expect(parseInputSchema(SCHEMA)).toEqual(SCHEMA);
  });

  // Chrome 149-153 - most of the origin-trial population - returns a JSON string.
  it('parses the serialized-string form returned by Chrome 149-153', () => {
    expect(parseInputSchema(JSON.stringify(SCHEMA))).toEqual(SCHEMA);
  });

  it('returns undefined rather than throwing on a malformed schema', () => {
    expect(parseInputSchema('{not json')).toBeUndefined();
  });

  it('returns undefined for absent or non-object schemas', () => {
    expect(parseInputSchema(undefined)).toBeUndefined();
    expect(parseInputSchema(null)).toBeUndefined();
    expect(parseInputSchema('[1,2]')).toBeUndefined();
  });
});

describe('normalizeRegisteredTool', () => {
  it('falls back to the name when title is the empty string', () => {
    // The spec defaults an absent title to '', so `?? name` would yield ''.
    const normalized = normalizeRegisteredTool(descriptor({ title: '' }), 'https://actuo.app');
    expect(normalized.title).toBe('search_expenses');
  });

  it('keeps a real title', () => {
    const normalized = normalizeRegisteredTool(descriptor(), 'https://actuo.app');
    expect(normalized.title).toBe('Search expenses');
  });

  it('flags a tool from another origin', () => {
    const sameOrigin = normalizeRegisteredTool(descriptor(), 'https://actuo.app');
    expect(sameOrigin.isCrossOrigin).toBe(false);

    const crossOrigin = normalizeRegisteredTool(
      descriptor({ origin: 'https://partner-demo.app' }),
      'https://actuo.app',
    );
    expect(crossOrigin.isCrossOrigin).toBe(true);
  });

  it('normalizes the string schema form while normalizing the descriptor', () => {
    const normalized = normalizeRegisteredTool(
      descriptor({ inputSchema: JSON.stringify(SCHEMA) as unknown as object }),
      'https://actuo.app',
    );
    expect(normalized.inputSchema).toEqual(SCHEMA);
  });

  it('tolerates absent annotations', () => {
    const normalized = normalizeRegisteredTool(
      descriptor({ annotations: undefined }),
      'https://actuo.app',
    );
    expect(normalized.annotations).toBeUndefined();
  });
});
