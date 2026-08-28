import { DOCUMENT, Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { ActuoToolContract } from '@actuo/shared';
import {
  type ChromeModelContext,
  type NormalizedTool,
  normalizeRegisteredTool,
} from './webmcp.types.js';

/** A tool definition: the shared contract plus the function that runs it. */
export interface ActuoTool<TArgs extends Record<string, unknown> = Record<string, unknown>> {
  contract: ActuoToolContract;
  execute: (args: TArgs, context: { signal: AbortSignal }) => Promise<unknown>;
}

export interface ToolInvocation {
  toolName: string;
  input: unknown;
  output: unknown;
  origin: 'local' | 'cross-origin';
  startedAt: number;
  durationMs: number;
  error?: string;
}

/**
 * The single source of truth for Actuo's WebMCP tools.
 *
 * ## Why this exists
 *
 * The obvious design — the Copilot calls `getTools()` and then `executeTool()` —
 * does not work against the API as shipped:
 *
 *  - `getTools()` returns *descriptors only*. There is no execute handle on them.
 *  - `executeTool()` is a Chromium extension, not part of the core spec, so
 *    relying on it would make the whole product depend on a browser flag.
 *
 * So each tool is defined once here, and the registry serves two consumers:
 *
 *  1. **External browser agents** — every tool is registered with
 *     `document.modelContext.registerTool()`, so they see genuine WebMCP tools.
 *  2. **Our in-page Copilot** — the `execute` functions are kept locally and
 *     invoked directly, which works in every browser with no flag at all.
 *
 * `executeTool()` is used for exactly one thing: invoking **cross-origin** tools
 * discovered via `getTools({fromOrigins})`, which genuinely cannot be called any
 * other way. That confines flag dependence to the cross-origin demo and leaves
 * the app fully usable without it.
 */
@Injectable({ providedIn: 'root' })
export class ToolRegistry {
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** Local definitions, keyed by tool name. */
  private readonly tools = new Map<string, ActuoTool<never>>();
  /** Controls the lifetime of each WebMCP registration (abort = unregister). */
  private readonly registrations = new Map<string, AbortController>();

  private readonly registered = signal<readonly string[]>([]);
  private readonly discovered = signal<readonly NormalizedTool[]>([]);
  private readonly invocations = signal<readonly ToolInvocation[]>([]);

  /** Names of tools currently registered by this document. */
  readonly registeredNames = this.registered.asReadonly();
  /** Everything `getTools()` reported, including cross-origin tools. */
  readonly discoveredTools = this.discovered.asReadonly();
  /** Running log of every invocation — powers the debug panel and demo narrative. */
  readonly invocationLog = this.invocations.asReadonly();

  /** Whether the browser exposes native WebMCP at all. */
  readonly isSupported = computed(() => this.modelContext !== undefined);
  /** Whether the Chromium-only `executeTool()` extension is present. */
  readonly canExecuteCrossOrigin = computed(
    () => typeof this.modelContext?.executeTool === 'function',
  );

  private get modelContext(): ChromeModelContext | undefined {
    if (!this.isBrowser) return undefined;
    return (this.document as Document).modelContext as ChromeModelContext | undefined;
  }

  private get selfOrigin(): string {
    return this.document.location?.origin ?? '';
  }

  /**
   * Define a tool locally and, when the browser supports it, publish it to
   * WebMCP. Publishing is best-effort: a browser without WebMCP still gets a
   * fully working Copilot, because invocation goes through the local map.
   */
  async register<TArgs extends Record<string, unknown>>(tool: ActuoTool<TArgs>): Promise<void> {
    const { name } = tool.contract;
    this.tools.set(name, tool as unknown as ActuoTool<never>);
    this.registered.update((names) => (names.includes(name) ? names : [...names, name]));

    const context = this.modelContext;
    if (!context) return;

    // Re-registering the same name rejects, so retire any prior registration.
    this.registrations.get(name)?.abort();
    const controller = new AbortController();
    this.registrations.set(name, controller);

    try {
      await context.registerTool(
        {
          name,
          title: tool.contract.title,
          description: tool.contract.description,
          inputSchema: tool.contract.inputSchema,
          annotations: tool.contract.annotations,
          execute: (args, options) =>
            this.invoke(name, args as TArgs, options?.signal) as Promise<unknown>,
        },
        { signal: controller.signal },
      );
    } catch (error) {
      // A failed publish must not break the in-page Copilot.
      this.registrations.delete(name);
      console.warn(`[webmcp] could not register "${name}"`, error);
    }
  }

  /**
   * Retire a tool. Used by the state-gated `approve_expense`, which must appear
   * and disappear as the user's role and the pending queue change — aborting the
   * registration signal is what fires `toolchange` for observing agents.
   */
  unregister(name: string): void {
    this.registrations.get(name)?.abort();
    this.registrations.delete(name);
    this.tools.delete(name);
    this.registered.update((names) => names.filter((n) => n !== name));
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  getContract(name: string): ActuoToolContract | undefined {
    return this.tools.get(name)?.contract;
  }

  contracts(): readonly ActuoToolContract[] {
    return [...this.tools.values()].map((tool) => tool.contract);
  }

  /**
   * Run a locally-defined tool. This is the path the Copilot uses, and the path
   * WebMCP's own `execute` callback funnels back into, so every invocation is
   * logged exactly once regardless of who triggered it.
   */
  async invoke<TArgs extends Record<string, unknown>>(
    name: string,
    args: TArgs,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);

    const startedAt = Date.now();
    const controller = new AbortController();
    // Honour an upstream cancellation without discarding our own control.
    signal?.addEventListener('abort', () => controller.abort(signal.reason), { once: true });

    try {
      const output = await (tool as unknown as ActuoTool<TArgs>).execute(args, {
        signal: controller.signal,
      });
      this.log({
        toolName: name,
        input: args,
        output,
        origin: 'local',
        startedAt,
        durationMs: Date.now() - startedAt,
      });
      return output;
    } catch (error) {
      this.log({
        toolName: name,
        input: args,
        output: null,
        origin: 'local',
        startedAt,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Ask the browser what tools are visible, optionally including tools exposed
   * by other origins. Returns normalized descriptors — see `NormalizedTool` for
   * the two shipped-API quirks this smooths over.
   */
  async discover(options?: { fromOrigins?: string[] }): Promise<readonly NormalizedTool[]> {
    const context = this.modelContext;
    if (!context) {
      this.discovered.set([]);
      return [];
    }

    try {
      const tools = await context.getTools(options);
      const normalized = tools.map((tool) => normalizeRegisteredTool(tool, this.selfOrigin));
      this.discovered.set(normalized);
      return normalized;
    } catch (error) {
      // `fromOrigins` rejects with NotSupportedError under the polyfill, and on
      // native Chrome when the permissions policy withholds the origin. Neither
      // should break same-origin discovery.
      console.warn('[webmcp] discovery failed', error);
      this.discovered.set([]);
      return [];
    }
  }

  /**
   * Invoke a tool owned by another origin. This is the only path that requires
   * the Chromium `executeTool()` extension, because we do not hold the function.
   */
  async invokeCrossOrigin(
    tool: NormalizedTool,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const context = this.modelContext;
    if (!context?.executeTool) {
      throw new Error(
        'Cross-origin tool calls need Chrome with the WebMCP flag enabled ' +
          '(chrome://flags/#enable-webmcp-testing).',
      );
    }

    const startedAt = Date.now();
    try {
      // Note the argument is a JSON **string**, not an object.
      const raw = await context.executeTool(tool.raw, JSON.stringify(args), { signal });
      const output = parseToolResult(raw);
      this.log({
        toolName: tool.name,
        input: args,
        output,
        origin: 'cross-origin',
        startedAt,
        durationMs: Date.now() - startedAt,
      });
      return output;
    } catch (error) {
      this.log({
        toolName: tool.name,
        input: args,
        output: null,
        origin: 'cross-origin',
        startedAt,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /** Re-run discovery whenever the set of available tools changes. */
  onToolChange(listener: () => void): () => void {
    const context = this.modelContext;
    if (!context) return () => {};
    context.addEventListener('toolchange', listener);
    return () => context.removeEventListener('toolchange', listener);
  }

  private log(invocation: ToolInvocation): void {
    this.invocations.update((entries) => [...entries, invocation].slice(-100));
  }
}

/** `executeTool()` resolves to a string (or null); JSON when the tool returned an object. */
export function parseToolResult(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
