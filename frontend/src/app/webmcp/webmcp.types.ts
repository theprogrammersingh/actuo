/**
 * WebMCP typings beyond what `webmcp-types` provides.
 *
 * `webmcp-types` (published by Chrome DevRel, mirroring the W3C draft) declares
 * `Document.modelContext` with `registerTool()`, `getTools()` and `toolchange`.
 * It deliberately does NOT declare `executeTool()`, because that is a Chromium
 * extension rather than part of the core spec. We declare it separately here so
 * every call site is forced to feature-detect it.
 */

/** The Chromium-only extension. Always feature-detect before calling. */
export interface ChromeModelContextExtensions {
  executeTool?(
    tool: WebMCP.RegisteredTool,
    /** Arguments as a JSON **string**, not an object. */
    inputArguments: string,
    options?: { signal?: AbortSignal },
  ): Promise<string | null>;
}

export type ChromeModelContext = WebMCP.ModelContext & ChromeModelContextExtensions;

/**
 * A tool descriptor after normalization.
 *
 * Two shipped-API quirks are ironed out here so no consumer has to remember them:
 *
 *  - `inputSchema` arrives as a **serialized JSON string** on Chrome 149–153
 *    (most of the origin-trial population) and as an object from 154 onward.
 *  - `title` may be the **empty string** rather than absent, so `?? name` does
 *    not fall through; it needs `|| name`.
 */
export interface NormalizedTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown> | undefined;
  origin: string;
  annotations: WebMCP.ToolAnnotations | undefined;
  /** True when the tool came from a different origin than this document. */
  isCrossOrigin: boolean;
  /** Retained so `executeTool()` can be handed the original descriptor. */
  raw: WebMCP.RegisteredTool;
}

export function normalizeRegisteredTool(
  tool: WebMCP.RegisteredTool,
  selfOrigin: string,
): NormalizedTool {
  return {
    name: tool.name,
    // Empty string is a real value here, so `||` is correct and `??` is not.
    title: tool.title || tool.name,
    description: tool.description,
    inputSchema: parseInputSchema(tool.inputSchema),
    origin: tool.origin,
    annotations: tool.annotations,
    isCrossOrigin: tool.origin !== selfOrigin,
    raw: tool,
  };
}

/** Handles both the pre-154 JSON-string form and the object form. */
export function parseInputSchema(schema: unknown): Record<string, unknown> | undefined {
  if (schema == null) return undefined;

  if (typeof schema === 'string') {
    try {
      const parsed: unknown = JSON.parse(schema);
      return isRecord(parsed) ? parsed : undefined;
    } catch {
      // A malformed schema must not take down tool discovery.
      return undefined;
    }
  }

  return isRecord(schema) ? schema : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
