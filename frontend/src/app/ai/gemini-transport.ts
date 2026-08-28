/**
 * The one and only place in Actuo where the user's Gemini API key is attached
 * to a network request.
 *
 * Invariants enforced here, not by convention:
 *
 * - the request URL is built from {@link GEMINI_API_ORIGIN}, a constant — a
 *   caller cannot redirect it;
 * - {@link assertGeminiUrl} re-checks the origin immediately before the key is
 *   attached, so a future refactor that made the base configurable would throw
 *   rather than leak;
 * - the key travels in the `x-goog-api-key` **header**, never `?key=`, so it
 *   never lands in a URL, a referrer, a browser history entry, or a server log;
 * - `credentials: 'omit'` so no Actuo cookie rides along to Google.
 *
 * Nothing in this module imports from `backend/` or knows Actuo's own origin.
 */

import { InjectionToken } from '@angular/core';
import { GeminiError, errorFromResponse, errorFromThrown, noKeyError } from './gemini-errors';

export const GEMINI_API_ORIGIN = 'https://generativelanguage.googleapis.com';
export const GEMINI_API_VERSION = 'v1beta';

/** Header Google reads the key from. Deliberately not a query parameter. */
export const GEMINI_API_KEY_HEADER = 'x-goog-api-key';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Indirection for `fetch` so tests can substitute one without touching globals.
 * The default is late-bound on purpose: it reads `globalThis.fetch` at call
 * time, so `vi.stubGlobal('fetch', ...)` still works.
 */
export const GEMINI_FETCH = new InjectionToken<FetchLike>('GEMINI_FETCH', {
  providedIn: 'root',
  factory: (): FetchLike => (input, init) => fetch(input, init),
});

export type GeminiEndpoint = 'generateContent' | 'streamGenerateContent' | 'countTokens';

export function geminiUrl(model: string, endpoint: GeminiEndpoint): string {
  const trimmed = model.trim().replace(/^models\//, '');
  return `${GEMINI_API_ORIGIN}/${GEMINI_API_VERSION}/models/${encodeURIComponent(
    trimmed,
  )}:${endpoint}`;
}

/**
 * Hard stop: refuse to attach the key to anything that is not Google's
 * Generative Language API. This is the code-level expression of the product
 * promise in PRD §8.3 / CLAUDE.md rule 2.
 */
export function assertGeminiUrl(url: string): void {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    throw new GeminiError({
      kind: 'invalid-request',
      message: `Refusing to send the Gemini API key to a malformed URL.`,
    });
  }
  if (origin !== GEMINI_API_ORIGIN) {
    throw new GeminiError({
      kind: 'invalid-request',
      message: `Refusing to send the Gemini API key to ${origin}. The key only ever goes to ${GEMINI_API_ORIGIN}.`,
    });
  }
}

export interface GeminiCallOptions {
  apiKey: string | null | undefined;
  model: string;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
}

export interface GeminiRawResult<T> {
  status: number;
  body: T;
}

/**
 * POSTs to a Gemini endpoint and returns the parsed body, mapping every
 * failure mode to a typed {@link GeminiError}.
 */
export async function callGemini<T>(
  endpoint: GeminiEndpoint,
  requestBody: unknown,
  options: GeminiCallOptions,
): Promise<GeminiRawResult<T>> {
  const { apiKey, model, signal } = options;
  const doFetch: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));

  if (!apiKey) throw noKeyError();
  if (!model || !model.trim()) {
    throw new GeminiError({
      kind: 'model-not-found',
      message: 'No Gemini model selected. Choose one in Settings.',
    });
  }
  if (signal?.aborted) {
    throw new GeminiError({ kind: 'aborted', model, message: 'The Gemini request was cancelled.' });
  }

  const url = geminiUrl(model, endpoint);
  assertGeminiUrl(url);

  let response: Response;
  try {
    response = await doFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [GEMINI_API_KEY_HEADER]: apiKey,
      },
      body: JSON.stringify(requestBody),
      // No Actuo cookies, ever.
      credentials: 'omit',
      signal,
    });
  } catch (error) {
    throw errorFromThrown(error, { model, apiKey, signal });
  }

  if (!response.ok) {
    throw await errorFromResponse(response, { model, apiKey });
  }

  let body: T;
  try {
    body = (await response.json()) as T;
  } catch (error) {
    if (signal?.aborted) {
      throw new GeminiError({
        kind: 'aborted',
        model,
        message: 'The Gemini request was cancelled.',
        cause: error,
      });
    }
    throw new GeminiError({
      kind: 'malformed-response',
      model,
      status: response.status,
      message: 'Gemini returned a 200 response that was not valid JSON.',
      cause: error,
    });
  }

  return { status: response.status, body };
}
