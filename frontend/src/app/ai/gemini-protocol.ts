/**
 * The Gemini `generateContent` wire format, and the ergonomic conversation
 * shape the Copilot works in.
 *
 * Callers never build `contents` by hand. They append {@link GeminiTurn}s:
 *
 * ```ts
 * const turns: GeminiTurn[] = [{ role: 'user', text: 'how much left on travel?' }];
 * const first = await client.generate({ turns, tools });
 * turns.push(first.turn);                       // the model's function calls
 * turns.push({ role: 'tool', results: [...] }); // what the tools returned
 * const final = await client.generate({ turns, tools }); // -> text answer
 * ```
 */

import { GeminiError } from './gemini-errors';
import type { GeminiFunctionDeclaration, GeminiSchema } from './gemini-schema';

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

export interface WireTextPart {
  text: string;
  /** Gemini 3 marks thought summaries with this flag. */
  thought?: boolean;
  /** See {@link WireFunctionCallPart.thoughtSignature}. */
  thoughtSignature?: string;
}

export interface WireFunctionCallPart {
  functionCall: { id?: string; name: string; args?: Record<string, unknown> };
  /**
   * Opaque token Gemini 3 attaches to a function call, carrying the reasoning
   * that produced it.
   *
   * It MUST be echoed back verbatim when the model turn is replayed in
   * `contents`, or the API rejects the next request with HTTP 400:
   *
   *   "Function call is missing a thought_signature in functionCall parts.
   *    This is required for tools to work correctly."
   *
   * Google's own SDKs do this silently. We call the REST API directly — a
   * deliberate choice for bundle size and CSP — so preserving it is ours to do.
   */
  thoughtSignature?: string;
}

export interface WireFunctionResponsePart {
  functionResponse: { id?: string; name: string; response: Record<string, unknown> };
}

export type WirePart = WireTextPart | WireFunctionCallPart | WireFunctionResponsePart;

export interface WireContent {
  /** The REST API only accepts these two roles inside `contents`. */
  role: 'user' | 'model';
  parts: WirePart[];
}

export interface WireGenerateContentRequest {
  contents: WireContent[];
  systemInstruction?: { parts: WireTextPart[] };
  tools?: [{ functionDeclarations: GeminiFunctionDeclaration[] }];
  toolConfig?: { functionCallingConfig: { mode: 'AUTO' | 'ANY' | 'NONE' } };
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    responseMimeType?: string;
    responseSchema?: GeminiSchema;
  };
}

export interface WireGenerateContentResponse {
  candidates?: Array<{
    content?: { role?: string; parts?: WirePart[] };
    finishReason?: string;
    safetyRatings?: unknown[];
  }>;
  promptFeedback?: { blockReason?: string; safetyRatings?: unknown[] };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    thoughtsTokenCount?: number;
  };
  modelVersion?: string;
}

// ---------------------------------------------------------------------------
// Conversation types
// ---------------------------------------------------------------------------

export interface GeminiFunctionCall {
  /** Present when Gemini emits parallel calls; echo it back untouched. */
  id?: string;
  /**
   * Opaque reasoning token that must be echoed back with this call. Each call
   * in a parallel batch carries its own. Never synthesise or reuse one.
   */
  thoughtSignature?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface GeminiFunctionResult {
  /** Must match the `id` from the call it answers, when there was one. */
  id?: string;
  name: string;
  /** Whatever the tool's `execute()` returned. Non-objects get wrapped. */
  response?: unknown;
  /** Set instead of `response` when the tool threw or was denied. */
  error?: string;
}

export type GeminiTurn =
  | { role: 'user'; text: string }
  | {
      role: 'model';
      text?: string;
      functionCalls?: GeminiFunctionCall[];
      /**
       * The candidate's parts exactly as Gemini returned them.
       *
       * When present these are replayed byte-for-byte instead of being rebuilt
       * from `text`/`functionCalls`. Rebuilding drops any field we do not model
       * — thought signatures being the one that breaks multi-turn tool use —
       * and the set of such fields is Google's to change, not ours to track.
       */
      parts?: WirePart[];
    }
  | { role: 'tool'; results: GeminiFunctionResult[] };

export interface GeminiUsage {
  promptTokens?: number;
  responseTokens?: number;
  thoughtTokens?: number;
  totalTokens?: number;
}

export interface GeminiGenerateResult {
  /** Visible text, thought summaries excluded. Empty string when there is none. */
  text: string;
  /** Tool calls the model wants run. Empty when it answered in prose. */
  functionCalls: GeminiFunctionCall[];
  /** Gemini 3 thought summary, when the model returned one. */
  thoughts: string;
  finishReason?: string;
  model: string;
  usage?: GeminiUsage;
  /**
   * The model's turn, ready to push onto the conversation before appending the
   * matching `{ role: 'tool', results }` turn.
   */
  turn: GeminiTurn;
  /** Raw response body, for the Copilot debug panel. Never contains the key. */
  raw: WireGenerateContentResponse;
}

// ---------------------------------------------------------------------------
// Turn -> wire
// ---------------------------------------------------------------------------

/**
 * Gemini requires `functionResponse.response` to be a JSON object. Tools are
 * free to return a string, a number, or an array, so anything that is not a
 * plain object gets wrapped under `result`.
 */
export function normalizeFunctionResponse(result: GeminiFunctionResult): Record<string, unknown> {
  if (result.error !== undefined) {
    return { error: result.error };
  }
  const value = result.response;
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { result: value ?? null };
}

export function turnsToContents(turns: readonly GeminiTurn[]): WireContent[] {
  const contents: WireContent[] = [];

  for (const turn of turns) {
    if (turn.role === 'user') {
      if (!turn.text) continue;
      contents.push({ role: 'user', parts: [{ text: turn.text }] });
      continue;
    }

    if (turn.role === 'model') {
      // Preferred path: hand back precisely what the model sent us.
      if (turn.parts && turn.parts.length > 0) {
        contents.push({ role: 'model', parts: turn.parts });
        continue;
      }

      // Fallback for turns assembled by hand (and by tests).
      const parts: WirePart[] = [];
      if (turn.text) parts.push({ text: turn.text });
      for (const call of turn.functionCalls ?? []) {
        const functionCall: WireFunctionCallPart['functionCall'] = {
          name: call.name,
          args: call.args ?? {},
        };
        if (call.id) functionCall.id = call.id;
        const part: WireFunctionCallPart = { functionCall };
        if (call.thoughtSignature) part.thoughtSignature = call.thoughtSignature;
        parts.push(part);
      }
      if (parts.length > 0) contents.push({ role: 'model', parts });
      continue;
    }

    // Tool results come back as a `user` turn — `contents` has no other role.
    const parts: WirePart[] = turn.results.map((result) => {
      const functionResponse: WireFunctionResponsePart['functionResponse'] = {
        name: result.name,
        response: normalizeFunctionResponse(result),
      };
      if (result.id) functionResponse.id = result.id;
      return { functionResponse };
    });
    if (parts.length > 0) contents.push({ role: 'user', parts });
  }

  return contents;
}

// ---------------------------------------------------------------------------
// Wire -> result
// ---------------------------------------------------------------------------

function isTextPart(part: WirePart): part is WireTextPart {
  return typeof (part as WireTextPart).text === 'string';
}

function isFunctionCallPart(part: WirePart): part is WireFunctionCallPart {
  const call = (part as WireFunctionCallPart).functionCall;
  return !!call && typeof call.name === 'string';
}

const BLOCK_REASON_HELP: Readonly<Record<string, string>> = {
  SAFETY: 'the content tripped Gemini\'s safety filters',
  OTHER: 'Gemini declined to answer without giving a reason',
  BLOCKLIST: 'the prompt contained blocked terminology',
  PROHIBITED_CONTENT: 'the prompt was classified as prohibited content',
};

export function parseGenerateContentResponse(
  body: unknown,
  model: string,
): GeminiGenerateResult {
  if (!body || typeof body !== 'object') {
    throw new GeminiError({
      kind: 'malformed-response',
      model,
      message: 'Gemini returned a response body that was not an object.',
    });
  }

  const response = body as WireGenerateContentResponse;

  const blockReason = response.promptFeedback?.blockReason;
  if (blockReason) {
    throw new GeminiError({
      kind: 'blocked',
      model,
      statusText: blockReason,
      message: `Gemini blocked this prompt — ${
        BLOCK_REASON_HELP[blockReason] ?? `reason: ${blockReason}`
      }. Rephrasing usually clears it.`,
    });
  }

  const candidate = response.candidates?.[0];
  if (!candidate) {
    throw new GeminiError({
      kind: 'malformed-response',
      model,
      message:
        'Gemini returned no candidates. The model produced nothing usable for this prompt.',
    });
  }

  const finishReason = candidate.finishReason;
  const parts = candidate.content?.parts ?? [];

  const textChunks: string[] = [];
  const thoughtChunks: string[] = [];
  const functionCalls: GeminiFunctionCall[] = [];

  for (const part of parts) {
    if (isFunctionCallPart(part)) {
      const call: GeminiFunctionCall = {
        name: part.functionCall.name,
        args: part.functionCall.args ?? {},
      };
      if (part.functionCall.id) call.id = part.functionCall.id;
      if (part.thoughtSignature) call.thoughtSignature = part.thoughtSignature;
      functionCalls.push(call);
      continue;
    }
    if (isTextPart(part)) {
      (part.thought ? thoughtChunks : textChunks).push(part.text);
    }
  }

  const text = textChunks.join('');

  if (!text && functionCalls.length === 0) {
    if (finishReason === 'SAFETY' || finishReason === 'PROHIBITED_CONTENT') {
      throw new GeminiError({
        kind: 'blocked',
        model,
        statusText: finishReason,
        message:
          'Gemini stopped generating because the response tripped its safety filters. Nothing was returned.',
      });
    }
    if (finishReason === 'MAX_TOKENS') {
      throw new GeminiError({
        kind: 'malformed-response',
        model,
        statusText: finishReason,
        message:
          'Gemini hit its output-token limit before producing anything. Shorten the conversation or raise maxOutputTokens.',
      });
    }
  }

  const turn: GeminiTurn = { role: 'model' };
  if (text) turn.text = text;
  if (functionCalls.length > 0) turn.functionCalls = functionCalls;
  // Keep the originals so the next request can replay them untouched.
  if (parts.length > 0) turn.parts = parts;

  const usageMetadata = response.usageMetadata;
  const usage: GeminiUsage | undefined = usageMetadata
    ? {
        promptTokens: usageMetadata.promptTokenCount,
        responseTokens: usageMetadata.candidatesTokenCount,
        thoughtTokens: usageMetadata.thoughtsTokenCount,
        totalTokens: usageMetadata.totalTokenCount,
      }
    : undefined;

  return {
    text,
    thoughts: thoughtChunks.join(''),
    functionCalls,
    finishReason,
    model,
    usage,
    turn,
    raw: response,
  };
}
