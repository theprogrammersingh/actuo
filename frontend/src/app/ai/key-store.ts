/**
 * Browser-only storage for the user's Gemini API key and selected model
 * (PRD §8.3, CLAUDE.md rule 2).
 *
 * The key lives in `localStorage` and nowhere else. It is never put in an
 * Angular HTTP interceptor, never attached to an Actuo API call, and never
 * logged — {@link maskedKey} exists precisely so nothing else needs the raw
 * value in order to display it.
 *
 * The app server-renders, so every `localStorage` touch is behind
 * `isPlatformBrowser`. On the server the store simply reports "no key", which
 * is also the honest answer: the server genuinely does not have one.
 */

import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { DEFAULT_GEMINI_MODEL_ID } from './models';

export const KEY_STORAGE_KEY = 'actuo.gemini.apiKey';
export const MODEL_STORAGE_KEY = 'actuo.gemini.model';

/** Characters shown at each end of {@link KeyStore.maskedKey}. */
const MASK_VISIBLE = 4;
const ELLIPSIS = '…';

export function maskApiKey(key: string | null): string | null {
  if (!key) return null;
  if (key.length <= MASK_VISIBLE * 2 + 2) return '•'.repeat(8);
  return `${key.slice(0, MASK_VISIBLE)}${ELLIPSIS}${key.slice(-MASK_VISIBLE)}`;
}

@Injectable({ providedIn: 'root' })
export class KeyStore {
  /** Public so callers can skip key-dependent work during SSR. */
  readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly _apiKey = signal<string | null>(null);
  private readonly _model = signal<string>(DEFAULT_GEMINI_MODEL_ID);
  /**
   * False when `localStorage` exists but refuses to persist (Safari private
   * browsing, quota, a hardened profile). The key still works for this tab; it
   * just will not survive a reload, which settings should say out loud.
   */
  private readonly _persistent = signal(true);

  /**
   * The raw key. Read it only to build a Gemini request — never to log, render,
   * or attach to an Actuo API call.
   */
  readonly apiKey = this._apiKey.asReadonly();
  readonly model = this._model.asReadonly();
  readonly persistent = this._persistent.asReadonly();

  readonly hasKey = computed(() => {
    const key = this._apiKey();
    return key !== null && key.length > 0;
  });

  /** e.g. `AIza…7f3k`. Safe to render and safe to log. */
  readonly maskedKey = computed(() => maskApiKey(this._apiKey()));

  constructor() {
    if (!this.isBrowser) return;

    const storedKey = this.read(KEY_STORAGE_KEY);
    if (storedKey) this._apiKey.set(storedKey);

    const storedModel = this.read(MODEL_STORAGE_KEY);
    if (storedModel) this._model.set(storedModel);
  }

  /**
   * Stores a key. Trims surrounding whitespace, which is the single most
   * common paste error.
   *
   * @throws if the key is blank — callers should validate before calling, and
   *   silently storing an empty key would make `hasKey` lie.
   */
  setKey(key: string): void {
    const trimmed = key.trim();
    if (!trimmed) {
      throw new Error('A Gemini API key cannot be empty.');
    }
    this._apiKey.set(trimmed);
    this.write(KEY_STORAGE_KEY, trimmed);
  }

  /** Immediate wipe of the key (PRD §8.3). Leaves the model choice alone. */
  clearKey(): void {
    this._apiKey.set(null);
    this.remove(KEY_STORAGE_KEY);
  }

  setModel(modelId: string): void {
    const trimmed = modelId.trim();
    if (!trimmed) {
      throw new Error('A Gemini model id cannot be empty.');
    }
    this._model.set(trimmed);
    this.write(MODEL_STORAGE_KEY, trimmed);
  }

  /** Wipes both the key and the model preference. */
  clear(): void {
    this._apiKey.set(null);
    this._model.set(DEFAULT_GEMINI_MODEL_ID);
    this.remove(KEY_STORAGE_KEY);
    this.remove(MODEL_STORAGE_KEY);
  }

  // -- storage plumbing, all SSR- and exception-guarded ---------------------

  private storage(): Storage | null {
    if (!this.isBrowser) return null;
    try {
      return globalThis.localStorage ?? null;
    } catch {
      // Accessing localStorage itself throws when site data is blocked.
      return null;
    }
  }

  private read(key: string): string | null {
    const storage = this.storage();
    if (!storage) return null;
    try {
      return storage.getItem(key);
    } catch {
      this._persistent.set(false);
      return null;
    }
  }

  private write(key: string, value: string): void {
    const storage = this.storage();
    if (!storage) return;
    try {
      storage.setItem(key, value);
      this._persistent.set(true);
    } catch {
      this._persistent.set(false);
    }
  }

  private remove(key: string): void {
    const storage = this.storage();
    if (!storage) return;
    try {
      storage.removeItem(key);
    } catch {
      this._persistent.set(false);
    }
  }
}
