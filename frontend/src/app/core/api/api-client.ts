import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export class ApiError extends Error {
  constructor(
    override readonly message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Thin typed wrapper over `fetch` for Actuo's own `/api/*` surface.
 *
 * Deliberately separate from the Gemini client in `src/app/ai/`: this one
 * carries the session token and must NEVER carry the user's Gemini key, and
 * that one talks only to Google and must never touch this origin. Keeping them
 * apart is what makes the BYOK promise auditable in the network tab.
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly token = signal<string | null>(null);

  readonly accessToken = this.token.asReadonly();

  setAccessToken(token: string | null): void {
    this.token.set(token);
  }

  get<T>(path: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const query = params ? buildQuery(params) : '';
    return this.request<T>('GET', `${path}${query}`, undefined, signal);
  }

  post<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    return this.request<T>('POST', path, body, signal);
  }

  patch<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    return this.request<T>('PATCH', path, body, signal);
  }

  delete<T>(path: string, signal?: AbortSignal): Promise<T> {
    return this.request<T>('DELETE', path, undefined, signal);
  }

  /**
   * Fetch a file, with the session token attached.
   *
   * This exists because the token lives in memory and travels in a header: a
   * plain browser navigation to an `/api/*` route sends no `Authorization` and
   * comes back 401, so a downloadable file cannot be a link the user clicks. It
   * has to be fetched here and handed to `saveBlob()`.
   *
   * Deliberately NOT routed through `request()`: that parses the body as JSON
   * first, and a single-column numeric CSV would parse into a number.
   */
  async download(path: string, signal?: AbortSignal): Promise<DownloadedFile> {
    const response = await this.send('GET', path, undefined, signal);

    if (!response.ok) {
      const payload = await readBody(response);
      throw new ApiError(extractMessage(payload, response.statusText), response.status, payload);
    }

    return {
      blob: await response.blob(),
      filename: filenameFromDisposition(response.headers.get('Content-Disposition')),
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await this.send(method, path, body, signal);
    const payload = await readBody(response);

    if (!response.ok) {
      throw new ApiError(extractMessage(payload, response.statusText), response.status, payload);
    }

    return payload as T;
  }

  /** The one place the prefix, the bearer header and the SSR guard live. */
  private send(
    method: string,
    path: string,
    body: unknown,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    // During SSR there is no session, so data calls are skipped rather than
    // rendered against an unauthenticated backend.
    if (!this.isBrowser) {
      throw new ApiError('API calls are not made during server-side rendering', 0, null);
    }

    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const token = this.token();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    return fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  }
}

export interface DownloadedFile {
  blob: Blob;
  /** From Content-Disposition; null when the server named no file. */
  filename: string | null;
}

/** Reads the `filename="..."` (or bare `filename=`) parameter, if present. */
function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]).trim() || null;
  } catch {
    return match[1].trim() || null;
  }
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'string' && payload) return payload;
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const { message } = payload as { message: unknown };
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join(', ');
  }
  return fallback;
}

function buildQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}
