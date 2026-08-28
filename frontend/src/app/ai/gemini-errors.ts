/**
 * Typed, actionable errors for the direct browser -> Gemini call path.
 *
 * Two rules govern this file:
 *
 * 1. **The key never appears in an error.** Gemini is called with the key in a
 *    request *header* (never the URL), so it should never come back in an error
 *    body — but error text is the one thing an app reliably logs, so every
 *    message and detail string is run through {@link redactKey} anyway.
 * 2. **Messages are honest and specific** (Design Doc §5). "Something went
 *    wrong" is not an acceptable string here; each kind says what actually
 *    failed and what the user can do about it.
 */

export type GeminiErrorKind =
  /** No key is stored yet — the Copilot should route to the key-setup flow. */
  | 'no-key'
  /** Gemini rejected the key itself (401, or 400 API_KEY_INVALID). */
  | 'invalid-key'
  /** The key is real but not allowed to make this call (403). */
  | 'permission-denied'
  /** Quota / rate limit (429). */
  | 'rate-limited'
  /** The model id does not exist or was retired (404). */
  | 'model-not-found'
  /** We sent something Gemini would not accept (400). */
  | 'invalid-request'
  /** Google-side failure (5xx). */
  | 'server-error'
  /** The request never reached Google (offline, DNS, CORS, blocked domain). */
  | 'network'
  /** An AbortSignal cancelled the request. */
  | 'aborted'
  /** Safety filters blocked the prompt or the response. */
  | 'blocked'
  /** HTTP 200 but the body was not a shape we understand. */
  | 'malformed-response';

/** Google API keys are `AIza` + 35 url-safe chars; match loosely and redact. */
const API_KEY_PATTERN = /AIza[0-9A-Za-z_-]{10,}/g;

const REDACTED = '[redacted]';

/**
 * Strips anything that looks like a Google API key — plus the specific key we
 * were using, whatever its shape — out of arbitrary text.
 */
export function redactKey(text: string, apiKey?: string | null): string {
  let out = text;
  if (apiKey && apiKey.length >= 8) {
    out = out.split(apiKey).join(REDACTED);
  }
  return out.replace(API_KEY_PATTERN, REDACTED);
}

export interface GeminiErrorInit {
  kind: GeminiErrorKind;
  message: string;
  /** HTTP status, when there was a response. */
  status?: number;
  /** Google's `error.status` string, e.g. `RESOURCE_EXHAUSTED`. */
  statusText?: string;
  /** Seconds to wait before retrying, when the server told us. */
  retryAfterSeconds?: number;
  /** Model id the call was made against. */
  model?: string;
  /** Server-supplied detail, already redacted. */
  detail?: string;
  cause?: unknown;
}

const RETRYABLE: ReadonlySet<GeminiErrorKind> = new Set<GeminiErrorKind>([
  'rate-limited',
  'server-error',
  'network',
]);

const KEY_PROBLEMS: ReadonlySet<GeminiErrorKind> = new Set<GeminiErrorKind>([
  'no-key',
  'invalid-key',
  'permission-denied',
]);

export class GeminiError extends Error {
  override readonly name = 'GeminiError';
  readonly kind: GeminiErrorKind;
  readonly status?: number;
  readonly statusText?: string;
  readonly retryAfterSeconds?: number;
  readonly model?: string;
  readonly detail?: string;
  /** True when retrying the same request could plausibly succeed. */
  readonly retryable: boolean;
  /** True when the fix is "fix the key", so settings UI can deep-link there. */
  readonly keyProblem: boolean;

  constructor(init: GeminiErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.kind = init.kind;
    this.status = init.status;
    this.statusText = init.statusText;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.model = init.model;
    this.detail = init.detail;
    this.retryable = RETRYABLE.has(init.kind);
    this.keyProblem = KEY_PROBLEMS.has(init.kind);
  }
}

export function isGeminiError(value: unknown): value is GeminiError {
  return value instanceof GeminiError;
}

/** Shape of Google's error envelope. Every field is treated as optional. */
interface GoogleErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: unknown[];
  };
}

function readRetryAfter(response: Response, body: GoogleErrorBody): number | undefined {
  const header = response.headers?.get?.('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  }
  const details = body.error?.details;
  if (Array.isArray(details)) {
    for (const detail of details) {
      if (!detail || typeof detail !== 'object') continue;
      const record = detail as Record<string, unknown>;
      const delay = record['retryDelay'];
      if (typeof delay === 'string') {
        const seconds = Number(delay.replace(/s$/, ''));
        if (Number.isFinite(seconds) && seconds >= 0) return seconds;
      }
    }
  }
  return undefined;
}

function looksLikeKeyRejection(body: GoogleErrorBody, raw: string): boolean {
  const status = body.error?.status ?? '';
  if (status === 'UNAUTHENTICATED') return true;
  const haystack = `${body.error?.message ?? ''} ${raw}`.toLowerCase();
  return (
    haystack.includes('api key not valid') ||
    haystack.includes('api_key_invalid') ||
    haystack.includes('invalid api key') ||
    haystack.includes('api key expired')
  );
}

const KEY_HELP = 'Get or rotate a key at https://aistudio.google.com/apikey.';

/**
 * Turns a non-2xx Gemini response into a typed error. Reads the body
 * defensively — a gateway can return HTML where we expected JSON.
 */
export async function errorFromResponse(
  response: Response,
  context: { model?: string; apiKey?: string | null } = {},
): Promise<GeminiError> {
  let raw = '';
  try {
    raw = await response.text();
  } catch {
    raw = '';
  }
  raw = redactKey(raw, context.apiKey).slice(0, 2000);

  let body: GoogleErrorBody = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') body = parsed as GoogleErrorBody;
  } catch {
    // Not JSON. `raw` is still useful as detail.
  }

  const serverMessage = redactKey(body.error?.message ?? '', context.apiKey).trim();
  const statusText = body.error?.status;
  const detail = serverMessage || raw || undefined;
  const status = response.status;
  const model = context.model;

  const base = { status, statusText, model, detail };

  if (status === 401 || (status === 400 && looksLikeKeyRejection(body, raw))) {
    return new GeminiError({
      ...base,
      kind: 'invalid-key',
      message: `Gemini rejected this API key. It is mistyped, revoked, or belongs to a project without the Generative Language API enabled. ${KEY_HELP}`,
    });
  }

  if (status === 403) {
    return new GeminiError({
      ...base,
      kind: 'permission-denied',
      message: `This key exists but is not allowed to call Gemini${
        serverMessage ? ` — ${serverMessage}` : ''
      }. Common causes: an HTTP-referrer or IP restriction on the key, or the Generative Language API not enabled for its project. ${KEY_HELP}`,
    });
  }

  if (status === 404) {
    return new GeminiError({
      ...base,
      kind: 'model-not-found',
      message: `Gemini has no model called "${model ?? 'unknown'}" available to this key. Google retires model ids regularly — pick a different model in Settings.`,
    });
  }

  if (status === 429) {
    const retryAfterSeconds = readRetryAfter(response, body);
    return new GeminiError({
      ...base,
      kind: 'rate-limited',
      retryAfterSeconds,
      message: `Gemini is rate-limiting this key (quota exceeded)${
        retryAfterSeconds !== undefined ? `. Retry in about ${Math.ceil(retryAfterSeconds)}s` : ''
      }. Free-tier keys have low per-minute limits — waiting, or switching to a Flash model, usually clears it.`,
    });
  }

  if (status >= 500) {
    return new GeminiError({
      ...base,
      kind: 'server-error',
      message: `Gemini's API returned ${status}${
        serverMessage ? ` — ${serverMessage}` : ''
      }. That is a fault on Google's side, not with your key; retrying usually works.`,
    });
  }

  return new GeminiError({
    ...base,
    kind: 'invalid-request',
    message: `Gemini rejected the request (HTTP ${status})${
      serverMessage ? `: ${serverMessage}` : '.'
    }`,
  });
}

function isAbortLike(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const record = error as { name?: unknown; code?: unknown };
  return record.name === 'AbortError' || record.name === 'TimeoutError' || record.code === 20;
}

/**
 * Maps an exception thrown by `fetch` itself (never a response) to a typed
 * error. `fetch` rejects for exactly two reasons we care about: the request was
 * aborted, or it never completed at the network layer.
 */
export function errorFromThrown(
  error: unknown,
  context: { model?: string; apiKey?: string | null; signal?: AbortSignal } = {},
): GeminiError {
  if (isGeminiError(error)) return error;

  if (isAbortLike(error) || context.signal?.aborted) {
    return new GeminiError({
      kind: 'aborted',
      message: 'The Gemini request was cancelled.',
      model: context.model,
      cause: error,
    });
  }

  const raw = error instanceof Error ? error.message : String(error);
  return new GeminiError({
    kind: 'network',
    message: `Could not reach generativelanguage.googleapis.com. Actuo calls Gemini directly from your browser, so an offline connection, a blocked domain, or a corporate proxy stops it here — nothing was sent to Actuo's servers. (${redactKey(
      raw,
      context.apiKey,
    )})`,
    model: context.model,
    detail: redactKey(raw, context.apiKey),
    cause: error,
  });
}

export function noKeyError(): GeminiError {
  return new GeminiError({
    kind: 'no-key',
    message:
      'No Gemini API key is set. Add your own key in Settings — it is stored only in this browser and is never sent to Actuo\'s servers.',
  });
}
