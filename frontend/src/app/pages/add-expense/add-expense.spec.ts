import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client.js';
import { Session } from '../../core/session/session.js';
import { ToolCallAudit } from '../../webmcp/tool-call-audit.js';
import { PageActions } from '../../webmcp/page-actions.js';
import { AddExpense } from './add-expense.js';

describe('AddExpense (declarative WebMCP surface)', () => {
  let fixture: ComponentFixture<AddExpense>;
  let api: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
  let audit: { record: ReturnType<typeof vi.fn> };
  let session: { refreshPendingApprovals: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    api = {
      get: vi.fn().mockResolvedValue([
        { id: 'cat-1', orgId: 'org-1', name: 'Travel', icon: 'plane', isDefault: true },
        { id: 'cat-2', orgId: 'org-1', name: 'Meals', icon: 'utensils', isDefault: true },
      ]),
      post: vi.fn().mockResolvedValue({ id: 'exp-1', amount: 450, currency: 'INR', merchant: 'Barista', status: 'draft' }),
    };
    audit = { record: vi.fn() };
    session = { refreshPendingApprovals: vi.fn().mockResolvedValue(0) };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiClient, useValue: api },
        { provide: ToolCallAudit, useValue: audit },
        { provide: Session, useValue: session },
      ],
    });
    fixture = TestBed.createComponent(AddExpense);
    fixture.detectChanges();
  });

  /** Dispatches a submit, optionally as an agent would. */
  function submit(agentInvoked = false): Promise<unknown> | null {
    const event = new Event('submit', { cancelable: true, bubbles: true }) as Event & {
      agentInvoked?: boolean;
      respondWith?: (r: Promise<unknown>) => void;
    };
    let responded: Promise<unknown> | null = null;
    if (agentInvoked) {
      event.agentInvoked = true;
      event.respondWith = (result) => (responded = result);
    }
    form().dispatchEvent(event);
    return responded;
  }

  const form = () => fixture.nativeElement.querySelector('form') as HTMLFormElement;

  /**
   * The whole point of this screen: the tool comes from HTML annotations, so if
   * these attributes are lost in a refactor the declarative demo silently
   * disappears while the page still looks fine.
   */
  it('declares the tool via form annotations', () => {
    expect(form().getAttribute('toolname')).toBe('add_expense_form');
    expect(form().getAttribute('tooldescription')).toBeTruthy();
    expect(form().hasAttribute('toolautosubmit')).toBe(true);
  });

  it('describes every parameter an agent has to fill', () => {
    for (const name of ['amount', 'currency', 'categoryId', 'merchant', 'expenseDate', 'note']) {
      const control = form().querySelector(`[name="${name}"]`);
      expect(control, `missing control: ${name}`).not.toBeNull();
      expect(
        control!.getAttribute('toolparamdescription'),
        `missing toolparamdescription on ${name}`,
      ).toBeTruthy();
    }
  });

  it('gives every control a name, since the schema is derived from them', () => {
    const controls = form().querySelectorAll('input, select, textarea');
    expect(controls.length).toBeGreaterThan(0);
    for (const control of Array.from(controls)) {
      expect(control.getAttribute('name')).toBeTruthy();
    }
  });

  it('marks the fields an expense cannot be created without', () => {
    expect(form().querySelector('[name="amount"]')!.hasAttribute('required')).toBe(true);
    expect(form().querySelector('[name="currency"]')!.hasAttribute('required')).toBe(true);
    expect(form().querySelector('[name="expenseDate"]')!.hasAttribute('required')).toBe(true);
    // Optional by design — an agent should not be forced to invent a merchant.
    expect(form().querySelector('[name="merchant"]')!.hasAttribute('required')).toBe(false);
  });

  it('posts the form values on a human submit', async () => {
    const amount = form().querySelector('[name="amount"]') as HTMLInputElement;
    amount.value = '450';
    const merchant = form().querySelector('[name="merchant"]') as HTMLInputElement;
    merchant.value = 'Barista';

    form().dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await fixture.whenStable();

    expect(api.post).toHaveBeenCalledWith(
      '/expenses',
      expect.objectContaining({ amount: 450, merchant: 'Barista', currency: 'INR' }),
    );
  });

  it('hands a structured result back through respondWith when an agent submits', async () => {
    const amount = form().querySelector('[name="amount"]') as HTMLInputElement;
    amount.value = '450';

    const event = new Event('submit', { cancelable: true, bubbles: true }) as Event & {
      agentInvoked?: boolean;
      respondWith?: (r: Promise<unknown>) => void;
    };
    event.agentInvoked = true;
    let responded: Promise<unknown> | null = null;
    event.respondWith = (result) => (responded = result);

    form().dispatchEvent(event);
    await fixture.whenStable();

    expect(responded).not.toBeNull();
    await expect(responded!).resolves.toMatchObject({ id: 'exp-1', status: 'draft' });
  });

  it('reports a failure to the user and to the agent', async () => {
    api.post.mockRejectedValue(new Error('Amount must be greater than 0'));
    const event = new Event('submit', { cancelable: true, bubbles: true }) as Event & {
      agentInvoked?: boolean;
      respondWith?: (r: Promise<unknown>) => void;
    };
    event.agentInvoked = true;
    let responded: Promise<unknown> | null = null;
    event.respondWith = (result) => (responded = result);

    form().dispatchEvent(event);
    await fixture.whenStable();
    fixture.detectChanges();

    await expect(responded!).rejects.toThrow('Amount must be greater than 0');
    expect(fixture.nativeElement.textContent).toContain('Amount must be greater than 0');
  });

  it('renders a category dropdown populated from the API', async () => {
    await fixture.whenStable();
    fixture.detectChanges();

    const select = form().querySelector('[name="categoryId"]') as HTMLSelectElement;
    expect(select).not.toBeNull();
    // "None" + 2 categories from the mock
    expect(select.options.length).toBe(3);
    expect(select.options[1].textContent?.trim()).toBe('Travel');
    expect(select.options[1].value).toBe('cat-1');
  });

  it('includes categoryId in the POST payload', async () => {
    await fixture.whenStable();
    fixture.detectChanges();

    const amount = form().querySelector('[name="amount"]') as HTMLInputElement;
    amount.value = '450';
    const select = form().querySelector('[name="categoryId"]') as HTMLSelectElement;
    select.value = 'cat-1';

    form().dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await fixture.whenStable();

    expect(api.post).toHaveBeenCalledWith(
      '/expenses',
      expect.objectContaining({ categoryId: 'cat-1' }),
    );
  });

  /**
   * This form is the only tool call a person can make — every other tool goes
   * through `ToolRegistry`, which is always an agent. Without this row the
   * audit viewer's "Human" filter is permanently empty and the human/agent
   * contrast it exists to draw has nothing to draw it with.
   */
  describe('audit trail', () => {
    it('records a form submit as a human action', async () => {
      submit();
      await fixture.whenStable();

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ actor: 'human', toolName: 'add_expense_form' }),
      );
    });

    it('records the same submit as an agent action when the agent made it', async () => {
      submit(true);
      await fixture.whenStable();

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ actor: 'agent', toolName: 'add_expense_form' }),
      );
    });

    it('does not log a save that failed', async () => {
      api.post.mockRejectedValue(new Error('Amount must be greater than 0'));

      submit();
      await fixture.whenStable();

      expect(audit.record).not.toHaveBeenCalled();
    });

    /**
     * A new expense can be submitted for approval, which is exactly what the
     * state-gated `approve_expense` tool watches.
     */
    it('re-checks the pending approval queue after a save', async () => {
      submit();
      await fixture.whenStable();

      expect(session.refreshPendingApprovals).toHaveBeenCalled();
    });
  });

  it('works without the declarative feature present, taking the human path', async () => {
    // A browser with no WebMCP gives a plain SubmitEvent; the form must still save.
    form().dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await fixture.whenStable();
    expect(api.post).toHaveBeenCalled();
  });

  /**
   * The `submit_expense` tool navigates here and hands the values over rather
   * than posting behind the page — so the user watches the same form they
   * would have filled themselves being filled.
   */
  describe('as the page that performs submit_expense', () => {
    /** Zero stagger: these tests have no interest in watching it type. */
    function agentFill() {
      (fixture.componentInstance as unknown as { fillStaggerMs: number }).fillStaggerMs = 0;
      const run = TestBed.inject(PageActions);
      return run.awaitHandler('submit_expense', new AbortController().signal);
    }

    it('offers the action while it is mounted, and withdraws it on destroy', () => {
      const pages = TestBed.inject(PageActions);
      expect(pages.has('submit_expense')).toBe(true);

      fixture.destroy();

      expect(pages.has('submit_expense')).toBe(false);
    });

    it('fills the visible form before saving anything', async () => {
      /*
       * Sampled at the moment of the save, not after: a successful save calls
       * `form.reset()`, so by the time the promise settles the fields are
       * legitimately empty again. What matters is that the DOM the user is
       * looking at held the values before anything was posted.
       */
      const onScreen: Record<string, string> = {};
      api.post.mockImplementation((path: string) => {
        if (path === '/expenses') {
          for (const name of ['amount', 'currency', 'merchant', 'expenseDate', 'note']) {
            const field = form().elements.namedItem(name) as HTMLInputElement | null;
            onScreen[name] = field?.value ?? '';
          }
        }
        return Promise.resolve({
          id: 'exp-1',
          amount: 450,
          currency: 'INR',
          merchant: 'Barista',
          status: 'submitted',
          expenseDate: '2026-09-04',
        });
      });

      const run = await agentFill();
      await run(
        {
          amount: 450,
          currency: 'INR',
          merchant: 'Barista',
          expenseDate: '2026-09-04',
          note: 'Team coffee',
        } as never,
        { signal: new AbortController().signal },
      );

      expect(onScreen).toMatchObject({
        amount: '450',
        currency: 'INR',
        merchant: 'Barista',
        expenseDate: '2026-09-04',
        note: 'Team coffee',
      });
    });

    /**
     * `submit_expense` has always meant create *and* send for approval. The
     * form on its own only creates a draft, so the transition has to happen too
     * or the tool would quietly start doing less than it says.
     */
    it('creates the expense and then submits it for approval', async () => {
      api.post
        .mockResolvedValueOnce({ id: 'exp-1', amount: 450, currency: 'INR', status: 'draft' })
        .mockResolvedValueOnce({
          id: 'exp-1',
          amount: 450,
          currency: 'INR',
          merchant: 'Barista',
          status: 'submitted',
          expenseDate: '2026-09-04',
        });

      const run = await agentFill();
      const result = await run({ amount: 450, currency: 'INR' } as never, {
        signal: new AbortController().signal,
      });

      expect(api.post.mock.calls[0][0]).toBe('/expenses');
      expect(api.post.mock.calls[1][0]).toBe('/expenses/exp-1/submit');
      expect(result).toMatchObject({ id: 'exp-1', status: 'submitted' });
    });

    /**
     * LOAD-BEARING. The form's own `onSubmit` stamps the audit row
     * `actor: agentInvoked ? 'agent' : 'human'`, and a synthetic submit carries
     * no `agentInvoked` — so driving the form through `requestSubmit()` would
     * file the agent's work as a person's. That flag is the only thing in the
     * app that can produce `actor: 'human'`, and the audit viewer's
     * human/agent contrast is built on it. `ToolRegistry` already logs this
     * call as `submit_expense`.
     */
    it('never files the agent’s work as a human action', async () => {
      api.post.mockResolvedValue({
        id: 'exp-1',
        amount: 450,
        currency: 'INR',
        status: 'submitted',
      });

      const run = await agentFill();
      await run({ amount: 450, currency: 'INR' } as never, {
        signal: new AbortController().signal,
      });

      const actors = audit.record.mock.calls.map((call) => call[0].actor);
      expect(actors).not.toContain('human');
    });

    it('re-polls the approval queue it just added to', async () => {
      api.post.mockResolvedValue({
        id: 'exp-1',
        amount: 450,
        currency: 'INR',
        status: 'submitted',
      });

      const run = await agentFill();
      await run({ amount: 450, currency: 'INR' } as never, {
        signal: new AbortController().signal,
      });

      expect(session.refreshPendingApprovals).toHaveBeenCalled();
    });
  });
});
