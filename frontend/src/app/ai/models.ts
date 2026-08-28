/**
 * The selectable Gemini model list.
 *
 * PRD §11 calls out model churn as a live risk: "the model line-up shifts over
 * time and older models get retired — the model selector should be easy to
 * update without a code change". So the list is a constant here (never
 * hardcoded in a component), and {@link ModelCatalog} overlays whatever
 * `GET /api/config` reports when the backend is reachable.
 *
 * `/api/config` is an *Actuo* origin call. It carries no key and no
 * credentials — it only ever answers "which model ids are current".
 */

import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export interface GeminiModelOption {
  /** The id sent to the API, e.g. `gemini-3-pro`. */
  id: string;
  /** Human label for the settings dropdown. */
  label: string;
  /** One-line positioning, shown under the label. */
  description?: string;
}

export const DEFAULT_GEMINI_MODEL_ID = 'gemini-3-pro';

export const DEFAULT_GEMINI_MODELS: readonly GeminiModelOption[] = [
  {
    id: 'gemini-3-pro',
    label: 'Gemini 3 Pro',
    description: 'Strongest reasoning and multi-step tool use. Slower, costs more.',
  },
  {
    id: 'gemini-3-flash',
    label: 'Gemini 3 Flash',
    description: 'Fast and cheap, good at function calling. A sensible default for the Copilot.',
  },
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    description: 'Previous generation. Use it if a Gemini 3 model is unavailable on your key.',
  },
] as const;

/** Where the current list came from — surfaced so settings can say so. */
export type ModelSource = 'default' | 'config';

const CONFIG_ENDPOINT = '/api/config';

function titleCase(segment: string): string {
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

/** `gemini-3-pro-preview` -> `Gemini 3 Pro Preview`. */
export function labelForModelId(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => (/^\d/.test(part) ? part : titleCase(part)))
    .join(' ');
}

function toOption(entry: unknown): GeminiModelOption | null {
  if (typeof entry === 'string') {
    const id = entry.trim();
    return id ? { id, label: labelForModelId(id) } : null;
  }
  if (!entry || typeof entry !== 'object') return null;

  const record = entry as Record<string, unknown>;
  const rawId = record['id'] ?? record['model'] ?? record['name'];
  if (typeof rawId !== 'string' || !rawId.trim()) return null;

  const id = rawId.trim().replace(/^models\//, '');
  const rawLabel = record['label'] ?? record['displayName'] ?? record['title'];
  const rawDescription = record['description'] ?? record['summary'];

  const option: GeminiModelOption = {
    id,
    label: typeof rawLabel === 'string' && rawLabel.trim() ? rawLabel.trim() : labelForModelId(id),
  };
  if (typeof rawDescription === 'string' && rawDescription.trim()) {
    option.description = rawDescription.trim();
  }
  return option;
}

/**
 * Pulls a model list out of whatever `/api/config` returned, tolerating a few
 * plausible shapes. Returns `null` when there is nothing usable, so the caller
 * keeps the defaults instead of blanking the dropdown.
 */
export function parseModelConfig(body: unknown): {
  models: readonly GeminiModelOption[];
  defaultModelId?: string;
} | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;

  const gemini = record['gemini'];
  const nested = gemini && typeof gemini === 'object' ? (gemini as Record<string, unknown>) : {};

  const candidates =
    record['geminiModels'] ?? record['models'] ?? nested['models'] ?? nested['geminiModels'];
  if (!Array.isArray(candidates)) return null;

  const seen = new Set<string>();
  const models: GeminiModelOption[] = [];
  for (const entry of candidates) {
    const option = toOption(entry);
    if (option && !seen.has(option.id)) {
      seen.add(option.id);
      models.push(option);
    }
  }
  if (models.length === 0) return null;

  const rawDefault = record['defaultGeminiModel'] ?? record['defaultModel'] ?? nested['defaultModel'];
  const defaultModelId =
    typeof rawDefault === 'string' && seen.has(rawDefault.trim()) ? rawDefault.trim() : undefined;

  return { models, defaultModelId };
}

@Injectable({ providedIn: 'root' })
export class ModelCatalog {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly _models = signal<readonly GeminiModelOption[]>(DEFAULT_GEMINI_MODELS);
  private readonly _source = signal<ModelSource>('default');
  private readonly _loading = signal(false);
  private readonly _defaultModelId = signal(DEFAULT_GEMINI_MODEL_ID);

  /** The list to render in the settings dropdown. Never empty. */
  readonly models = this._models.asReadonly();
  readonly source = this._source.asReadonly();
  readonly loading = this._loading.asReadonly();
  /** Model to pre-select for a user who has never chosen one. */
  readonly defaultModelId = this._defaultModelId.asReadonly();
  readonly modelIds = computed(() => this._models().map((model) => model.id));

  has(id: string): boolean {
    return this._models().some((model) => model.id === id);
  }

  find(id: string): GeminiModelOption | undefined {
    return this._models().find((model) => model.id === id);
  }

  /** Label for an id, falling back to a prettified id for unknown models. */
  labelFor(id: string): string {
    return this.find(id)?.label ?? labelForModelId(id);
  }

  /**
   * Refreshes from `GET /api/config`. Never throws and never rejects: a
   * missing or broken config endpoint leaves {@link DEFAULT_GEMINI_MODELS} in
   * place, because a stale dropdown beats an empty one.
   *
   * No API key is attached — this is a call to Actuo's own origin.
   */
  async refresh(options: { signal?: AbortSignal } = {}): Promise<readonly GeminiModelOption[]> {
    // A relative URL has no base during SSR, and the model list is only ever
    // needed for a browser-side interaction anyway.
    if (!this.isBrowser) return this._models();

    this._loading.set(true);
    try {
      const response = await fetch(CONFIG_ENDPOINT, {
        headers: { Accept: 'application/json' },
        signal: options.signal,
      });
      if (!response.ok) return this._models();

      const parsed = parseModelConfig(await response.json());
      if (!parsed) return this._models();

      this._models.set(parsed.models);
      this._source.set('config');
      this._defaultModelId.set(parsed.defaultModelId ?? parsed.models[0]!.id);
      return parsed.models;
    } catch {
      // Offline, 404, HTML error page, aborted — all mean "keep the defaults".
      return this._models();
    } finally {
      this._loading.set(false);
    }
  }
}
