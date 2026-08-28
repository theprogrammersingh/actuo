/**
 * The "Test key" action from PRD §6.9: one cheap call that returns a clear
 * pass/fail for the settings screen.
 *
 * Deliberately *not* wired through the full `generate()` path — a key can be
 * perfectly valid while the model returns no candidates (safety, an output
 * token cap, a thinking model spending its whole budget). For this check the
 * only question is "did Google accept this key for this model", so any 2xx is
 * a pass and the body is irrelevant.
 */

import { GeminiError, isGeminiError } from './gemini-errors';
import { callGemini, type FetchLike } from './gemini-transport';
import type { WireGenerateContentRequest } from './gemini-protocol';

export interface KeyTestParams {
  apiKey: string | null | undefined;
  model: string;
  fetchImpl?: FetchLike;
}

export interface KeyTestResult {
  ok: boolean;
  model: string;
  /** Ready to render. Specific about what happened, either way. */
  message: string;
  /** Round-trip time, so settings can show "verified in 420ms". */
  latencyMs: number;
  /** Present only on failure. Carries `kind`, `status`, `retryable`. */
  error?: GeminiError;
}

/** Smallest useful request: one token in, a handful out, no tools. */
function probeRequest(): WireGenerateContentRequest {
  return {
    contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 8 },
  };
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export async function testGeminiKey(
  params: KeyTestParams,
  options: { signal?: AbortSignal } = {},
): Promise<KeyTestResult> {
  const started = now();
  const model = params.model;

  try {
    await callGemini('generateContent', probeRequest(), {
      apiKey: params.apiKey,
      model,
      signal: options.signal,
      fetchImpl: params.fetchImpl,
    });
    return {
      ok: true,
      model,
      latencyMs: Math.round(now() - started),
      message: `Key works. Gemini accepted it for ${model}.`,
    };
  } catch (error) {
    const geminiError = isGeminiError(error)
      ? error
      : new GeminiError({
          kind: 'network',
          model,
          message: 'The key test failed before it reached Gemini.',
          cause: error,
        });
    return {
      ok: false,
      model,
      latencyMs: Math.round(now() - started),
      message: geminiError.message,
      error: geminiError,
    };
  }
}
