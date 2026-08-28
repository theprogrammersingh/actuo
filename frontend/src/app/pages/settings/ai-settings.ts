import {
  ChangeDetectionStrategy,
  Component,
  InjectionToken,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Badge, Button, Card, Input } from '../../ui';
import { KeyStore, ModelCatalog, testGeminiKey, type KeyTestParams, type KeyTestResult } from '../../ai';

/**
 * The trust line from Design Doc §3.3, verbatim.
 *
 * Exported so a test can assert it renders character-for-character. It is a
 * promise the product makes about where a credential goes; paraphrasing it in a
 * future edit would quietly weaken the claim.
 */
export const BYOK_TRUST_LINE =
  "Your key is stored only in this browser and is never sent to Actuo's servers.";

/** PRD §11: the fastest route to a key for someone who does not have one. */
export const AI_STUDIO_KEY_URL = 'https://aistudio.google.com/apikey';

export type KeyTester = (params: KeyTestParams) => Promise<KeyTestResult>;

/**
 * Indirection for {@link testGeminiKey}, in the same spirit as `GEMINI_FETCH`:
 * tests swap the tester rather than mocking a module or a global, so the
 * component under test never has a route to the network at all.
 */
export const GEMINI_KEY_TESTER = new InjectionToken<KeyTester>('GEMINI_KEY_TESTER', {
  providedIn: 'root',
  factory: (): KeyTester => (params) => testGeminiKey(params),
});

/**
 * Settings → AI & Copilot (BYOK) — Design Doc §3.3, PRD §6.9 / §8.3.
 *
 * The highest-trust screen in the app: the user is pasting a credential that
 * bills to their own Google account, on the promise that it never reaches
 * Actuo. The design doc asks for this to be treated like a payment form, which
 * shows up here as four concrete things:
 *
 *  1. the promise is stated where the credential is entered, not in a footer;
 *  2. every action says what it did — "Key works … in 412 ms", not a green tick;
 *  3. the destructive action is confirmed, and the confirmation names what is
 *     being destroyed;
 *  4. when the browser will not persist the key we say so, rather than letting
 *     the user discover it after a reload.
 *
 * The key never touches `ApiClient`. `testGeminiKey` calls Google directly from
 * this browser; this component holds no reference to Actuo's API surface at
 * all, which is what keeps `src/app/ai/key-privacy.spec.ts` honest.
 */
@Component({
  selector: 'app-ai-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Badge, Button, Card, Input],
  host: { class: 'block' },
  template: `
    <ui-card padding="lg">
      <header uiCardHeader class="mb-5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="font-display text-lg font-semibold text-body">AI &amp; Copilot</h2>
          @if (keys.hasKey()) {
            <ui-badge tone="success" label="Key set" />
          } @else {
            <ui-badge tone="neutral" label="No key yet" />
          }
        </div>
        <p class="mt-1.5 text-sm text-muted">
          Actuo's Copilot runs on your own Gemini key, straight from this browser to Google.
        </p>
      </header>

      <!--
        The promise, at the top of the section and in body-weight text rather
        than fine print. §3.3 wants this prominent.
      -->
      <p
        class="flex items-start gap-2.5 rounded-lg border border-brand-teal/30 bg-brand-teal/8
               px-3.5 py-3 text-sm text-body"
      >
        <svg
          class="mt-0.5 size-4 shrink-0 text-brand-teal"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M12 3 5 6v5.5c0 4.3 2.9 8.2 7 9.5 4.1-1.3 7-5.2 7-9.5V6Z" />
          <path d="m9.2 12.1 1.9 1.9 3.7-3.8" />
        </svg>
        <span>{{ trustLine }}</span>
      </p>

      @if (!keys.persistent()) {
        <!--
          Safari private browsing, a blocked-cookies profile, a full quota. The
          key still works right now, so this is a warning, not an error.
        -->
        <p
          class="mt-3 rounded-lg border border-status-warning/30 bg-status-warning/10 px-3.5 py-3
                 text-sm text-status-warning"
          role="status"
        >
          This browser will not save the key. It works for this session, but it will be gone
          after a reload — private browsing and blocked site data both do this.
        </p>
      }

      <!-- Key ------------------------------------------------------------- -->
      <div class="mt-6 flex flex-col gap-3">
        <ui-input
          label="Gemini API key"
          type="password"
          name="gemini-api-key"
          autocomplete="off"
          placeholder="AIza…"
          [hint]="keyHint()"
          [error]="keyError()"
          [(value)]="draft"
        />

        <div class="flex flex-wrap items-center gap-2">
          <button uiButton variant="primary" size="md" [disabled]="!draft().trim()" (click)="saveKey()">
            {{ keys.hasKey() ? 'Replace key' : 'Save key' }}
          </button>

          <button
            uiButton
            variant="secondary"
            size="md"
            [disabled]="!canTest()"
            [loading]="testing()"
            loadingLabel="Testing your key against Gemini"
            (click)="testKey()"
          >
            Test key
          </button>

          @if (keys.hasKey()) {
            <button uiButton variant="ghost" size="md" (click)="askToClear()">Clear key</button>
          }

          <a
            class="ml-auto rounded text-sm font-medium text-brand-teal underline underline-offset-4
                   transition-colors duration-150 ease-out hover:text-brand-teal/80
                   focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal"
            [href]="aiStudioUrl"
            target="_blank"
            rel="noopener noreferrer"
          >
            Get a free key from Google AI Studio
            <span class="sr-only">(opens in a new tab)</span>
          </a>
        </div>

        @if (confirmingClear()) {
          <div
            class="flex flex-wrap items-center gap-3 rounded-lg border border-status-danger/30
                   bg-status-danger/10 px-3.5 py-3"
            role="alert"
          >
            <p class="text-sm text-body">
              Remove the key {{ keys.maskedKey() }} from this browser? The Copilot stops working
              until you paste a key again.
            </p>
            <div class="flex gap-2">
              <button uiButton variant="danger" size="sm" (click)="confirmClear()">
                Clear it
              </button>
              <button uiButton variant="ghost" size="sm" (click)="cancelClear()">Keep it</button>
            </div>
          </div>
        }

        @if (notice(); as message) {
          <p class="text-sm text-status-success" role="status">{{ message }}</p>
        }

        @if (result(); as outcome) {
          @if (outcome.ok) {
            <p class="text-sm text-status-success" role="status">
              {{ outcome.message }} Verified in {{ outcome.latencyMs }} ms.
            </p>
          } @else {
            <p class="text-sm text-status-danger" role="alert">
              {{ outcome.message }}
              @if (outcome.error?.keyProblem) {
                Check the key was copied whole, and that Gemini is enabled on that Google account.
              } @else if (outcome.error?.retryable) {
                That looks temporary — try again in a moment.
              }
            </p>
          }
        }
      </div>

      <!-- Model ----------------------------------------------------------- -->
      <div class="mt-7 border-t border-line pt-6">
        <label for="gemini-model" class="mb-1.5 block text-sm font-medium text-body">
          Model
        </label>
        <select
          id="gemini-model"
          class="block min-h-11 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm
                 text-body transition-colors duration-150 ease-out
                 focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-brand-teal"
          aria-describedby="gemini-model-hint"
          [value]="keys.model()"
          (change)="onModelChange($event)"
        >
          @for (model of modelOptions(); track model.id) {
            <option [value]="model.id" [selected]="model.id === keys.model()">
              {{ model.label }}
            </option>
          }
        </select>

        <p id="gemini-model-hint" class="mt-1.5 text-xs text-muted">
          {{ selectedDescription() }}
        </p>

        @if (catalog.source() === 'default') {
          <p class="mt-1 text-xs text-muted">
            Showing the built-in model list — Actuo's config endpoint was not reachable.
          </p>
        }
      </div>
    </ui-card>
  `,
})
export class AiSettings {
  /** Public so the container can read key state without a second injection. */
  readonly keys = inject(KeyStore);
  readonly catalog = inject(ModelCatalog);
  private readonly tester = inject(GEMINI_KEY_TESTER);

  protected readonly trustLine = BYOK_TRUST_LINE;
  protected readonly aiStudioUrl = AI_STUDIO_KEY_URL;

  /** What is currently typed. Never written to storage until "Save key". */
  protected readonly draft = signal('');
  protected readonly testing = signal(false);
  protected readonly result = signal<KeyTestResult | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly keyError = signal<string | null>(null);
  protected readonly confirmingClear = signal(false);

  protected readonly keyHint = computed(() => {
    const masked = this.keys.maskedKey();
    if (this.draft().trim()) return 'Not saved yet — choose Save key to keep it in this browser.';
    return masked
      ? `Saved in this browser as ${masked}. Paste a new key to replace it.`
      : 'Paste the key from Google AI Studio. It stays on this device.';
  });

  /** Testing works on the pasted key too, so nobody has to save to find out. */
  protected readonly canTest = computed(
    () => !this.testing() && (this.draft().trim().length > 0 || this.keys.hasKey()),
  );

  /**
   * The catalog, plus the saved model if the catalog no longer lists it.
   *
   * Gemini retires models (PRD §11). Dropping a retired id from the dropdown
   * would leave the select showing nothing while the app kept using it — the
   * one state where the screen lies about what it is doing. So it stays,
   * labelled for what it is, and switching away is a deliberate choice.
   */
  protected readonly modelOptions = computed(() => {
    const options = this.catalog.models();
    const current = this.keys.model();
    if (options.some((model) => model.id === current)) return options;
    return [
      ...options,
      {
        id: current,
        label: this.catalog.labelFor(current),
        description: 'Saved earlier, and not in the current model list — it may have been retired.',
      },
    ];
  });

  protected readonly selectedDescription = computed(() => {
    const id = this.keys.model();
    const option = this.modelOptions().find((model) => model.id === id);
    return (
      option?.description ??
      'Used by the Copilot and by in-app AI features such as categorization.'
    );
  });

  constructor() {
    // Model line-ups churn (PRD §11), so ask the server what is current. The
    // catalog is SSR-guarded and falls back to compiled-in defaults, so this
    // can never leave the dropdown empty.
    void this.catalog.refresh();
  }

  protected saveKey(): void {
    const value = this.draft().trim();
    this.reset();
    try {
      this.keys.setKey(value);
      this.draft.set('');
      this.notice.set(
        this.keys.persistent()
          ? 'Key saved in this browser.'
          : 'Key set for this session — this browser will not save it.',
      );
    } catch (error) {
      this.keyError.set(error instanceof Error ? error.message : 'That key could not be saved.');
    }
  }

  protected async testKey(): Promise<void> {
    const apiKey = this.draft().trim() || this.keys.apiKey();
    if (!apiKey) return;

    this.reset();
    this.testing.set(true);
    try {
      // Straight to Google. `testGeminiKey` never throws — it reports.
      this.result.set(await this.tester({ apiKey, model: this.keys.model() }));
    } finally {
      this.testing.set(false);
    }
  }

  protected askToClear(): void {
    this.reset();
    this.confirmingClear.set(true);
  }

  protected cancelClear(): void {
    this.confirmingClear.set(false);
  }

  /** PRD §8.3 — an immediate wipe, once confirmed. */
  protected confirmClear(): void {
    this.keys.clearKey();
    this.draft.set('');
    this.confirmingClear.set(false);
    this.result.set(null);
    this.notice.set('Key cleared from this browser.');
  }

  protected onModelChange(event: Event): void {
    const target = event.target as HTMLSelectElement | null;
    if (!target?.value) return;
    this.keys.setModel(target.value);
    // A pass/fail is only true of the model it ran against.
    this.result.set(null);
    this.notice.set(null);
  }

  private reset(): void {
    this.notice.set(null);
    this.keyError.set(null);
    this.result.set(null);
    this.confirmingClear.set(false);
  }
}
