/**
 * BYOK Gemini client — browser to `generativelanguage.googleapis.com`, direct.
 *
 * No SDK, no interceptor, no Actuo backend anywhere in the path. Open the
 * DevTools network tab during a Copilot turn and the only request carrying the
 * key is the one to Google (PRD §8.3).
 *
 * Multi-turn function calling, the whole point of this class:
 *
 * ```ts
 * const turns: GeminiTurn[] = [{ role: 'user', text: 'am I over budget on travel?' }];
 * let result = await client.generate({ turns, tools }, { signal });
 *
 * while (result.functionCalls.length > 0) {
 *   turns.push(result.turn);
 *   const results = await Promise.all(result.functionCalls.map(runTool));
 *   turns.push({ role: 'tool', results });
 *   result = await client.generate({ turns, tools }, { signal });
 * }
 * console.log(result.text);
 * ```
 */

import { Injectable, computed, inject } from '@angular/core';
import { KeyStore } from './key-store';
import { GEMINI_FETCH, callGemini, type FetchLike } from './gemini-transport';
import { toFunctionDeclarations, type GeminiToolDeclaration } from './gemini-schema';
import {
  parseGenerateContentResponse,
  turnsToContents,
  type GeminiGenerateResult,
  type GeminiTurn,
  type WireGenerateContentRequest,
  type WireGenerateContentResponse,
} from './gemini-protocol';
import { testGeminiKey, type KeyTestResult } from './test-key';

/**
 * `AUTO` lets the model choose between a tool call and prose (the Copilot
 * default), `ANY` forces a tool call, `NONE` forbids one — useful for the final
 * "summarise what you just did" turn.
 */
export type ToolMode = 'auto' | 'any' | 'none';

export interface GeminiGenerateRequest {
  /** The conversation so far, oldest first. */
  turns: readonly GeminiTurn[];
  /** Tools the model may call, typically from the `ToolRegistry`. */
  tools?: readonly GeminiToolDeclaration[];
  systemInstruction?: string;
  /** Defaults to `KeyStore.model()`. */
  model?: string;
  /**
   * Overrides the stored key. Only for "test this key before saving it" flows —
   * normal calls read from {@link KeyStore}.
   */
  apiKey?: string;
  temperature?: number;
  maxOutputTokens?: number;
  toolMode?: ToolMode;
}

export interface GeminiRequestOptions {
  signal?: AbortSignal;
}

const TOOL_MODES: Readonly<Record<ToolMode, 'AUTO' | 'ANY' | 'NONE'>> = {
  auto: 'AUTO',
  any: 'ANY',
  none: 'NONE',
};

@Injectable({ providedIn: 'root' })
export class GeminiClient {
  private readonly keys = inject(KeyStore);
  private readonly fetchImpl = inject<FetchLike>(GEMINI_FETCH);

  /** True when a call would succeed as far as credentials are concerned. */
  readonly ready = computed(() => this.keys.hasKey());
  /** The model every call defaults to. */
  readonly model = this.keys.model;

  /**
   * Builds the wire request. Exposed for tests and the Copilot debug panel —
   * it never sees the API key, which lives only in the transport's headers.
   */
  buildRequest(request: GeminiGenerateRequest): WireGenerateContentRequest {
    const body: WireGenerateContentRequest = {
      contents: turnsToContents(request.turns),
    };

    if (request.systemInstruction) {
      body.systemInstruction = { parts: [{ text: request.systemInstruction }] };
    }

    const tools = request.tools ?? [];
    if (tools.length > 0) {
      body.tools = [{ functionDeclarations: toFunctionDeclarations(tools) }];
      body.toolConfig = {
        functionCallingConfig: { mode: TOOL_MODES[request.toolMode ?? 'auto'] },
      };
    }

    if (request.temperature !== undefined || request.maxOutputTokens !== undefined) {
      body.generationConfig = {};
      if (request.temperature !== undefined) body.generationConfig.temperature = request.temperature;
      if (request.maxOutputTokens !== undefined) {
        body.generationConfig.maxOutputTokens = request.maxOutputTokens;
      }
    }

    return body;
  }

  /**
   * One `generateContent` round trip.
   *
   * @throws {@link GeminiError} for every failure mode — check `.kind` rather
   *   than string-matching the message.
   */
  async generate(
    request: GeminiGenerateRequest,
    options: GeminiRequestOptions = {},
  ): Promise<GeminiGenerateResult> {
    const model = request.model ?? this.keys.model();
    const apiKey = request.apiKey ?? this.keys.apiKey();

    const { body } = await callGemini<WireGenerateContentResponse>(
      'generateContent',
      this.buildRequest(request),
      { apiKey, model, signal: options.signal, fetchImpl: this.fetchImpl },
    );

    return parseGenerateContentResponse(body, model);
  }

  /**
   * PRD §6.9 "Test key". Pass `apiKey`/`model` to check a value the user has
   * typed but not saved yet; omit them to check what is stored.
   */
  testKey(
    params: { apiKey?: string; model?: string } = {},
    options: GeminiRequestOptions = {},
  ): Promise<KeyTestResult> {
    return testGeminiKey(
      {
        apiKey: params.apiKey ?? this.keys.apiKey(),
        model: params.model ?? this.keys.model(),
        fetchImpl: this.fetchImpl,
      },
      options,
    );
  }
}
