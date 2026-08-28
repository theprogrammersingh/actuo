import { PLATFORM_ID, computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  GeminiError,
  KEY_STORAGE_KEY,
  KeyStore,
  MODEL_STORAGE_KEY,
  ModelCatalog,
  type GeminiModelOption,
  type KeyTestParams,
  type KeyTestResult,
} from '../../ai';
import {
  AI_STUDIO_KEY_URL,
  AiSettings,
  BYOK_TRUST_LINE,
  GEMINI_KEY_TESTER,
  type KeyTester,
} from './ai-settings.js';

const CATALOG_MODELS: readonly GeminiModelOption[] = [
  { id: 'gemini-3-pro', label: 'Gemini 3 Pro', description: 'Strongest reasoning.' },
  { id: 'gemini-3-flash', label: 'Gemini 3 Flash', description: 'Fast and cheap.' },
];

/** A `ModelCatalog` whose contents the test chooses. Never fetches. */
function stubCatalog(
  models: readonly GeminiModelOption[] = CATALOG_MODELS,
  source: 'default' | 'config' = 'config',
) {
  const list = signal(models);
  return {
    models: list.asReadonly(),
    source: signal(source).asReadonly(),
    loading: signal(false).asReadonly(),
    defaultModelId: signal(models[0]?.id ?? '').asReadonly(),
    modelIds: computed(() => list().map((model) => model.id)),
    has: (id: string) => list().some((model) => model.id === id),
    find: (id: string) => list().find((model) => model.id === id),
    labelFor: (id: string) => list().find((model) => model.id === id)?.label ?? id,
    refresh: vi.fn(async () => list()),
  };
}

function pass(model: string, latencyMs = 412): KeyTestResult {
  return { ok: true, model, latencyMs, message: `Key works. Gemini accepted it for ${model}.` };
}

function fail(model: string, kind: 'invalid-key' | 'rate-limited'): KeyTestResult {
  const error = new GeminiError({
    kind,
    model,
    message:
      kind === 'invalid-key'
        ? 'Gemini rejected this API key.'
        : 'Gemini is rate limiting this key right now.',
  });
  return { ok: false, model, latencyMs: 180, message: error.message, error };
}

describe('AiSettings (BYOK — Design Doc §3.3)', () => {
  let fixture: ComponentFixture<AiSettings>;
  let tester: ReturnType<typeof vi.fn>;
  let catalog: ReturnType<typeof stubCatalog>;

  const host = () => fixture.nativeElement as HTMLElement;
  const text = () => host().textContent ?? '';
  const buttons = () => Array.from(host().querySelectorAll('button')) as HTMLButtonElement[];
  const button = (label: string) =>
    buttons().find((element) => element.textContent?.trim().includes(label)) ?? null;
  const select = () => host().querySelector('select') as HTMLSelectElement;
  const keyInput = () => host().querySelector('ui-input input') as HTMLInputElement;

  function type(value: string): void {
    const input = keyInput();
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function build(options: { catalog?: ReturnType<typeof stubCatalog> } = {}): Promise<void> {
    catalog = options.catalog ?? stubCatalog();
    tester = vi.fn(async (params: KeyTestParams) => pass(params.model));

    await TestBed.configureTestingModule({
      imports: [AiSettings],
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: ModelCatalog, useValue: catalog as unknown as ModelCatalog },
        { provide: GEMINI_KEY_TESTER, useValue: tester as unknown as KeyTester },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AiSettings);
    fixture.detectChanges();
  }

  beforeEach(() => {
    localStorage.clear();
    // Nothing in this suite may reach the network.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('No component here may call fetch.');
      }),
    );
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  describe('the promise', () => {
    it('renders the trust line verbatim', async () => {
      await build();
      expect(text()).toContain(BYOK_TRUST_LINE);
      expect(BYOK_TRUST_LINE).toBe(
        "Your key is stored only in this browser and is never sent to Actuo's servers.",
      );
    });

    it('puts it above the key field, not in a footer', async () => {
      await build();
      const rendered = host().innerHTML;
      expect(rendered.indexOf('never sent to Actuo')).toBeLessThan(rendered.indexOf('<ui-input'));
    });

    it('links out to Google AI Studio for someone without a key', async () => {
      await build();
      const link = host().querySelector('a[href]') as HTMLAnchorElement;
      expect(link.href).toBe(AI_STUDIO_KEY_URL);
      expect(link.rel).toContain('noopener');
      expect(link.textContent).toContain('Google AI Studio');
    });
  });

  describe('set → test → clear', () => {
    it('starts with no key and says so', async () => {
      await build();
      expect(text()).toContain('No key yet');
      expect(button('Save key')?.disabled).toBe(true);
    });

    it('saves a pasted key to this browser only', async () => {
      await build();
      type('AIzaSyTESTkeyTESTkeyTESTkeyTESTkey123');
      button('Save key')!.click();
      fixture.detectChanges();

      expect(TestBed.inject(KeyStore).apiKey()).toBe('AIzaSyTESTkeyTESTkeyTESTkeyTESTkey123');
      expect(localStorage.getItem(KEY_STORAGE_KEY)).toBe('AIzaSyTESTkeyTESTkeyTESTkeyTESTkey123');
      expect(text()).toContain('Key saved in this browser.');
    });

    it('shows the key masked once saved, never in full', async () => {
      await build();
      type('AIzaSyTESTkeyTESTkeyTESTkeyTESTkey123');
      button('Save key')!.click();
      fixture.detectChanges();

      expect(text()).toContain('Key set');
      expect(text()).toContain('AIza…y123');
      expect(text()).not.toContain('AIzaSyTESTkeyTESTkeyTESTkeyTESTkey123');
    });

    it('masks the field itself until the reveal toggle is used', async () => {
      await build();
      expect(keyInput().type).toBe('password');

      const reveal = host().querySelector('ui-input button') as HTMLButtonElement;
      reveal.click();
      fixture.detectChanges();

      expect(keyInput().type).toBe('text');
    });

    it('tests the pasted key before it has been saved, so setup is one step', async () => {
      await build();
      type('AIzaSyPASTEDbutNOTyetSAVED0000000000');
      await button('Test key')!.click();
      await settle();

      expect(tester).toHaveBeenCalledWith({
        apiKey: 'AIzaSyPASTEDbutNOTyetSAVED0000000000',
        model: 'gemini-3-pro',
      });
    });

    it('reports a pass with the latency, not just a tick', async () => {
      await build();
      type('AIzaSyGOODkey00000000000000000000000');
      button('Save key')!.click();
      fixture.detectChanges();

      await button('Test key')!.click();
      await settle();

      expect(text()).toContain('Key works.');
      expect(text()).toContain('Verified in 412 ms.');
    });

    it('reports a failure specifically, and says what to check', async () => {
      await build();
      tester.mockImplementation(async (params: KeyTestParams) => fail(params.model, 'invalid-key'));
      type('AIzaSyBADkey000000000000000000000000');

      await button('Test key')!.click();
      await settle();

      const alert = host().querySelector('[role="alert"]');
      expect(alert?.textContent).toContain('Gemini rejected this API key.');
      expect(alert?.textContent).toContain('copied whole');
    });

    it('distinguishes a temporary failure from a bad key', async () => {
      await build();
      tester.mockImplementation(async (params: KeyTestParams) =>
        fail(params.model, 'rate-limited'),
      );
      type('AIzaSyGOODkey00000000000000000000000');

      await button('Test key')!.click();
      await settle();

      expect(text()).toContain('looks temporary');
      expect(text()).not.toContain('copied whole');
    });

    it('cannot be tested with nothing to test', async () => {
      await build();
      expect(button('Test key')?.disabled).toBe(true);
    });

    it('requires a confirmation before clearing, and names what is being removed', async () => {
      await build();
      type('AIzaSyTESTkeyTESTkeyTESTkeyTESTkey123');
      button('Save key')!.click();
      fixture.detectChanges();

      button('Clear key')!.click();
      fixture.detectChanges();

      // Still there — asking is not doing.
      expect(TestBed.inject(KeyStore).hasKey()).toBe(true);
      expect(text()).toContain('Remove the key AIza…y123 from this browser?');
      expect(button('Clear it')).not.toBeNull();
    });

    it('keeps the key when the confirmation is declined', async () => {
      await build();
      type('AIzaSyTESTkeyTESTkeyTESTkeyTESTkey123');
      button('Save key')!.click();
      fixture.detectChanges();
      button('Clear key')!.click();
      fixture.detectChanges();

      button('Keep it')!.click();
      fixture.detectChanges();

      expect(TestBed.inject(KeyStore).hasKey()).toBe(true);
      expect(text()).not.toContain('Remove the key');
    });

    it('wipes the key from storage immediately once confirmed (PRD §8.3)', async () => {
      await build();
      type('AIzaSyTESTkeyTESTkeyTESTkeyTESTkey123');
      button('Save key')!.click();
      fixture.detectChanges();
      button('Clear key')!.click();
      fixture.detectChanges();

      button('Clear it')!.click();
      fixture.detectChanges();

      expect(TestBed.inject(KeyStore).hasKey()).toBe(false);
      expect(localStorage.getItem(KEY_STORAGE_KEY)).toBeNull();
      expect(text()).toContain('Key cleared from this browser.');
      expect(text()).toContain('No key yet');
    });
  });

  describe('model selector', () => {
    it('offers exactly what ModelCatalog reports, Gemini only', async () => {
      await build({ catalog: stubCatalog(CATALOG_MODELS) });

      const labels = Array.from(select().options).map((option) => option.textContent?.trim());
      expect(labels).toEqual(['Gemini 3 Pro', 'Gemini 3 Flash']);
      expect(Array.from(select().options).every((option) => option.value.startsWith('gemini-')))
        .toBe(true);
    });

    it('follows the catalog when the server config replaces the list', async () => {
      await build({
        catalog: stubCatalog([
          { id: 'gemini-4-pro', label: 'Gemini 4 Pro', description: 'From /api/config.' },
        ]),
      });

      const values = Array.from(select().options).map((option) => option.value);
      expect(values).toContain('gemini-4-pro');
      expect(values).not.toContain('gemini-3-flash');
    });

    it('asks the catalog to refresh, because the line-up churns (PRD §11)', async () => {
      await build();
      expect(catalog.refresh).toHaveBeenCalled();
    });

    it('persists the choice alongside the key, in this browser only', async () => {
      await build();
      select().value = 'gemini-3-flash';
      select().dispatchEvent(new Event('change'));
      fixture.detectChanges();

      expect(TestBed.inject(KeyStore).model()).toBe('gemini-3-flash');
      expect(localStorage.getItem(MODEL_STORAGE_KEY)).toBe('gemini-3-flash');
    });

    it('shows the selected model’s positioning line', async () => {
      await build();
      expect(text()).toContain('Strongest reasoning.');
    });

    it('drops a stale pass when the model changes, since the result was model-specific', async () => {
      await build();
      type('AIzaSyGOODkey00000000000000000000000');
      await button('Test key')!.click();
      await settle();
      expect(text()).toContain('Key works.');

      select().value = 'gemini-3-flash';
      select().dispatchEvent(new Event('change'));
      fixture.detectChanges();

      expect(text()).not.toContain('Key works.');
    });

    it('keeps a saved-but-retired model visible instead of silently switching', async () => {
      localStorage.setItem(MODEL_STORAGE_KEY, 'gemini-1.5-pro');
      await build({ catalog: stubCatalog(CATALOG_MODELS) });

      const values = Array.from(select().options).map((option) => option.value);
      expect(values).toContain('gemini-1.5-pro');
      expect(text()).toContain('may have been retired');
    });

    it('says when the list is the built-in fallback rather than server config', async () => {
      await build({ catalog: stubCatalog(CATALOG_MODELS, 'default') });
      expect(text()).toContain('built-in model list');
    });
  });

  describe('storage that will not persist', () => {
    it('says nothing when storage is healthy', async () => {
      await build();
      expect(text()).not.toContain('will not save the key');
    });

    it('warns plainly that the key survives the session but not a reload', async () => {
      await build();
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      type('AIzaSyTESTkeyTESTkeyTESTkeyTESTkey123');
      button('Save key')!.click();
      fixture.detectChanges();

      expect(text()).toContain('This browser will not save the key.');
      expect(text()).toContain('gone');
      // ...and the key still works right now, so it is a warning, not an error.
      expect(TestBed.inject(KeyStore).hasKey()).toBe(true);
      expect(text()).toContain('Key set for this session');
    });
  });

  it('renders during SSR, where there is never a key', async () => {
    await TestBed.configureTestingModule({
      imports: [AiSettings],
      providers: [
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: ModelCatalog, useValue: stubCatalog() as unknown as ModelCatalog },
        { provide: GEMINI_KEY_TESTER, useValue: (async () => pass('gemini-3-pro')) as KeyTester },
      ],
    }).compileComponents();

    const server = TestBed.createComponent(AiSettings);
    expect(() => server.detectChanges()).not.toThrow();
    expect(server.nativeElement.textContent).toContain(BYOK_TRUST_LINE);
  });
});
