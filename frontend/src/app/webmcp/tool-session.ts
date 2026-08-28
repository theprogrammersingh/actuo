import { Injectable, effect, inject, signal } from '@angular/core';
import { APPROVE_EXPENSE, type Role } from '@actuo/shared';
import { ExpenseTools } from '../tools/expense-tools.js';
import { ToolRegistry } from './tool-registry.js';

/**
 * Owns which tools are published at any moment.
 *
 * This is where PRD §7's "dynamic / state-gated tools" requirement lives:
 * `approve_expense` must exist only while the signed-in user can actually
 * approve something, and it must appear and disappear as that changes. Every
 * register/unregister fires `toolchange`, which is precisely what an observing
 * agent watches.
 *
 * The gate is a UX and discovery concern, not a security boundary — the backend
 * re-checks the caller's role on every approve call regardless.
 */
@Injectable({ providedIn: 'root' })
export class ToolSession {
  private readonly registry = inject(ToolRegistry);
  private readonly tools = inject(ExpenseTools);

  private readonly role = signal<Role | null>(null);
  private readonly pendingApprovals = signal(0);
  private readonly started = signal(false);

  /** True while `approve_expense` should be published. */
  readonly canApprove = () =>
    (this.role() === 'admin' || this.role() === 'owner') && this.pendingApprovals() > 0;

  constructor() {
    effect(() => {
      if (!this.started()) return;

      const shouldExpose = this.canApprove();
      const isExposed = this.registry.has(APPROVE_EXPENSE.name);

      if (shouldExpose && !isExposed) {
        void this.registry.register(this.tools.approveExpense());
      } else if (!shouldExpose && isExposed) {
        this.registry.unregister(APPROVE_EXPENSE.name);
      }
    });
  }

  /** Publish the always-on tools. Safe to call more than once. */
  async start(): Promise<void> {
    if (this.started()) return;
    for (const tool of this.tools.all()) {
      await this.registry.register(tool);
    }
    this.started.set(true);
  }

  /** Called by the session/auth layer whenever the active membership changes. */
  setRole(role: Role | null): void {
    this.role.set(role);
  }

  /** Called whenever the pending-approval count changes. */
  setPendingApprovals(count: number): void {
    this.pendingApprovals.set(count);
  }

  /** Retire everything — used on sign-out. */
  stop(): void {
    for (const name of [...this.registry.registeredNames()]) {
      this.registry.unregister(name);
    }
    this.started.set(false);
    this.role.set(null);
    this.pendingApprovals.set(0);
  }
}
