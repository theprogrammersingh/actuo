import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client.js';
import { Session } from '../../core/session/session.js';
import { ToolCallAudit } from '../../webmcp/tool-call-audit.js';
import { AddExpense } from './add-expense.js';

describe('AddExpense (declarative WebMCP surface)', () => {
  let fixture: ComponentFixture<AddExpense>;
  let api: { post: ReturnType<typeof vi.fn> };
  let audit: { record: ReturnType<typeof vi.fn> };
  let session: { refreshPendingApprovals: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    api = { post: vi.fn().mockResolvedValue({ id: 'exp-1', amount: 450, currency: 'INR', merchant: 'Barista', status: 'draft' }) };
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
    for (const name of ['amount', 'currency', 'merchant', 'expenseDate', 'note']) {
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
});
