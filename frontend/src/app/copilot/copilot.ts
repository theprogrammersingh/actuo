import { Injectable, computed, inject, signal } from '@angular/core';
import type { ActuoToolContract } from '@actuo/shared';
import {
  GeminiClient,
  GeminiError,
  KeyStore,
  type GeminiFunctionCall,
  type GeminiFunctionResult,
  type GeminiTurn,
} from '../ai';
import { ToolRegistry } from '../webmcp/tool-registry.js';
import type { NormalizedTool } from '../webmcp/webmcp.types.js';

export type CopilotEntry =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'error'; id: string; text: string; keyProblem: boolean }
  | {
      kind: 'tool';
      id: string;
      name: string;
      summary: string;
      state: 'running' | 'awaiting-confirmation' | 'done' | 'error' | 'cancelled';
      input: Record<string, unknown>;
      result?: unknown;
      error?: string;
      durationMs?: number;
      origin?: string;
      mutates: boolean;
      cancellable: boolean;
    };

/** Guards against a model that keeps calling tools without ever answering. */
const MAX_TOOL_ROUNDS = 6;

const SYSTEM_INSTRUCTION = [
  'You are the Actuo Copilot, embedded in an expense management app.',
  'You sound like a sharp, calm colleague: direct, never chirpy, never a dry CLI.',
  'Use the provided tools to answer questions and take actions rather than guessing.',
  'When a tool fails, say specifically what went wrong and suggest the nearest fix',
  '(for example: "I couldn\'t find a category called \'Food\' — did you mean \'Dining\'?").',
  'Amounts are money: state the currency, and never invent figures you did not read from a tool.',
  "Today's date is " + new Date().toISOString().slice(0, 10) + '.',
].join(' ');

/**
 * Drives the conversation: Gemini decides, tools execute, and every step is
 * rendered as a Tool Call Card so nothing happens behind the UI (Design Doc §1.2).
 *
 * Tools are executed through `ToolRegistry`, not `executeTool()`, so the Copilot
 * works in any browser without the WebMCP flag. Cross-origin tools are the one
 * exception and go through the registry's `executeTool()` path.
 */
@Injectable({ providedIn: 'root' })
export class Copilot {
  private readonly gemini = inject(GeminiClient);
  private readonly keys = inject(KeyStore);
  private readonly registry = inject(ToolRegistry);

  private readonly entryList = signal<readonly CopilotEntry[]>([]);
  private readonly busy = signal(false);
  private readonly open = signal(false);
  private turns: GeminiTurn[] = [];
  private controller: AbortController | null = null;
  /** Resolves when the user answers a confirmation card. */
  private pendingConfirmation: ((approved: boolean) => void) | null = null;

  readonly entries = this.entryList.asReadonly();
  readonly isBusy = this.busy.asReadonly();
  readonly isOpen = this.open.asReadonly();
  readonly needsKey = computed(() => !this.keys.hasKey());
  readonly awaitingConfirmation = computed(() =>
    this.entryList().some((e) => e.kind === 'tool' && e.state === 'awaiting-confirmation'),
  );

  /** Cross-origin tools discovered from other origins, if any. */
  private readonly remoteTools = signal<readonly NormalizedTool[]>([]);

  /** What the Copilot can currently reach on another origin. */
  readonly crossOriginTools = this.remoteTools.asReadonly();

  toggle(): void {
    this.open.update((v) => !v);
  }

  close(): void {
    this.open.set(false);
  }

  /**
   * Pull in tools exposed by another origin (the partner-demo page).
   *
   * Only genuinely cross-origin descriptors are kept: `getTools()` returns this
   * document's own tools too, and those are already in the registry with their
   * `execute` functions attached. Keeping a same-origin duplicate here would
   * route it through `executeTool()` — the one path that needs the Chrome flag
   * — for no reason.
   */
  async discoverRemoteTools(origins: string[]): Promise<void> {
    const tools = await this.registry.discover({ fromOrigins: origins });
    this.remoteTools.set(tools.filter((tool) => tool.isCrossOrigin));
  }

  /**
   * Forget the other origin's tools.
   *
   * Called when the page hosting the partner iframe goes away. Without it the
   * Copilot keeps offering `search_books` to the model after the document that
   * implements it is gone, and every call fails with a confusing error instead
   * of the tool simply not being on the menu.
   */
  clearRemoteTools(): void {
    this.remoteTools.set([]);
  }

  async send(message: string): Promise<void> {
    const text = message.trim();
    if (!text || this.busy()) return;

    // PRD §6.8: with no key the Copilot must route to setup, not fail silently.
    if (this.needsKey()) {
      this.push({
        kind: 'error',
        id: id(),
        text: 'Add your Gemini API key in Settings → AI & Copilot to start. It stays in this browser.',
        keyProblem: true,
      });
      return;
    }

    this.push({ kind: 'user', id: id(), text });
    this.turns.push({ role: 'user', text });

    this.busy.set(true);
    this.controller = new AbortController();

    try {
      await this.runLoop(this.controller.signal);
    } catch (error) {
      this.pushError(error);
    } finally {
      this.busy.set(false);
      this.controller = null;
    }
  }

  /** Stop everything in flight. §3.2.6 wants this to feel immediate. */
  stop(): void {
    this.controller?.abort();
    this.resolveConfirmation(false);
    this.entryList.update((entries) =>
      entries.map((entry) =>
        entry.kind === 'tool' && (entry.state === 'running' || entry.state === 'awaiting-confirmation')
          ? { ...entry, state: 'cancelled' as const }
          : entry,
      ),
    );
    this.busy.set(false);
  }

  /** Called by the Confirm / Cancel buttons on a tool card. */
  respondToConfirmation(approved: boolean): void {
    this.resolveConfirmation(approved);
  }

  reset(): void {
    this.stop();
    this.turns = [];
    this.entryList.set([]);
  }

  private async runLoop(signal: AbortSignal): Promise<void> {
    const declarations = this.toolDeclarations();

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const result = await this.gemini.generate(
        { turns: this.turns, tools: declarations, systemInstruction: SYSTEM_INSTRUCTION },
        { signal },
      );

      if (result.text) {
        this.push({ kind: 'assistant', id: id(), text: result.text });
      }

      if (result.functionCalls.length === 0) return;

      this.turns.push(result.turn);
      const results: GeminiFunctionResult[] = [];
      for (const call of result.functionCalls) {
        results.push(await this.runTool(call, signal));
      }
      this.turns.push({ role: 'tool', results });
    }

    this.push({
      kind: 'assistant',
      id: id(),
      text: "I stopped after several tool calls without reaching an answer. Could you narrow the request?",
    });
  }

  private async runTool(
    call: GeminiFunctionCall,
    signal: AbortSignal,
  ): Promise<GeminiFunctionResult> {
    const contract = this.registry.getContract(call.name);
    const remote = this.remoteTools().find((tool) => tool.name === call.name);
    const mutates = contract ? contract.annotations.readOnlyHint !== true : false;
    const entryId = id();

    this.push({
      kind: 'tool',
      id: entryId,
      name: call.name,
      summary: describe(call, contract),
      state: 'running',
      input: call.args,
      mutates,
      cancellable: call.name === 'generate_report',
      origin: remote ? hostOf(remote.origin) : undefined,
    });

    // §3.2.4 — anything that moves money or changes approval state is confirmed
    // in-chat, against the exact arguments, before it runs.
    if (contract?.requiresConfirmation) {
      this.patch(entryId, { state: 'awaiting-confirmation' });
      const approved = await this.awaitConfirmation(signal);
      if (!approved) {
        this.patch(entryId, { state: 'cancelled' });
        return { id: call.id, name: call.name, error: 'The user declined this action.' };
      }
      this.patch(entryId, { state: 'running' });
    }

    const startedAt = Date.now();
    try {
      const output = remote
        ? await this.registry.invokeCrossOrigin(remote, call.args, signal)
        : await this.registry.invoke(call.name, call.args, signal);

      this.patch(entryId, {
        state: 'done',
        result: output,
        durationMs: Date.now() - startedAt,
      });
      return { id: call.id, name: call.name, response: output };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = signal.aborted;
      this.patch(entryId, {
        state: cancelled ? 'cancelled' : 'error',
        error: message,
        durationMs: Date.now() - startedAt,
      });
      // Hand the failure back to the model — it can recover or explain.
      return { id: call.id, name: call.name, error: message };
    }
  }

  private awaitConfirmation(signal: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      this.pendingConfirmation = resolve;
      signal.addEventListener('abort', () => this.resolveConfirmation(false), { once: true });
    });
  }

  private resolveConfirmation(approved: boolean): void {
    const pending = this.pendingConfirmation;
    this.pendingConfirmation = null;
    pending?.(approved);
  }

  private toolDeclarations() {
    const local = this.registry.contracts().map((contract) => ({
      name: contract.name,
      description: contract.description,
      inputSchema: contract.inputSchema,
    }));
    const remote = this.remoteTools().map((tool) => ({
      name: tool.name,
      description: `${tool.description} (from ${hostOf(tool.origin)})`,
      inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
    }));
    /*
     * Returned RAW. GeminiClient.generate() runs toFunctionDeclarations()
     * itself and wraps the result; converting here as well would hand it
     * already-translated declarations whose schema sits under `parameters`
     * rather than `inputSchema`, so the second conversion would find nothing
     * and every tool would reach the model with no parameters at all.
     */
    return [...local, ...remote];
  }

  private pushError(error: unknown): void {
    if (error instanceof GeminiError) {
      if (error.kind === 'aborted') return;
      this.push({ kind: 'error', id: id(), text: error.message, keyProblem: error.keyProblem });
      return;
    }
    this.push({
      kind: 'error',
      id: id(),
      text: error instanceof Error ? error.message : String(error),
      keyProblem: false,
    });
  }

  private push(entry: CopilotEntry): void {
    this.entryList.update((entries) => [...entries, entry]);
  }

  private patch(entryId: string, changes: Partial<Extract<CopilotEntry, { kind: 'tool' }>>): void {
    this.entryList.update((entries) =>
      entries.map((entry) =>
        entry.kind === 'tool' && entry.id === entryId ? { ...entry, ...changes } : entry,
      ),
    );
  }
}

/** One-line human summary for the collapsed card (Design Doc §3.2.3). */
function describe(call: GeminiFunctionCall, contract?: ActuoToolContract): string {
  const args = Object.entries(call.args)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key} = ${format(value)}`)
    .join(', ');

  const title = contract?.title ?? call.name;
  return args ? `${title}: ${args}` : title;
}

function format(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

function id(): string {
  return Math.random().toString(36).slice(2, 10);
}
