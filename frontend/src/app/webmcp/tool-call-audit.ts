import { Injectable, inject } from '@angular/core';
import { ApiClient } from '../core/api/api-client.js';

/**
 * Largest JSON payload sent for a tool's input or output.
 *
 * `search_expenses` can return a hundred summarized rows and every call lands
 * in a `jsonb` column, so the log would grow faster than the data it describes.
 * The cap keeps a row readable in the viewer while still showing what the call
 * looked like.
 */
const MAX_PAYLOAD_BYTES = 4096;

export interface ToolCallRecord {
  /**
   * Who initiated it. Everything routed through `ToolRegistry` is `agent` —
   * the in-page Copilot or an external browser agent. The declarative Add
   * Expense form is the one caller that can be either, and it knows which
   * because WebMCP hands it `agentInvoked` on the submit event.
   *
   * This is a label for the audit viewer's filter, never an authorisation
   * input: the backend takes `orgId` and `actorId` from the verified session
   * and `actor: 'agent'` grants nothing `actor: 'human'` does not.
   */
  actor: 'human' | 'agent';
  toolName: string;
  input: unknown;
  output: unknown;
}

/**
 * Writes every tool invocation to `tool_call_log` (PRD §8.7).
 *
 * The table, the repository, `POST /api/tool-calls` and the Settings viewer all
 * existed before this service did — nothing wrote to them, so the viewer showed
 * seed rows forever and "here is everything the agent did in your org" was a
 * claim with no rows behind it.
 *
 * Two rules make this safe to call from inside a tool's own execution path:
 *
 *  - **It never rejects.** A failed log write must not become a failed action.
 *    `ApiClient` also throws `status: 0` during SSR, which is a normal outcome
 *    here rather than an error worth surfacing.
 *  - **It never blocks.** Callers get a `void` back; the POST is in flight when
 *    they resume.
 *
 * NOTE: no field here can carry the user's Gemini key. `input`/`output` are
 * tool arguments and tool results, and this service holds only `ApiClient`,
 * which is deliberately the one transport that never sees the key
 * (CLAUDE.md rule 2).
 */
@Injectable({ providedIn: 'root' })
export class ToolCallAudit {
  private readonly api = inject(ApiClient);

  record(entry: ToolCallRecord): void {
    void this.api
      .post('/tool-calls', {
        actor: entry.actor,
        toolName: entry.toolName,
        input: truncate(entry.input),
        output: truncate(entry.output),
      })
      .catch(() => {
        // Deliberately silent. This runs on every tool call, including during
        // SSR and while signed out, and a console full of expected failures
        // trains people to ignore the console.
      });
  }
}

/**
 * Replaces an oversized payload with a marked preview.
 *
 * The marker matters: a silently shortened payload in an audit trail is worse
 * than an obviously shortened one, because it reads as the whole call.
 */
export function truncate(value: unknown, limit = MAX_PAYLOAD_BYTES): unknown {
  if (value === null || value === undefined) return null;

  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? 'null';
  } catch {
    // Circular, or a BigInt. Record that something was there rather than
    // dropping the row on the floor.
    return { truncated: true, preview: '[unserializable]' };
  }

  if (serialized.length <= limit) return value;
  return { truncated: true, preview: `${serialized.slice(0, limit)}…` };
}
